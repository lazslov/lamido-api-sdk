/**
 * `POST /v1/carts/{public_id}/checkout` — the one that matters.
 *
 * @remarks
 * Turns the cart into an immutable order in one transaction, **then** creates the payment at
 * payment-service, then freezes the response against the `Idempotency-Key`. That ordering is what
 * every rule in this module comes from: a failure at the payment step leaves a real, `pending`,
 * stock-holding order behind, and the recovery is the identical request under the same key.
 */

import type { IdempotencyKey, ResolvedConfig } from "@lazslov/api-core";
import { callWithMeta, isReplay, passInit, type RequestOptions } from "./call.js";
import type { CheckoutInput, CheckoutOrder, CheckoutResult } from "./types.js";

/** The checkout part of a storefront client. */
export interface CheckoutMethods {
  /**
   * Turn a cart into an order, and create its payment.
   *
   * @param cartId - The cart's `public_id`.
   * @param body - Who is buying, and where to ship. Nothing about money — totals come from the cart.
   * @param key - **Required.** One key per *intent* — one per checkout button press — derived from
   * the cart, never from the clock: `derivedIdempotencyKey(`checkout-${cart.public_id}`, 1)`.
   * @param options - `init` only.
   * @returns The order with its `payment` block, and whether this was a replay.
   * @throws {@link ./errors.js | WebshopApiError}. Read `retryable` and `advice` before deciding
   * anything: a `429` or a `502` **still committed the order**.
   * @remarks
   * **The `201` is not a paid order.** `order.status` is `pending` until payment-service reports
   * success — asynchronously, through the service's inbound receiver or its daily reconcile poll — at
   * which point it becomes `paid` and then `confirmed` in one transaction. Wait for `confirmed`
   * (`isConfirmed`), never for `paid`, which you will almost never observe.
   *
   * **`payment` may be `null`**, when the shop holds no payment credential. The order still committed
   * and holds stock; there is nothing to redirect to. Handle a `null` `payment` and a `null`
   * `payment.gateway_url` as the same thing: do not redirect.
   *
   * **The resume path.** The payment call runs after the transaction commits, so a `429` from the
   * payment throttle and both `502`s leave a real `pending` order holding stock. The key is *lapsed*
   * rather than released: re-POST the **identical** request under the **same** key and the retry
   * reloads that order and retries only the payment, answering the same `public_id`. A new key is a
   * new order; a new cart is a second sale; the converted cart under a new key is
   * `422 cart_converted`. A pre-commit `400` or `422` released the key instead — fix the body and
   * reuse it.
   *
   * There is no overload without a key. A completed key replays for 24 hours.
   *
   * @example
   * ```ts
   * const { order, replayed } = await shop.checkout(
   *   cart.public_id,
   *   { guest_email: "ada@example.com", shipping_address: address },
   *   derivedIdempotencyKey(`checkout-${cart.public_id}`, 1),
   * );
   * if (!replayed) await store(order.public_id);
   * if (order.payment?.gateway_url) redirect(order.payment.gateway_url);
   * ```
   */
  checkout(
    cartId: string,
    body: CheckoutInput,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<CheckoutResult>;
}

/**
 * Bind the checkout method to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCheckoutMethods(cfg: ResolvedConfig): CheckoutMethods {
  return {
    async checkout(cartId, body, key, options = {}) {
      const answer = await callWithMeta<CheckoutOrder>(cfg, {
        method: "POST",
        path: `/v1/carts/${encodeURIComponent(cartId)}/checkout`,
        // Passed through as given. The idempotency hash sorts object keys, but a byte-different body
        // under the same key is `409 idempotency_key_reused`, so nothing here normalises anything.
        body,
        headers: { "Idempotency-Key": key },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { order: answer.value, replayed: isReplay(answer.headers) };
    },
  };
}
