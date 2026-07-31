/**
 * The payment lifecycle, and the two decisions a consumer makes from it.
 *
 * @remarks
 * The canonical statuses are identical across providers, which is the whole point of the service:
 * **branch on `status`, never on `provider`**. `provider_status` is the PSP's own word verbatim —
 * `"Succeeded"`, `"complete/paid→pi:succeeded"` — and is exposed so an unmapped status is still
 * actionable by a human, not so control flow can read it.
 */

import type { components } from "./generated/schema.js";

/**
 * The canonical payment lifecycle.
 *
 * @remarks
 * `initializing` is internal — the operation is reserved and the PSP has not answered — and
 * `authorized` exists because Stripe can produce it, not because an auth/capture split is driven.
 * `partially_refunded` and `refunded` come from the service's own refunds ledger and never from a
 * provider status: Barion still reports `Succeeded` after a full refund.
 */
export type PaymentStatus = components["schemas"]["PaymentStatus"];

/** A refund's own lifecycle. `canceled` means a reservation was released, not that money moved. */
export type RefundStatus = components["schemas"]["RefundStatus"];

/**
 * Whether this status means an order may be fulfilled.
 *
 * @param status - The payment's canonical status.
 * @returns `true` only for `succeeded`.
 * @remarks
 * **Never fulfil on `pending`** — it means the buyer has been sent to a gateway and nothing more.
 * `authorized` is excluded too: funds are held, not captured, and there is no capture step in this
 * service to make them move.
 *
 * `partially_refunded` and `refunded` are also `false`, and that is not a claim that the payment
 * was never paid. It is that fulfilment is a decision made once, when the payment first succeeded;
 * asking this predicate again after money has come back is asking the wrong question. What to do
 * about a refund is a question for the refunds ledger.
 *
 * @example
 * ```ts
 * if (isFulfillable(payment.status)) await fulfil(order);
 * ```
 */
export function isFulfillable(status: PaymentStatus): boolean {
  return status === "succeeded";
}

/**
 * Whether no further transition is possible.
 *
 * @param status - The payment's canonical status.
 * @returns `true` for `failed`, `canceled`, `expired` and `refunded`.
 * @remarks
 * For the reconciliation loop, which must stop once a payment is terminal — a settled payment
 * refreshed again is a PSP round trip that can only return the same answer.
 *
 * `succeeded` is **not** terminal: a refund can still move it. Terminal here means terminal in the
 * service too — `expired → succeeded` is refused rather than written, because neither PSP can
 * legitimately produce that transition and the alarm is worth more than the write.
 */
export function isTerminal(status: PaymentStatus): boolean {
  return (
    status === "failed" || status === "canceled" || status === "expired" || status === "refunded"
  );
}
