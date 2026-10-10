/** End-to-end chat encryption via PBKDF2 + AES-GCM (Web Crypto API). */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const PBKDF2_ITERATIONS = 100_000;

export async function deriveChatKey(
  passphrase: string,
  saltHex: string
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
};

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    ciphertext: toHex(ciphertext),
    iv: toHex(iv.buffer),
  };
}

export async function decryptMessage(
  key: CryptoKey,
  ciphertextHex: string,
  ivHex: string
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(ivHex) },
    key,
    fromHex(ciphertextHex)
  );
  return new TextDecoder().decode(plaintext);
}

export { PBKDF2_ITERATIONS };
