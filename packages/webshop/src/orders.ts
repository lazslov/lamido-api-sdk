/**
 * `/v1/orders` — reading and cancelling.
 *
 * @remarks
 * An order is immutable history. No read joins the live catalog, so raising a variant's price
 * tomorrow changes no order written today. What *does* change is `status`, and nothing a consumer
 * calls moves it forward — `paid`, `confirmed` and `refunded` arrive from payment-service,
 * asynchronously.
 */

import type { CursorPage, ResolvedConfig } from "@lazslov/api-core";
import {
  type CursorListOptions,
  call,
  callCursorList,
  passInit,
  type RequestOptions,
} from "./call.js";
import type { KnownOrderStatus } from "./status.js";
import type { Order } from "./types.js";

/** Which orders to list. */
export interface OrderListOptions extends CursorListOptions {
  /** One of the seven statuses. **An unknown value is a `400`**, not an unfiltered list. */
  readonly status?: KnownOrderStatus;
  /**
   * **Inclusive** lower bound on `created_at`.
   *
   * @remarks
   * **Strict ISO 8601.** Exactly two shapes are accepted: a full instant with an offset
   * (`2026-08-01T00:00:00Z`) or a bare calendar date (`2026-08-01`, read as UTC midnight). `2026`
   * and `March 5 2026` are a `400` with pointer `#/query/from` — they used to be a silently widened
   * window. Passed through untouched, because the service is strict and a local guess would not be.
   */
  readonly from?: string;
  /** **Exclusive** upper bound on `created_at`. Same parser as `from`. */
  readonly until?: string;
}

/** The order part of a storefront client. */
export interface OrderMethods {
  /**
   * A page of this shop's orders, newest first, each with its full `items` array.
   *
   * @remarks
   * Both date filters test `created_at`, not `updated_at` — "orders in March" means orders *placed*
   * in March. Follow `nextCursor` to the end, or hand this to core's `collectAllCursor`.
   *
   * This is also the reconciliation poll the knowledge base tells you to keep: the webhook retry
   * ladder is published in minutes and delivered in days, so subscribe to events **and** poll.
   */
  listOrders(options?: OrderListOptions): Promise<CursorPage<Order>>;

  /**
   * One order.
   *
   * @throws {@link ./errors.js | WebshopApiError} on a `404` — **never `null`**. Another shop's order
   * and a malformed id both read as `404`, and an order id you hold came from a checkout you made.
   * @remarks
   * The call a "thank you" page makes while it waits for `confirmed`. `payment_ref` is here;
   * the `payment` block is not — it exists only on the checkout response.
   */
  getOrder(publicId: string, options?: RequestOptions): Promise<Order>;

  /**
   * Cancel a `pending` or `payment_failed` order.
   *
   * @returns The order with `status: "canceled"`.
   * @remarks
   * No body and no `Idempotency-Key`. The reservation goes back in the **same transaction** as the
   * status change, so a canceled order never keeps a shop's last unit off the shelf. Cancelling an
   * already-canceled order answers `200`, not `422` — a repeat is a no-op transition, so this is
   * safe to retry.
   *
   * `422 invalid_transition` means the order is `paid` or `confirmed` — not cancellable, but not
   * terminal either. `422 order_terminal` means `fulfilled` or `refunded`; nothing moves it.
   *
   * **Cancelling does not cancel the payment.** This service tells payment-service nothing. A buyer
   * who cancels and then completes the gateway redirect anyway produces a `payment.succeeded` for a
   * canceled order, which is recorded as a no-op — the money is at payment-service and a human
   * resolves it there.
   */
  cancelOrder(publicId: string, options?: RequestOptions): Promise<Order>;
}

/**
 * Bind the order methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindOrderMethods(cfg: ResolvedConfig): OrderMethods {
  const order = (publicId: string) => `/v1/orders/${encodeURIComponent(publicId)}`;

  return {
    listOrders: (options = {}) =>
      callCursorList<Order>(cfg, {
        method: "GET",
        path: "/v1/orders",
        query: {
          limit: options.limit,
          cursor: options.cursor,
          status: options.status,
          from: options.from,
          until: options.until,
        },
        ...passInit(options),
      }),

    getOrder: (publicId, options = {}) =>
      call<Order>(cfg, {
        method: "GET",
        path: order(publicId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    cancelOrder: (publicId, options = {}) =>
      call<Order>(cfg, {
        method: "POST",
        path: `${order(publicId)}/cancel`,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
