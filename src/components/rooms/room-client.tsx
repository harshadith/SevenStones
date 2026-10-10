"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/supabase-provider";
import { AppHeader } from "@/components/layout/app-header";
import { EncryptedChat } from "@/components/chat/encrypted-chat";
import { SecurityLab } from "@/components/security-lab/security-lab";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  ChatMessage,
  GameAction,
  GameState,
  Profile,
  Room,
  RoomMember,
} from "@/lib/supabase/database.types";

export function RoomClient({ roomId }: { roomId: string }) {
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [actions, setActions] = useState<GameAction[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [roomRes, membersRes, stateRes, actionsRes] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).single(),
      supabase.from("room_members").select("*").eq("room_id", roomId),
      supabase.from("game_states").select("*").eq("room_id", roomId).single(),
      supabase
        .from("game_actions")
        .select("*")
        .eq("room_id", roomId)
        .order("seq", { ascending: true }),
    ]);

    if (roomRes.error) {
      setError(roomRes.error.message);
      return;
    }
    setRoom(roomRes.data);
    setMembers(membersRes.data ?? []);
    setGameState(stateRes.data);
    setActions(actionsRes.data ?? []);

    const ids = (membersRes.data ?? []).map((m) => m.user_id);
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      (profs as Profile[] | null)?.forEach((p) => {
        map[p.id] = p.display_name;
      });
      setProfiles(map);
    }
  }, [supabase, roomId]);

  useEffect(() => {
    void load();
    const code = sessionStorage.getItem(`ss_invite_code:${roomId}`);
    if (code) setInviteCode(code);
  }, [load, roomId]);

  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
        () => void load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        () => void load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_states", filter: `room_id=eq.${roomId}` },
        () => void load()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_actions", filter: `room_id=eq.${roomId}` },
        (payload) => {
          setActions((prev) => [...prev, payload.new as GameAction]);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, roomId, load]);

  if (!user) {
    return <p className="p-8 text-[var(--muted)]">Loading session…</p>;
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-40 sm:pb-8">
        {error && (
          <p className="mb-4 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
            {error} — you may not be a member (RLS).
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{room?.name ?? "Room"}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Waiting room · share invite + passphrase securely
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary">{room?.status ?? "…"}</Badge>
            <Button asChild>
              <Link href={`/game/${roomId}`}>Enter arena</Link>
            </Button>
          </div>
        </div>

        {inviteCode && (
          <div className="mt-4 rounded-lg border border-[var(--accent)]/40 bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--muted)]">
              Invite code (shown once to host — DB stores SHA-256 only)
            </p>
            <p className="mt-1 font-mono text-2xl tracking-[0.3em] text-[var(--accent)]">
              {inviteCode}
            </p>
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="font-medium">Players</h2>
            <ul className="mt-3 space-y-2">
              {members.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>
                    {profiles[m.user_id] ?? m.user_id.slice(0, 8)}
                    {m.user_id === user.id && " (you)"}
                    {m.user_id === room?.host_id && " · host"}
                  </span>
                  <Badge
                    variant="secondary"
                    style={{
                      color:
                        m.team === "seekers"
                          ? "var(--seeker)"
                          : "var(--guardian)",
                    }}
                  >
                    {m.team}
                  </Badge>
                </li>
              ))}
            </ul>
            {gameState && (
              <p className="mt-4 text-xs text-[var(--muted)]">
                Phase: {gameState.phase} · stack {gameState.stack_height}/7
              </p>
            )}
          </div>

          {room && (
            <EncryptedChat
              roomId={roomId}
              passphraseSalt={room.passphrase_salt}
              userId={user.id}
              onChatUnlocked={setChatUnlocked}
              onMessagesChange={setChatMessages}
            />
          )}
        </div>
      </main>

      <SecurityLab
        room={room}
        members={members}
        actions={actions}
        chatMessages={chatMessages}
        inviteCodeShown={inviteCode}
        chatUnlocked={chatUnlocked}
      />
    </>
  );
}
