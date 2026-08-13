/**
 * Refunds — the endpoints that move money back out.
 *
 * @remarks
 * **`createRefund` moves real money and there is no confirmation step.** The API is
 * server-to-server, so your own backend owns the "are you sure" UX; nothing here asks.
 */

import type { IdempotencyKey, ResolvedConfig } from "@lazslov/api-core";
import { call, callWithMeta, isReplay, passInit, type RequestOptions } from "./call.js";
import type { CreateRefundInput, CreateRefundResult, Refund } from "./types.js";

/** The refund half of a merchant client. */
export interface RefundMethods {
  /**
   * Refund a payment, in whole or in part.
   *
   * @param publicId - The payment's `public_id`.
   * @param body - The amount, the payment's currency, and optionally a reason for your records.
   * @param key - **Required**, and derived from the operation: `refund-order-12345-partial-1`.
   * @param options - `init` only.
   * @returns The refund, and whether this was a replay.
   * @throws {@link ./errors.js | PaymentApiError}. A `422` carries `code` and **is retryable
   * later** — all four causes describe the *payment's* state, which changes. A `502` whose
   * `providerOutcome` is `"refund_unknown"` must **not** be retried: the reservation stays held
   * deliberately, and only the service's reconciler may resolve it. Read the refund again in a minute.
   * @remarks
   * Take `amount_minor` from what the API reports as remaining, not from your own bookkeeping. There
   * is no "refund the rest" default, because a default would refund different amounts depending on
   * when the request arrived. The remaining balance is enforced by two database CHECK constraints
   * rather than by an `if`, so two concurrent refunds cannot together exceed the payment — the loser
   * gets `refund_exceeds_remaining`, and any pre-check you build is advisory.
   *
   * A refund key lives 24 hours, unlike a payment key's 7 days.
   *
   * **Never re-issue a refund under a new key because the first did not answer.** Barion accepts no
   * idempotency key at all, so a blind retry is a second refund.
   */
  createRefund(
    publicId: string,
    body: CreateRefundInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<CreateRefundResult>;

  /**
   * Every refund of one payment, oldest first.
   *
   * @remarks
   * Not paginated — the service's refund cap bounds it, which is why `collectAll` is not re-exported
   * from this package.
   */
  listRefunds(publicId: string, options?: RequestOptions): Promise<Refund[]>;

  /**
   * Read one refund.
   *
   * @param publicId - The **refund's** `public_id`, not the payment's.
   * @remarks
   * This is the call to make when chasing an `outcome_unknown: true`: reading a refund whose outcome is
   * unknown reconciles it, which may make one provider call. That reconciliation cannot fail the read.
   */
  getRefund(publicId: string, options?: RequestOptions): Promise<Refund>;
}

/**
 * Bind the refund methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindRefundMethods(cfg: ResolvedConfig): RefundMethods {
  const refundsOf = (publicId: string) => `/v1/payments/${encodeURIComponent(publicId)}/refunds`;

  return {
    async createRefund(publicId, body, key, options = {}) {
      const answer = await callWithMeta<Refund>(cfg, {
        method: "POST",
        path: refundsOf(publicId),
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { refund: answer.value, replayed: isReplay(answer.status, answer.headers) };
    },

    listRefunds: (publicId, options = {}) =>
      call<Refund[]>(cfg, {
        method: "GET",
        path: refundsOf(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getRefund: (publicId, options = {}) =>
      call<Refund>(cfg, {
        method: "GET",
        path: `/v1/refunds/${encodeURIComponent(publicId)}`,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
