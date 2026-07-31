/**
 * `/v1/payments` — create, read, refresh.
 *
 * @remarks
 * Three endpoints, and the differences between them matter: `createPayment` calls the PSP and is the
 * one call with real latency, `getPayment` is what a result page makes, and `refreshPayment` is
 * reconciliation rather than polling and is throttled to say so.
 */

import type { IdempotencyKey, ResolvedConfig } from "@lamido/api-core";
import { call, callWithMeta, isReplay, passInit, type RequestOptions } from "./call.js";
import type { CreatePaymentInput, CreatePaymentResult, Payment } from "./types.js";

/** The payment half of a merchant client. */
export interface PaymentMethods {
  /**
   * Create a payment and get a `gateway_url` to send the buyer to.
   *
   * @param body - The order reference, the amount, the currency, and optionally the provider.
   * @param key - **Required.** Derive it from the operation, never from the clock:
   * `derivedIdempotencyKey("order-12345", 1)`, not `crypto.randomUUID()`.
   * @param options - `init` only.
   * @returns The payment, and whether this was a replay.
   * @throws {@link ./errors.js | PaymentApiError}. Read `providerOutcome` before retrying a 502 —
   * *"the provider could not be reached"* is not *"it failed"*, and a **new** key after an unanswered
   * request is how double charges happen: Barion does not deduplicate on its own request id.
   * @remarks
   * The one endpoint with real latency, because it calls the PSP. `gateway_url` may be `null`, which
   * means no gateway exists yet — **do not redirect** to it.
   *
   * There is no overload without a key. A payment key lives 7 days; after that it is free, and
   * reusing it starts a genuinely new operation.
   *
   * @example
   * ```ts
   * const { payment, replayed } = await payments.createPayment(
   *   {
   *     merchant_payment_ref: order.id,
   *     amount_minor: huf(2500),   // 2500 Ft — HUF is zero-decimal here
   *     currency: "HUF",
   *   },
   *   derivedIdempotencyKey(`order-${order.id}`, 1),
   * );
   * if (!replayed) await store(payment.public_id);
   * redirect(payment.gateway_url!);
   * ```
   */
  createPayment(
    body: CreatePaymentInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<CreatePaymentResult>;

  /**
   * Read one payment.
   *
   * @param publicId - The payment's `public_id` (a UUIDv7). A malformed id is a `400` about the id.
   * @throws {@link ./errors.js | PaymentApiError} on a `404` — **never `null`**. Every read is scoped
   * to the key's merchant inside the same SQL predicate that fetches the row, so another merchant's id
   * is indistinguishable from one that does not exist, and the error says so. A payment id you hold
   * came from a payment you created, so "not found" is a bug — often a deployment holding the wrong
   * key.
   * @remarks
   * The call a result page makes. It has one side effect: a payment past its `expires_at` and still
   * open is lazily checked with the PSP once and may transition to `expired`. That check can never
   * fail the read — an unreachable PSP means you get the payment exactly as it was.
   */
  getPayment(publicId: string, options?: RequestOptions): Promise<Payment>;

  /**
   * Force a re-read of the PSP's state.
   *
   * @throws {@link ./errors.js | PaymentApiError} with `retryAfterSeconds` on a `429`.
   * @remarks
   * **This is reconciliation, not polling.** Throttled to one call per payment per 5 seconds; a second
   * call inside the window is a `429` that makes **no** provider call. `last_refreshed_at` is written
   * *before* the provider call, so a failed refresh consumes the window too — which is the right way
   * round, because it stops a retry loop hammering a PSP that is timing out.
   *
   * A payment already in a terminal status returns immediately without contacting the PSP. Use
   * {@link ./status.js | isTerminal} and do not ask at all.
   */
  refreshPayment(publicId: string, options?: RequestOptions): Promise<Payment>;
}

/**
 * Bind the payment methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindPaymentMethods(cfg: ResolvedConfig): PaymentMethods {
  const payment = (publicId: string) => `/v1/payments/${encodeURIComponent(publicId)}`;

  return {
    async createPayment(body, key, options = {}) {
      const answer = await callWithMeta<Payment>(cfg, {
        method: "POST",
        path: "/v1/payments",
        // Passed through as given. Nothing here reorders, dedupes or normalises anything: the
        // idempotency hash sorts object keys for you, but ARRAY ORDER IS SIGNIFICANT, so a helpful
        // tidy-up would turn a replay into a conflict.
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { payment: answer.value, replayed: isReplay(answer.status, answer.headers) };
    },

    getPayment: (publicId, options = {}) =>
      call<Payment>(cfg, {
        method: "GET",
        path: payment(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    refreshPayment: (publicId, options = {}) =>
      call<Payment>(cfg, {
        method: "POST",
        path: `${payment(publicId)}/refresh`,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
