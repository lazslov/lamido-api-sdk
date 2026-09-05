/**
 * The order lifecycle, and the two decisions a storefront makes from it.
 *
 * @remarks
 * Seven statuses, and only two of them are reachable by a call a consumer makes: `pending` from
 * checkout and `canceled` from a cancel. `paid`, `confirmed` and `refunded` arrive exclusively from
 * payment-service, asynchronously, through the service's inbound receiver or its daily reconcile poll.
 * `fulfilled` is an operator's action.
 */

import type { components } from "./generated/schema.js";

/**
 * The seven statuses the service documents today.
 *
 * @remarks
 * `canceled` has one `l` — the estate's spelling. This is the closed set; use it for the `status`
 * filter on a listing, where an unknown value is a `400`.
 */
export type KnownOrderStatus = components["schemas"]["OrderStatus"];

/**
 * An order's status as it arrives on the wire.
 *
 * @remarks
 * Wider than {@link KnownOrderStatus} on purpose. The knowledge base says: *"do not hard-code the
 * reachable set. Treat any status you do not recognise as 'in progress, do not act'."* `string & {}`
 * keeps the seven literals in autocompletion while still accepting an eighth added upstream after
 * this SDK shipped — and both predicates below answer `false` for it, which is exactly that rule.
 */
export type OrderStatus = KnownOrderStatus | (string & Record<never, never>);

/**
 * Whether this status means the money landed and the stock was committed.
 *
 * @param status - The order's status.
 * @returns `true` for `confirmed` and `fulfilled`.
 * @remarks
 * **Never act on `pending`** — the checkout's `201` is not a paid order, and `gateway_url` is not
 * proof of payment. **And never wait for `paid`.** It is a step inside one transaction: the
 * payment-success handler moves `pending → paid`, commits the stock, and moves `paid → confirmed`
 * before it commits, so a poller almost never observes it. The knowledge base's rule is *"wait for
 * `confirmed`"*, and this predicate is that rule.
 *
 * `fulfilled` is included because an operator may have moved the order on before your poll ran, and
 * a fulfilled order was confirmed. `refunded` is excluded: money came back, and asking whether to act
 * on a fresh confirmation is the wrong question for it.
 *
 * @example
 * ```ts
 * const order = await shop.getOrder(publicId);
 * if (isConfirmed(order.status)) await sendConfirmationEmail(order);
 * ```
 */
export function isConfirmed(status: OrderStatus): boolean {
  return status === "confirmed" || status === "fulfilled";
}

/**
 * Whether no further transition is possible.
 *
 * @param status - The order's status.
 * @returns `true` for `fulfilled`, `canceled` and `refunded`.
 * @remarks
 * The same three states the service refuses to move with `422 order_terminal`. For a reconciliation
 * poll, which must stop asking about an order that can only answer the same thing again.
 *
 * `confirmed` is **not** terminal: an operator can still fulfil it, and payment-service can still
 * refund it.
 */
export function isTerminal(status: OrderStatus): boolean {
  return status === "fulfilled" || status === "canceled" || status === "refunded";
}
