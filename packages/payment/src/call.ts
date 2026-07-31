/**
 * How this package reaches the service.
 *
 * @remarks
 * One door out, through `@lamido/api-core`'s `request`, with this package's problem parser bound to
 * it. Two shapes: the plain one, and the one that keeps the status and headers because an idempotent
 * create's *status* is part of its contract.
 */

import { type RequestSpec, type ResolvedConfig, request } from "@lamido/api-core";
import { parsePaymentError } from "./errors.js";

/** A request minus the error parser, which is always this package's. */
export type PaymentRequest = Omit<RequestSpec, "onError">;

/** Options every endpoint accepts. */
export interface RequestOptions {
  /**
   * Passed through to `fetch` intact — `{ signal }` for a deadline, and nothing else in practice.
   *
   * @remarks
   * The SDK sets no timeout of its own. And be careful what a deadline means on `createPayment`:
   * aborting the request does **not** cancel the PSP call it may already have started, so the outcome
   * is unknown and the retry must reuse the same `Idempotency-Key`.
   *
   * **`mode` is never set here.** The service's `Origin` / `Sec-Fetch-Mode` check is a tripwire, not
   * a boundary — `Origin` is trivially forged outside a browser — so there is nothing to satisfy, and
   * `mode: "same-origin"` is a habit worth not carrying between these services.
   */
  readonly init?: RequestInit;
}

/**
 * Make a request, throwing a {@link ./errors.js | PaymentApiError} for any non-2xx.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 */
export function call<T>(cfg: ResolvedConfig, spec: PaymentRequest): Promise<T> {
  return request<T>(cfg, { ...spec, onError: parsePaymentError });
}

/**
 * Make a request and keep the status and headers.
 *
 * @remarks
 * Used by exactly the two idempotent creates. A transport that returned only the body would throw
 * away the one distinction idempotency exists to express: `201` created it, `200` replayed it.
 */
export function callWithMeta<T>(cfg: ResolvedConfig, spec: PaymentRequest) {
  return request<T>(cfg, {
    ...spec,
    read: { ...spec.read, withMeta: true },
    onError: parsePaymentError,
  });
}

/** Forward a caller's `init` without introducing an `init: undefined` key. */
export function passInit(options: RequestOptions): { init?: RequestInit } {
  return options.init ? { init: options.init } : {};
}

/**
 * Whether a create answered with a replay rather than having created something.
 *
 * @param status - The response status.
 * @param headers - The response headers.
 * @remarks
 * Both signals are checked. The status is the contract — `200` is a replay, `201` is new — and the
 * `Idempotent-Replay: true` header says the same thing; reading both means a proxy that rewrites one
 * cannot make a replay look like a fresh charge.
 */
export function isReplay(status: number, headers: Headers): boolean {
  return status === 200 || headers.get("idempotent-replay") === "true";
}
