import type { GamePhase, Team } from "@/lib/supabase/database.types";
import { GENESIS_HASH } from "@/lib/crypto/hash";

export const MAX_STACK = 7;

export type GameActionType =
  | "start_game"
  | "throw"
  | "rebuild_stone"
  | "tag_player";

export type LocalGameState = {
  phase: GamePhase;
  stackHeight: number;
  seekersScore: number;
  guardiansScore: number;
  throwerId: string | null;
  taggedSeekers: string[];
  lastHash: string;
  actionSeq: number;
};

export function initialGameState(): LocalGameState {
  return {
    phase: "waiting",
    stackHeight: MAX_STACK,
    seekersScore: 0,
    guardiansScore: 0,
    throwerId: null,
    taggedSeekers: [],
    lastHash: GENESIS_HASH,
    actionSeq: 0,
  };
}

export type ActionPayload =
  | { type: "start_game" }
  | { type: "throw"; hit: boolean }
  | { type: "rebuild_stone" }
  | { type: "tag_player"; targetId: string };

export function applyAction(
  state: LocalGameState,
  actionType: GameActionType,
  payload: Record<string, unknown>,
  actorId: string,
  members: { user_id: string; team: Team }[],
  nextHash: string,
  nextSeq: number
): LocalGameState {
  const next = { ...state, lastHash: nextHash, actionSeq: nextSeq };

  switch (actionType) {
    case "start_game": {
      const seekers = members.filter((m) => m.team === "seekers");
      return {
        ...next,
        phase: "throwing",
        stackHeight: MAX_STACK,
        taggedSeekers: [],
        throwerId: seekers[0]?.user_id ?? actorId,
      };
    }
    case "throw": {
      if (state.phase !== "throwing") return next;
      const hit = Boolean(payload.hit);
      if (hit) {
        return {
          ...next,
          phase: "broken",
          stackHeight: 0,
        };
      }
      // Miss: rotate thrower among seekers
      const seekers = members
        .filter((m) => m.team === "seekers")
        .map((m) => m.user_id);
      const idx = seekers.indexOf(state.throwerId ?? "");
      const nextThrower = seekers[(idx + 1) % Math.max(seekers.length, 1)] ?? actorId;
      return { ...next, throwerId: nextThrower };
    }
    case "rebuild_stone": {
      if (state.phase !== "broken" && state.phase !== "rebuild") return next;
      const height = Math.min(state.stackHeight + 1, MAX_STACK);
      if (height >= MAX_STACK) {
        return {
          ...next,
          phase: "seekers_win",
          stackHeight: MAX_STACK,
          seekersScore: state.seekersScore + 1,
        };
      }
      return {
        ...next,
        phase: "rebuild",
        stackHeight: height,
      };
    }
    case "tag_player": {
      if (state.phase !== "broken" && state.phase !== "rebuild") return next;
      const targetId = String(payload.targetId ?? "");
      const target = members.find((m) => m.user_id === targetId);
      if (!target || target.team !== "seekers") return next;
      if (state.taggedSeekers.includes(targetId)) return next;
      const tagged = [...state.taggedSeekers, targetId];
      const seekerCount = members.filter((m) => m.team === "seekers").length;
      if (tagged.length >= seekerCount && seekerCount > 0) {
        return {
          ...next,
          phase: "guardians_win",
          taggedSeekers: tagged,
          guardiansScore: state.guardiansScore + 1,
        };
      }
      return { ...next, taggedSeekers: tagged };
    }
    default:
      return next;
  }
}

export function phaseLabel(phase: GamePhase): string {
  switch (phase) {
    case "waiting":
      return "Waiting to start";
    case "throwing":
      return "Throwing at the stack";
    case "broken":
      return "Stack broken — rebuild or tag!";
    case "rebuild":
      return "Rebuilding the stack";
    case "seekers_win":
      return "Seekers win the round";
    case "guardians_win":
      return "Guardians win the round";
    default:
      return phase;
  }
}
