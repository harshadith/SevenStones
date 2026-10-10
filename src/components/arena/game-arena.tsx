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
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{phaseLabel(gameState.phase)}</Badge>
        <span className="text-sm text-[var(--muted)]">
          Seekers {gameState.seekers_score} — Guardians {gameState.guardians_score}
        </span>
        <span className="font-mono text-xs text-[var(--muted)]">
          seq {gameState.action_seq} · hash {gameState.last_hash.slice(0, 12)}…
        </span>
      </div>

      <div className="arena-grid relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]/60 p-6">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-8">
          <TeamRow
            label="Guardians"
            color="var(--guardian)"
            members={guardians}
            profiles={profiles}
            tagged={tagged}
            selfId={userId}
          />

          <div className="flex flex-col items-center">
            <p className="mb-2 text-xs uppercase tracking-wider text-[var(--muted)]">
              Stone stack ({gameState.stack_height}/{MAX_STACK})
            </p>
            <div className="stone-stack min-h-[140px] justify-end">
              {Array.from({ length: gameState.stack_height }).map((_, i) => (
                <div
                  key={i}
                  className="stone"
                  style={{ width: `${48 + (i % 3) * 6}px` }}
                />
              ))}
              {gameState.stack_height === 0 && (
                <p className="text-sm text-[var(--accent)]">Stack broken!</p>
              )}
            </div>
          </div>

          <TeamRow
            label="Seekers"
            color="var(--seeker)"
            members={seekers}
            profiles={profiles}
            tagged={tagged}
            selfId={userId}
            throwerId={gameState.thrower_id}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isHost &&
          (gameState.phase === "waiting" ||
            gameState.phase === "seekers_win" ||
            gameState.phase === "guardians_win") && (
            <Button
              disabled={busy || members.length < 2}
              onClick={() => submitAction("start_game", {})}
            >
              {gameState.phase === "waiting" ? "Start game" : "Next round"}
            </Button>
          )}

        {canThrow && (
          <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Aim
              <input
                type="range"
                min={0}
                max={100}
                value={aim}
                onChange={(e) => setAim(Number(e.target.value))}
                className="w-40"
              />
            </label>
            <Button disabled={busy} onClick={throwStone}>
              Throw
            </Button>
          </div>
        )}

        {canRebuild && (
          <Button
            disabled={busy}
            onClick={() => submitAction("rebuild_stone", {})}
          >
            Place a stone
          </Button>
        )}

        {canTag &&
          seekers
            .filter((s) => !tagged.has(s.user_id))
            .map((s) => (
              <Button
                key={s.user_id}
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  submitAction("tag_player", { targetId: s.user_id })
                }
              >
                Tag {profiles[s.user_id] ?? "seeker"}
              </Button>
            ))}
      </div>

      {myTeam && (
        <p className="text-sm text-[var(--muted)]">
          You are on{" "}
          <span
            style={{
              color: myTeam === "seekers" ? "var(--seeker)" : "var(--guardian)",
            }}
          >
            {teamLabel(myTeam)}
          </span>
          .
        </p>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
      {members.length < 2 && gameState.phase === "waiting" && (
        <p className="text-sm text-[var(--muted)]">
          Need at least 2 players to start.
        </p>
      )}
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
