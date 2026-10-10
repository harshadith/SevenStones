import {
  computeActionHash,
  GENESIS_HASH,
  type HashableAction,
} from "@/lib/crypto/hash";
import type { GameAction } from "@/lib/supabase/database.types";

export type VerifyResult = {
  valid: boolean;
  checked: number;
  failedAt: number | null;
  expectedHash: string | null;
  actualHash: string | null;
  message: string;
};

export async function verifyActionChain(
  roomId: string,
  actions: GameAction[]
): Promise<VerifyResult> {
  const sorted = [...actions].sort((a, b) => a.seq - b.seq);

  if (sorted.length === 0) {
    return {
      valid: true,
      checked: 0,
      failedAt: null,
      expectedHash: null,
      actualHash: null,
      message: "No actions yet — chain is empty (genesis).",
    };
  }

  let prevHash = GENESIS_HASH;

  for (const action of sorted) {
    if (action.prev_hash !== prevHash) {
      return {
        valid: false,
        checked: action.seq,
        failedAt: action.seq,
        expectedHash: prevHash,
        actualHash: action.prev_hash,
        message: `Prev-hash mismatch at seq ${action.seq}.`,
      };
    }

    const material: HashableAction = {
      roomId,
      seq: action.seq,
      actorId: action.actor_id,
      actionType: action.action_type,
      payload: action.payload,
      prevHash: action.prev_hash,
      nonce: action.nonce,
    };

    const expected = await computeActionHash(material);
    if (expected !== action.action_hash) {
      return {
        valid: false,
        checked: action.seq,
        failedAt: action.seq,
        expectedHash: expected,
        actualHash: action.action_hash,
        message: `Action hash mismatch at seq ${action.seq} — possible tampering.`,
      };
    }

    prevHash = action.action_hash;
  }

  return {
    valid: true,
    checked: sorted.length,
    failedAt: null,
    expectedHash: null,
    actualHash: null,
    message: `Verified ${sorted.length} action(s). Hash chain intact.`,
  };
}

/** Build a locally tampered copy for the academic demo (does not write to DB). */
export function simulateTamper(actions: GameAction[]): GameAction[] {
  if (actions.length === 0) return actions;
  const copy = actions.map((a) => ({ ...a, payload: { ...((a.payload as object) ?? {}) } }));
  const target = copy[Math.floor(copy.length / 2)] ?? copy[0];
  const payload =
    typeof target.payload === "object" && target.payload !== null
      ? { ...(target.payload as Record<string, unknown>) }
      : {};
  payload.__tampered = true;
  target.payload = payload;
  // Leave action_hash unchanged so verification fails
  return copy;
}
