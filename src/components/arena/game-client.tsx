"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/supabase-provider";
import { AppHeader } from "@/components/layout/app-header";
import { GameArena } from "@/components/arena/game-arena";
import { EncryptedChat } from "@/components/chat/encrypted-chat";
import { SecurityLab } from "@/components/security-lab/security-lab";
import { Button } from "@/components/ui/button";
import type {
  ChatMessage,
  GameAction,
  GameState,
  Profile,
  Room,
  RoomMember,
} from "@/lib/supabase/database.types";

export function GameClient({ roomId }: { roomId: string }) {
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
    setInviteCode(sessionStorage.getItem(`ss_invite_code:${roomId}`));
  }, [load, roomId]);

  useEffect(() => {
    const channel = supabase
      .channel(`game:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_states",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setGameState(payload.new as GameState);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_actions",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setActions((prev) => {
            const next = payload.new as GameAction;
            if (prev.some((a) => a.seq === next.seq)) return prev;
            return [...prev, next];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        () => void load()
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
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 pb-48 lg:grid-cols-[1fr_320px] lg:pb-8">
        <div>
          <div className="mb-4 flex items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold">Arena</h1>
            <Button asChild variant="outline" size="sm">
              <Link href={`/room/${roomId}`}>Back to room</Link>
            </Button>
          </div>
          {error && (
            <p className="mb-4 text-sm text-red-300">{error}</p>
          )}
          {gameState && room ? (
            <GameArena
              roomId={roomId}
              userId={user.id}
              isHost={room.host_id === user.id}
              gameState={gameState}
              members={members}
              profiles={profiles}
            />
          ) : (
            <p className="text-[var(--muted)]">Loading game state…</p>
          )}
        </div>
        <div>
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
