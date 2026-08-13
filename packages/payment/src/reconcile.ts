/**
 * The reconciliation backstop.
 *
 * @remarks
 * Webhooks plus the redirect cover almost everything. The gap is a buyer who closes the tab *and* an
 * endpoint that was down during the inline attempts — and because the retry intervals are **floors,
 * not promises** (a delivery becomes eligible at its next attempt time and is then attempted by the
 * next sweep, which can be hours later), nothing may assume a webhook arrives within a bounded time.
 *
 * **Let this be the thing you trust, not the delivery schedule.**
 *
 * The service's docs publish this loop, so the SDK ships it: every site needs the identical thing, and
 * the part that is easy to get wrong — the throttle discipline — is the part that is identical
 * everywhere. What it deliberately does **not** own is scheduling, storage, or the "orders awaiting
 * payment older than N minutes" query. Those are the site's.
 */

import type { PaymentClient } from "./client.js";
import { PaymentApiError } from "./errors.js";
import { isTerminal } from "./status.js";
import type { Payment } from "./types.js";

/** What to reconcile, and what to do with each answer. */
export interface ReconcileOptions {
  /** The payments to check — typically the ids of orders still awaiting payment. */
  readonly publicIds: readonly string[];
  /**
   * Called once per payment with the freshest state available.
   *
   * @remarks
   * Called for a terminal payment too, so a site that missed the webhook still learns the outcome; it
   * is simply not refreshed first. Not called when the read itself failed — the error is reported in
   * the result instead.
   *
   * If this throws, the id is recorded as failed and the sweep continues: one broken order must not
   * abandon the rest.
   */
  onStatus(publicId: string, payment: Payment): Promise<void> | void;
}

/** What happened to one id. */
export interface ReconcileResult {
  readonly publicId: string;
  /** The payment as last read. Absent only when the read itself failed. */
  readonly payment?: Payment;
  /** Whether a refresh was actually made — `false` for a terminal payment, or a throttled one. */
  readonly refreshed: boolean;
  /**
   * Seconds to wait before refreshing **this** payment again.
   *
   * @remarks
   * Set when the refresh was throttled. Surfaced rather than swallowed, and deliberately **not**
   * retried here: a failed refresh consumes the throttle window too, so a helper that slept and
   * retried would be the loop the throttle exists to prevent.
   */
  readonly retryAfter?: number;
  /** The error that stopped this id. The other ids still ran. */
  readonly error?: unknown;
}

/**
 * Read, refresh where needed, and report — one payment at a time.
 *
 * @param client - A merchant client.
 * @param options - The ids, and what to do with each answer.
 * @returns One result per id, in the order given.
 * @remarks
 * The discipline this encodes, in order:
 *
 * 1. **Serialised per id.** The refresh throttle is per payment, so nothing is gained by running two
 *    checks of the same payment concurrently, and a sweep that fired every id at once would be a
 *    burst against the PSP through the service.
 * 2. **A terminal payment is never refreshed.** `isTerminal` is checked first — refreshing a settled
 *    payment is a PSP round trip that can only return the same answer.
 * 3. **Only `pending` is refreshed.** That is the status the loop exists for: the buyer has a gateway
 *    URL and nothing else is known.
 * 4. **A 429 is reported, not retried.** `retryAfter` comes back in the result so the caller's
 *    scheduler can decide, which is where that decision belongs.
 *
 * Returns a report rather than nothing, because a `void` return cannot surface a throttle — and a
 * swallowed `retry_after` is how a reconciler turns into a poller.
 *
 * @example
 * ```ts
 * const results = await reconcilePayments(payments, {
 *   publicIds: orders.map((order) => order.paymentPublicId),
 *   onStatus: (publicId, payment) => applyPaymentStatus(publicId, payment.status),
 * });
 * for (const result of results) {
 *   if (result.retryAfter) scheduleRecheck(result.publicId, result.retryAfter);
 * }
 * ```
 */
export async function reconcilePayments(
  client: PaymentClient,
  options: ReconcileOptions,
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];

  for (const publicId of options.publicIds) {
    results.push(await reconcileOne(client, publicId, options.onStatus));
  }

  return results;
}

/** One id's turn. Never throws: a broken order must not abandon the sweep. */
async function reconcileOne(
  client: PaymentClient,
  publicId: string,
  onStatus: ReconcileOptions["onStatus"],
): Promise<ReconcileResult> {
  let payment: Payment;
  try {
    payment = await client.getPayment(publicId);
  } catch (error) {
    return { publicId, refreshed: false, error };
  }

  // Only `pending` is refreshed. A terminal payment can only answer the same thing again, and every
  // other open status is one the PSP has already reported — `pending` is the one where the buyer has a
  // gateway URL and nothing further is known.
  if (isTerminal(payment.status) || payment.status !== "pending") {
    return await report(publicId, payment, onStatus);
  }

  try {
    const refreshed = await client.refreshPayment(publicId);
    return { ...(await report(publicId, refreshed, onStatus)), refreshed: true };
  } catch (error) {
    // A throttled refresh is not a failure of the sweep: the payment we already read is still the
    // freshest thing anyone has, so hand it over and say when to ask again.
    if (error instanceof PaymentApiError && error.status === 429) {
      return {
        ...(await report(publicId, payment, onStatus)),
        refreshed: false,
        ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
      };
    }
    return { publicId, payment, refreshed: false, error };
  }
}

/** Hand one payment to the caller, keeping a thrown callback from ending the sweep. */
async function report(
  publicId: string,
  payment: Payment,
  onStatus: ReconcileOptions["onStatus"],
): Promise<ReconcileResult> {
  try {
    await onStatus(publicId, payment);
    return { publicId, payment, refreshed: false };
  } catch (error) {
    return { publicId, payment, refreshed: false, error };
  }
}
