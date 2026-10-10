-- Seven Stones: schema, RLS, and secure RPCs
-- Run in Supabase SQL Editor or via supabase db push

create extension if not exists "pgcrypto";

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles for select to authenticated
  using (true);

create policy "Users can insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rooms (secrets stored as hashes only)
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code_hash text not null unique,
  passphrase_salt text not null,
  passphrase_hash text not null,
  host_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'finished')),
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Room members
create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team text not null check (team in ('seekers', 'guardians')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_members enable row level security;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create policy "Members can view their rooms"
  on public.rooms for select to authenticated
  using (public.is_room_member(id) or host_id = auth.uid());

create policy "Authenticated users can create rooms"
  on public.rooms for insert to authenticated
  with check (host_id = auth.uid());

create policy "Host can update room"
  on public.rooms for update to authenticated
  using (host_id = auth.uid());

create policy "Members can view membership"
  on public.room_members for select to authenticated
  using (public.is_room_member(room_id));

create policy "Users can leave rooms"
  on public.room_members for delete to authenticated
  using (user_id = auth.uid());

-- Game state snapshot
create table public.game_states (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  phase text not null default 'waiting'
    check (phase in ('waiting', 'throwing', 'broken', 'rebuild', 'seekers_win', 'guardians_win')),
  stack_height int not null default 7 check (stack_height >= 0 and stack_height <= 7),
  seekers_score int not null default 0,
  guardians_score int not null default 0,
  thrower_id uuid references auth.users (id),
  tagged_seekers uuid[] not null default '{}',
  last_hash text not null default
    '0000000000000000000000000000000000000000000000000000000000000000',
  action_seq int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.game_states enable row level security;

create policy "Members can view game state"
  on public.game_states for select to authenticated
  using (public.is_room_member(room_id));

-- Append-only action log (hash chain)
create table public.game_actions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  seq int not null,
  actor_id uuid not null references auth.users (id),
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text not null,
  action_hash text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  unique (room_id, seq)
);

alter table public.game_actions enable row level security;

create policy "Members can view actions"
  on public.game_actions for select to authenticated
  using (public.is_room_member(room_id));

-- E2E encrypted chat (ciphertext only)
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  sender_id uuid not null references auth.users (id),
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy "Members can view chat ciphertext"
  on public.chat_messages for select to authenticated
  using (public.is_room_member(room_id));

create policy "Members can send chat"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid() and public.is_room_member(room_id)
  );

