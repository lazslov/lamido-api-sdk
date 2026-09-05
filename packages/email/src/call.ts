/**
 * How this package reaches the service.
 *
 * @remarks
 * One door out, through `@lazslov/api-core`'s `request`, with this package's problem parser bound to
 * it. Two shapes: the plain one, and the one that keeps the status and headers because the send's
 * *status* is part of its contract — `202` created the message, `200` replayed it.
 */

import { type RequestSpec, type ResolvedConfig, request } from "@lazslov/api-core";
import { parseEmailError } from "./errors.js";

/** A request minus the error parser, which is always this package's. */
export type EmailRequest = Omit<RequestSpec, "onError">;

/** Options every endpoint accepts. */
export interface RequestOptions {
  /**
   * Passed through to `fetch` intact — `{ signal }` for a deadline, and nothing else in practice.
   *
   * @remarks
   * The SDK sets no timeout of its own. Be careful what a deadline means on `sendMessage`: an
   * aborted request has an **unknown** outcome, and the recovery is to resend with the **same**
   * `Idempotency-Key` — you get either the `202` you missed or a replay of it. A new key is how a
   * second email happens.
   *
   * **`mode` is never set here.** The tripwire keys on `Sec-Fetch-Dest`, which a browser attaches
   * and undici does not, so a plain Node `fetch` is unaffected. The `mode: "same-origin"`
   * workaround some integrations carry from invoice-service is obsolete estate-wide.
   *
   * **Never cache these responses.** Pass `{ cache: "no-store" }` on a framework that caches
   * `fetch` by default: a cached `202` returns yesterday's `public_id`.
   */
  readonly init?: RequestInit;
}

/**
 * Make a request, throwing an {@link ./errors.js | EmailApiError} for any non-2xx.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 */
export function call<T>(cfg: ResolvedConfig, spec: EmailRequest): Promise<T> {
  return request<T>(cfg, { ...spec, onError: parseEmailError });
}

/**
 * Make a request and keep the status and headers.
 *
 * @remarks
 * Used by the send alone. A transport that returned only the body would throw away the one
 * distinction idempotency exists to express: `202` queued a new message, `200` replayed one.
 */
export function callWithMeta<T>(cfg: ResolvedConfig, spec: EmailRequest) {
  return request<T>(cfg, {
    ...spec,
    read: { ...spec.read, withMeta: true },
    onError: parseEmailError,
  });
}

/** Forward a caller's `init` without introducing an `init: undefined` key. */
export function passInit(options: RequestOptions): { init?: RequestInit } {
  return options.init ? { init: options.init } : {};
}

/** One message's path, with the id encoded. */
export function messagePath(publicId: string): string {
  return `/v1/messages/${encodeURIComponent(publicId)}`;
}

/**
 * Whether a send answered with a replay rather than having queued something.
 *
 * @param status - The response status.
 * @param headers - The response headers.
 * @remarks
 * Both signals are checked. The status is the contract — `200` is a replay, `202` is new — and
 * the `Idempotent-Replay: true` header says the same thing; reading both means a proxy that
 * rewrites one cannot make a replay look like a fresh send.
 */
export function isReplay(status: number, headers: Headers): boolean {
  return status === 200 || headers.get("idempotent-replay") === "true";
}
