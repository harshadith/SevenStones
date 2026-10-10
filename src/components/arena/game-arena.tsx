"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  computeActionHash,
  randomHex,
} from "@/lib/crypto/hash";
import { MAX_STACK, phaseLabel } from "@/lib/game/rules";
import type {
  GameAction,
  GameState,
  Json,
  RoomMember,
  Team,
} from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArenaCanvas } from "@/components/arena/arena-canvas";

type GameArenaProps = {
  roomId: string;
  userId: string;
  isHost: boolean;
  gameState: GameState;
  members: RoomMember[];
  profiles: Record<string, string>;
  onActionSubmitted?: (action: GameAction) => void;
};

export function GameArena({
  roomId,
  userId,
  isHost,
  gameState,
  members,
  profiles,
  onActionSubmitted,
}: GameArenaProps) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aim, setAim] = useState(50);

  const myTeam = members.find((m) => m.user_id === userId)?.team;
  const seekers = members.filter((m) => m.team === "seekers");
  const guardians = members.filter((m) => m.team === "guardians");
  const tagged = new Set(gameState.tagged_seekers ?? []);

  const canThrow =
    gameState.phase === "throwing" &&
    myTeam === "seekers" &&
    (gameState.thrower_id === userId || !gameState.thrower_id) &&
    !tagged.has(userId);

  const canRebuild =
    (gameState.phase === "broken" || gameState.phase === "rebuild") &&
    myTeam === "seekers" &&
    !tagged.has(userId);

  const canTag =
    (gameState.phase === "broken" || gameState.phase === "rebuild") &&
    myTeam === "guardians";

  async function submitAction(
    actionType: string,
    payload: Record<string, Json>
  ) {
    setBusy(true);
    setError(null);
    try {
      const seq = gameState.action_seq + 1;
      const prevHash = gameState.last_hash;
      const nonce = randomHex(8);
      const jsonPayload = payload as Json;
      const actionHash = await computeActionHash({
        roomId,
        seq,
        actorId: userId,
        actionType,
        payload: jsonPayload,
        prevHash,
        nonce,
      });

      const { data, error: rpcError } = await supabase.rpc("submit_game_action", {
        p_room_id: roomId,
        p_action_type: actionType,
        p_payload: jsonPayload,
        p_prev_hash: prevHash,
        p_action_hash: actionHash,
        p_nonce: nonce,
        p_seq: seq,
      });

      if (rpcError) throw rpcError;

      onActionSubmitted?.({
        id: crypto.randomUUID(),
        room_id: roomId,
        seq,
        actor_id: userId,
        action_type: actionType,
        payload: jsonPayload,
        prev_hash: prevHash,
        action_hash: actionHash,
        nonce,
        created_at: new Date().toISOString(),
      });

      void data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function throwStone() {
    // Aim 0–100: closer to 70 = better hit chance (demo-friendly)
    const distance = Math.abs(aim - 70);
    const hitChance = Math.max(0.15, 1 - distance / 80);
    const hit = Math.random() < hitChance;
    void submitAction("throw", { hit, aim });
  }

  return (
    <div className="space-y-4">
      {/* Round Header & Cryptographic Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="px-2.5 py-1 text-xs">
            {phaseLabel(gameState.phase)}
          </Badge>
          <span className="font-semibold text-sm text-[var(--fg)]">
            Seekers <span className="text-emerald-400">{gameState.seekers_score}</span> — Guardians <span className="text-amber-400">{gameState.guardians_score}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--muted)]">
            seq {gameState.action_seq} · hash {gameState.last_hash.slice(0, 10)}…
          </span>
          {myTeam && (
            <span
              className="rounded px-2 py-0.5 text-xs font-medium border border-[var(--border)]"
              style={{
                color: myTeam === "seekers" ? "var(--seeker)" : "var(--guardian)",
                borderColor: myTeam === "seekers" ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)",
              }}
            >
              Your Team: {teamLabel(myTeam)}
            </span>
          )}
        </div>
      </div>

      {/* Interactive 2D Physics Arena Canvas */}
      <ArenaCanvas
        roomId={roomId}
        userId={userId}
        myTeam={myTeam || "seekers"}
        gameState={gameState}
        members={members}
        profiles={profiles}
        isHost={isHost}
        onTriggerAction={(actionType, payload) => {
          void submitAction(actionType, payload as Record<string, Json>);
        }}
      />

      {/* Teams & Manual Control Strip */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/60 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TeamRow
            label="Seekers (Rebuilders)"
            color="var(--seeker)"
            members={seekers}
            profiles={profiles}
            tagged={tagged}
            selfId={userId}
            throwerId={gameState.thrower_id}
          />
          <TeamRow
            label="Guardians (Defenders)"
            color="var(--guardian)"
            members={guardians}
            profiles={profiles}
            tagged={tagged}
            selfId={userId}
          />
        </div>

        {/* Optional Manual Action Buttons for Quick Viva / Testing */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          <div className="flex flex-wrap items-center gap-2">
            <span>Manual triggers:</span>
            {isHost && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => submitAction("start_game", {})}
              >
                {gameState.phase === "waiting" ? "Start Round" : "Next Round"}
              </Button>
            )}

            {canThrow && (
              <Button size="sm" variant="outline" disabled={busy} onClick={throwStone}>
                Throw Ball (70% Hit)
              </Button>
            )}

            {canRebuild && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => submitAction("rebuild_stone", {})}
              >
                +1 Stone (Manual)
              </Button>
            )}

            {canTag &&
              seekers
                .filter((s) => !tagged.has(s.user_id))
                .slice(0, 2)
                .map((s) => (
                  <Button
                    key={s.user_id}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => submitAction("tag_player", { targetId: s.user_id })}
                  >
                    Tag {profiles[s.user_id] ?? "Seeker"}
                  </Button>
                ))}
          </div>

          <span className="font-mono text-[11px]">
            {busy ? "Submitting hashed action..." : "Cryptographic chain verified"}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-red-300 font-medium">⚠️ {error}</p>}
    </div>
  );
}

function teamLabel(team: Team) {
  return team === "seekers" ? "Seekers" : "Guardians";
}

function TeamRow({
  label,
  color,
  members,
  profiles,
  tagged,
  selfId,
  throwerId,
}: {
  label: string;
  color: string;
  members: RoomMember[];
  profiles: Record<string, string>;
  tagged: Set<string>;
  selfId: string;
  throwerId?: string | null;
}) {
  return (
    <div className="w-full">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider" style={{ color }}>
        {label}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {members.length === 0 && (
          <span className="text-xs text-[var(--muted)]">No players</span>
        )}
        {members.map((m) => {
          const isTagged = tagged.has(m.user_id);
          const isThrower = throwerId === m.user_id;
          return (
            <div
              key={m.user_id}
              className={`rounded-md border px-3 py-2 text-sm ${
                isTagged
                  ? "border-red-800 opacity-50 line-through"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {profiles[m.user_id] ?? m.user_id.slice(0, 6)}
              {m.user_id === selfId && " (you)"}
              {isThrower && " · throwing"}
            </div>
          );
        })}
      </div>
    </div>
  );
}