-- Secure room create (hashes already computed client-side)
create or replace function public.create_room_secure(
  p_name text,
  p_invite_code_hash text,
  p_passphrase_salt text,
  p_passphrase_hash text,
  p_host_team text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_host_team not in ('seekers', 'guardians') then
    raise exception 'Invalid team';
  end if;

  insert into public.rooms (
    name, invite_code_hash, passphrase_salt, passphrase_hash, host_id
  ) values (
    p_name, p_invite_code_hash, p_passphrase_salt, p_passphrase_hash, auth.uid()
  )
  returning id into v_room_id;

  insert into public.room_members (room_id, user_id, team)
  values (v_room_id, auth.uid(), p_host_team);

  insert into public.game_states (room_id) values (v_room_id);

  return v_room_id;
end;
$$;

-- Secure join: match invite + passphrase hashes, never store plaintext
create or replace function public.join_room_secure(
  p_invite_code_hash text,
  p_passphrase_hash text,
  p_team text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_team not in ('seekers', 'guardians') then
    raise exception 'Invalid team';
  end if;

  select * into v_room
  from public.rooms
  where invite_code_hash = p_invite_code_hash;

  if not found then
    raise exception 'Invalid invite code';
  end if;

  if v_room.passphrase_hash <> p_passphrase_hash then
    raise exception 'Invalid passphrase';
  end if;

  insert into public.room_members (room_id, user_id, team)
  values (v_room.id, auth.uid(), p_team)
  on conflict (room_id, user_id) do update set team = excluded.team;

  return v_room.id;
end;
$$;

-- Submit hashed game action + update snapshot
create or replace function public.submit_game_action(
  p_room_id uuid,
  p_action_type text,
  p_payload jsonb,
  p_prev_hash text,
  p_action_hash text,
  p_nonce text,
  p_seq int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.game_states%rowtype;
  v_phase text;
  v_stack int;
  v_tagged uuid[];
  v_thrower uuid;
  v_seekers_score int;
  v_guardians_score int;
  v_seeker_ids uuid[];
  v_target uuid;
  v_hit boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Not a room member';
  end if;

  select * into v_state from public.game_states where room_id = p_room_id for update;
  if not found then
    raise exception 'Game state missing';
  end if;

  if p_seq <> v_state.action_seq + 1 then
    raise exception 'Sequence mismatch';
  end if;
  if p_prev_hash <> v_state.last_hash then
    raise exception 'Prev hash mismatch';
  end if;

  insert into public.game_actions (
    room_id, seq, actor_id, action_type, payload, prev_hash, action_hash, nonce
  ) values (
    p_room_id, p_seq, auth.uid(), p_action_type, coalesce(p_payload, '{}'::jsonb),
    p_prev_hash, p_action_hash, p_nonce
  );

  v_phase := v_state.phase;
  v_stack := v_state.stack_height;
  v_tagged := v_state.tagged_seekers;
  v_thrower := v_state.thrower_id;
  v_seekers_score := v_state.seekers_score;
  v_guardians_score := v_state.guardians_score;

  select coalesce(array_agg(user_id order by joined_at), '{}') into v_seeker_ids
  from public.room_members
  where room_id = p_room_id and team = 'seekers';

  if p_action_type = 'start_game' then
    v_phase := 'throwing';
    v_stack := 7;
    v_tagged := '{}';
    v_thrower := v_seeker_ids[1];
    update public.rooms set status = 'playing' where id = p_room_id;

  elsif p_action_type = 'throw' then
    if v_phase <> 'throwing' then
      raise exception 'Invalid phase for throw';
    end if;
    v_hit := coalesce((p_payload->>'hit')::boolean, false);
    if v_hit then
      v_phase := 'broken';
      v_stack := 0;
    else
      -- rotate to next seeker after current thrower
      select user_id into v_thrower
      from public.room_members
      where room_id = p_room_id
        and team = 'seekers'
        and joined_at > coalesce(
          (select joined_at from public.room_members
           where room_id = p_room_id and user_id = v_state.thrower_id),
          '-infinity'::timestamptz
        )
      order by joined_at
      limit 1;
      if v_thrower is null then
        v_thrower := v_seeker_ids[1];
      end if;
    end if;

  elsif p_action_type = 'rebuild_stone' then
    if v_phase not in ('broken', 'rebuild') then
      raise exception 'Invalid phase for rebuild';
    end if;
    -- only seekers
    if not exists (
      select 1 from public.room_members
      where room_id = p_room_id and user_id = auth.uid() and team = 'seekers'
    ) then
      raise exception 'Only seekers can rebuild';
    end if;
    if auth.uid() = any (v_tagged) then
      raise exception 'Tagged seekers cannot rebuild';
    end if;
    v_stack := least(v_stack + 1, 7);
    if v_stack >= 7 then
      v_phase := 'seekers_win';
      v_seekers_score := v_seekers_score + 1;
      update public.rooms set status = 'finished' where id = p_room_id;
    else
      v_phase := 'rebuild';
    end if;

  elsif p_action_type = 'tag_player' then
    if v_phase not in ('broken', 'rebuild') then
      raise exception 'Invalid phase for tag';
    end if;
    if not exists (
      select 1 from public.room_members
      where room_id = p_room_id and user_id = auth.uid() and team = 'guardians'
    ) then
      raise exception 'Only guardians can tag';
    end if;
    v_target := (p_payload->>'targetId')::uuid;
    if v_target is null or not (v_target = any (v_seeker_ids)) then
      raise exception 'Invalid tag target';
    end if;
    if not (v_target = any (v_tagged)) then
      v_tagged := array_append(v_tagged, v_target);
    end if;
    if coalesce(array_length(v_tagged, 1), 0) >= coalesce(array_length(v_seeker_ids, 1), 0)
       and coalesce(array_length(v_seeker_ids, 1), 0) > 0 then
      v_phase := 'guardians_win';
      v_guardians_score := v_guardians_score + 1;
      update public.rooms set status = 'finished' where id = p_room_id;
    end if;

  else
    raise exception 'Unknown action type';
  end if;

  update public.game_states set
    phase = v_phase,
    stack_height = v_stack,
    tagged_seekers = v_tagged,
    thrower_id = v_thrower,
    seekers_score = v_seekers_score,
    guardians_score = v_guardians_score,
    last_hash = p_action_hash,
    action_seq = p_seq,
    updated_at = now()
  where room_id = p_room_id;

  return jsonb_build_object(
    'phase', v_phase,
    'stack_height', v_stack,
    'action_seq', p_seq,
    'last_hash', p_action_hash
  );
end;
$$;

-- Helper: get passphrase salt by invite hash (needed before join hash check)
create or replace function public.get_room_salt_by_invite(p_invite_code_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salt text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select passphrase_salt into v_salt
  from public.rooms
  where invite_code_hash = p_invite_code_hash;
  if v_salt is null then
    raise exception 'Invalid invite code';
  end if;
  return v_salt;
end;
$$;

grant execute on function public.create_room_secure to authenticated;
grant execute on function public.join_room_secure to authenticated;
grant execute on function public.submit_game_action to authenticated;
grant execute on function public.get_room_salt_by_invite to authenticated;
grant execute on function public.is_room_member to authenticated;

-- Realtime
alter publication supabase_realtime add table public.room_members;
alter publication supabase_realtime add table public.game_states;
alter publication supabase_realtime add table public.game_actions;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.rooms;
