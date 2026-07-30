import { constantTimeEqual, hmacSha256, toHex } from "./crypto.js";

/** Why verification failed. */
export type VerifyFailure =
  /** No signature header, or an empty one. */
  | "missing_signature"
  /** No timestamp header, or one that is not a run of digits. */
  | "malformed_timestamp"
  /** The timestamp is outside the tolerance window, in either direction. */
  | "stale_timestamp"
  /** The signature does not match a digest computed over the raw body. */
  | "bad_signature";

declare const verdictBrand: unique symbol;

/**
 * The outcome of {@link verifySignedBody}.
 *
 * @remarks
 * Branded, so a route handler that expects a verdict cannot be handed a hand-rolled
 * `{ ok: true }`. The only way to obtain one is to run the verifier.
 */
export type VerifyResult = (
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: VerifyFailure }
) & {
  readonly [verdictBrand]: true;
};

/** Inputs to {@link verifySignedBody}. */
export interface VerifySignedBodyInput {
  /** Used whole; the `whsec_` prefix is key material, not a label to strip. */
  readonly secret: string;
  /**
   * The raw request text, exactly as it arrived.
   *
   * @remarks
   * A `string` and not an object on purpose: `JSON.parse` then re-serialise reorders keys and
   * changes whitespace, and the signature stops matching. The type makes the mistake awkward.
   */
  readonly rawBody: string;
  /** The signature header value, e.g. `sha256=…`. */
  readonly signature: string | null;
  /** The timestamp header value, Unix **seconds**, passed through verbatim. */
  readonly timestamp: string | null;
  /** Default 300, which is what both services document. */
  readonly toleranceSeconds?: number;
  /** Injectable so fixtures are deterministic. */
  readonly nowSeconds?: number;
}

/** Both services sign a lowercase hex digest behind this prefix. */
const signaturePrefix = "sha256=";

/** Unix seconds are digits only; a leading zero must survive into the digest. */
const unixSeconds = /^\d+$/;

/** Brand a verdict. The cast is the single place the brand is applied. */
function verdict(result: { ok: true } | { ok: false; reason: VerifyFailure }): VerifyResult {
  return result as VerifyResult;
}

/**
 * Verify a webhook signature from content-service or payment-service.
 *
 * @param input - The secret, the raw body, and the two header values.
 * @returns A branded result. **Never throws** for a verification failure.
 * @remarks
 * Both services use the identical algorithm — HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``,
 * lowercase hex behind a `sha256=` prefix, 300-second tolerance — and differ only in header
 * names, which each service package binds. So there is one verifier here and a thin binding
 * there.
 *
 * Returning a result rather than throwing is deliberate: a thrown error in a verification path
 * tends to get caught upstream and treated as valid by accident.
 *
 * @example
 * ```ts
 * // The shape underneath. Each service package binds its own header names on top, so a
 * // consumer names neither them nor the variable the secret came from.
 * const verdict = await verifySignedBody({
 *   secret: webhookSecret,
 *   rawBody: await request.text(),
 *   signature: request.headers.get(signatureHeader),
 *   timestamp: request.headers.get(timestampHeader),
 * });
 * if (!verdict.ok) return new Response(verdict.reason, { status: 400 });
 * ```
 */
export async function verifySignedBody(input: VerifySignedBodyInput): Promise<VerifyResult> {
  const { secret, rawBody, signature, timestamp } = input;
  const tolerance = input.toleranceSeconds ?? 300;

  if (!signature) return verdict({ ok: false, reason: "missing_signature" });
  if (!timestamp || !unixSeconds.test(timestamp)) {
    return verdict({ ok: false, reason: "malformed_timestamp" });
  }

  // Checked before the digest: the timestamp is inside the signed string precisely so that a
  // captured body cannot replay forever, and skew is the cheaper check.
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > tolerance) {
    return verdict({ ok: false, reason: "stale_timestamp" });
  }

  // The timestamp goes in as the string it arrived as — not Number() re-stringified, which
  // would drop a leading zero and change the digest.
  const expected = signaturePrefix + toHex(await hmacSha256(secret, `${timestamp}.${rawBody}`));

  return (await constantTimeEqual(signature, expected))
    ? verdict({ ok: true })
    : verdict({ ok: false, reason: "bad_signature" });
}
