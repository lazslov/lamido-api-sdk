/**
 * `@lazslov/payment` — consumer SDK for payment-service's merchant tier.
 *
 * @remarks
 * The package where a bug costs money, so it is the most opinionated of the three. Three things it
 * makes hard on purpose:
 *
 * - **An amount cannot be a number, and cannot skip its currency's exponent.** {@link MinorUnits} is
 *   branded and reachable only through {@link huf}, {@link eurCents} or {@link minorUnits}. HUF is
 *   zero-decimal here: `huf(1000)` is 1000 Ft.
 * - **A create cannot happen without an idempotency key.** There is no overload without one, and
 *   `@lazslov/api-core` will not generate one — a fresh key after an unanswered request is how double
 *   charges happen.
 * - **A 502 is triaged rather than retried.** Its four meanings differ in whether a retry is safe;
 *   {@link ProviderOutcome} says which, and an unrecognised message is `"unclassified"` and not
 *   retryable.
 *
 * This package must never reach a browser bundle: a `pmk_` key is full-merchant authority, and the
 * service rejects any `/v1/*` request carrying an `Origin` header with a `403` before authentication
 * even runs.
 *
 * The admin tier (`pad_`) and the provider callback routes are out of scope — `/v1/providers/*` is
 * inbound PSP traffic, never yours to call.
 *
 * @example
 * ```ts
 * import "server-only";
 * import { createPaymentClient, huf, isFulfillable } from "@lazslov/payment";
 * import { derivedIdempotencyKey } from "@lazslov/api-core";
 *
 * const payments = createPaymentClient();
 *
 * const { payment } = await payments.createPayment(
 *   { merchant_payment_ref: order.id, amount_minor: huf(2500), currency: "HUF" },
 *   derivedIdempotencyKey(`order-${order.id}`, 1),
 * );
 *
 * // …later, on the result page or from a webhook:
 * const settled = await payments.getPayment(payment.public_id);
 * if (isFulfillable(settled.status)) await fulfil(order);
 * ```
 */

export type { PaymentRequest, RequestOptions } from "./call.js";
export { createPaymentClient, type PaymentClient, tryCreatePaymentClient } from "./client.js";
export type { DeliveryListOptions, DeliveryMethods } from "./deliveries.js";
export {
  PaymentApiError,
  type PaymentConflictCode,
} from "./errors.js";
export { eurCents, huf, type MinorUnits, minorUnits } from "./money.js";
export type { PaymentMethods } from "./payments.js";
export { classifyProviderOutcome, type ProviderOutcome } from "./provider-outcome.js";
export {
  type ReconcileOptions,
  type ReconcileResult,
  reconcilePayments,
} from "./reconcile.js";
export type { RefundMethods } from "./refunds.js";
export {
  isFulfillable,
  isTerminal,
  type PaymentStatus,
  type RefundStatus,
} from "./status.js";
export type {
  CreatePaymentInput,
  CreatePaymentResult,
  CreateRefundInput,
  CreateRefundResult,
  Currency,
  Payment,
  PaymentMode,
  Provider,
  Refund,
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "./types.js";
export {
  deliveryIdHeader,
  eventIdHeader,
  isKnownEvent,
  isRefundEvent,
  type KnownPaymentEvent,
  type PaymentEventEnvelope,
  type PaymentEventTenant,
  type PaymentWebhookEvent,
  type PaymentWebhookEventType,
  type PaymentWebhookInput,
  parsePaymentWebhookEvent,
  type RefundEvent,
  signatureHeader,
  timestampHeader,
  verifyPaymentWebhook,
  type WebhookPaymentBlock,
  type WebhookRefundBlock,
} from "./webhook.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that disagrees with
 * the tarball it came from.
 */
export const VERSION = "1.0.0";
