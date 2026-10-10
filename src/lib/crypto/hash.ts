/** SHA-256 helpers using the Web Crypto API (browser + Edge). */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateInviteCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join("");
}

/** Canonical JSON for deterministic hashing (sorted object keys). */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

export const GENESIS_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export type HashableAction = {
  roomId: string;
  seq: number;
  actorId: string;
  actionType: string;
  payload: unknown;
  prevHash: string;
  nonce: string;
};

export async function computeActionHash(action: HashableAction): Promise<string> {
  const material = [
    action.prevHash,
    String(action.seq),
    action.actorId,
    action.actionType,
    canonicalJSON(action.payload),
    action.nonce,
  ].join("|");
  return sha256(material);
}
