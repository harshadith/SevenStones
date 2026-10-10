import { generateInviteCode, randomHex, sha256 } from "@/lib/crypto/hash";

const PASSPHRASE_STORAGE_PREFIX = "ss_room_passphrase:";

export async function prepareCreateSecrets(passphrase: string) {
  const inviteCode = generateInviteCode(6);
  const salt = randomHex(16);
  const inviteCodeHash = await sha256(inviteCode.toUpperCase());
  const passphraseHash = await sha256(`${passphrase}:${salt}`);
  return { inviteCode, salt, inviteCodeHash, passphraseHash };
}

export async function prepareJoinSecrets(
  inviteCode: string,
  passphrase: string,
  salt: string
) {
  const inviteCodeHash = await sha256(inviteCode.toUpperCase());
  const passphraseHash = await sha256(`${passphrase}:${salt}`);
  return { inviteCodeHash, passphraseHash };
}

export function storeRoomPassphrase(roomId: string, passphrase: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`${PASSPHRASE_STORAGE_PREFIX}${roomId}`, passphrase);
}

export function loadRoomPassphrase(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(`${PASSPHRASE_STORAGE_PREFIX}${roomId}`);
}

export function clearRoomPassphrase(roomId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(`${PASSPHRASE_STORAGE_PREFIX}${roomId}`);
}
