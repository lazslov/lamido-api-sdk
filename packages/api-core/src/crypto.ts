/**
 * HMAC primitives built only on `globalThis.crypto.subtle`.
 *
 * @remarks
 * Deliberately no `node:crypto`. `timingSafeEqual` throws on a length mismatch and does not
 * exist on edge runtimes, so the same source has to run on Node 18+ and on an edge worker.
 */

const encoder = new TextEncoder();

/** The Web Crypto implementation, or a clear failure rather than a `TypeError` on `undefined`. */
function subtle(): SubtleCrypto {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle) {
    throw new Error(
      "globalThis.crypto.subtle is unavailable. @lazslov/api-core needs Web Crypto: Node 18.17+ or a modern edge runtime.",
    );
  }
  return webCrypto.subtle;
}

/** Import raw key bytes for HMAC-SHA256. */
async function importHmacKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return await subtle().importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** HMAC-SHA256 over raw bytes. */
async function hmacBytes(keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const key = await importHmacKey(keyBytes);
  const signature = await subtle().sign("HMAC", key, message as unknown as ArrayBuffer);
  return new Uint8Array(signature);
}

/**
 * HMAC-SHA256 of a message under a string secret, both encoded as UTF-8.
 *
 * @param secret - Used **whole**. The `whsec_` prefix is key material, not a label to strip.
 * @param message - The signed string, e.g. `` `${timestamp}.${rawBody}` ``.
 */
export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  return await hmacBytes(encoder.encode(secret), encoder.encode(message));
}

/** Lowercase hex, which is the encoding both services' signature headers use. */
export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Compare two strings without leaking where they differ, via double-HMAC.
 *
 * @param a - One value, typically the signature presented by the caller.
 * @param b - The other, typically the signature we computed.
 * @returns Whether they are identical.
 * @remarks
 * A fresh random 32-byte key is generated per call and both inputs are HMAC'd under it, then
 * the digests are compared byte by byte. The digests are equal-length by construction, so
 * there is no length-mismatch throw and no early return on the first differing byte; and a
 * comparison of two values an attacker cannot predict reveals nothing about the secret. This
 * is the portable stand-in for `node:crypto.timingSafeEqual`.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const blindingKey = new Uint8Array(32);
  globalThis.crypto.getRandomValues(blindingKey);

  const [digestA, digestB] = await Promise.all([
    hmacBytes(blindingKey, encoder.encode(a)),
    hmacBytes(blindingKey, encoder.encode(b)),
  ]);

  let difference = 0;
  for (let index = 0; index < digestA.length; index += 1) {
    // Bitwise, accumulated: no branch, and every byte is always examined.
    difference |= (digestA[index] as number) ^ (digestB[index] as number);
  }
  return difference === 0;
}
