/**
 * `/v1/carts` — building a cart, and its two checkout choices.
 *
 * @remarks
 * **Every mutation returns the whole cart, priced.** A storefront never adds anything up and never
 * needs a second call to find out what changed. There is exactly one place a rounding rule lives,
 * and it is not your code.
 *
 * A cart is **not** scoped to a customer or a session: anyone holding a `wsk_` key and a cart's
 * `public_id` can read and mutate it. Keep cart ids server-side.
 */

import type { CursorPage, ResolvedConfig } from "@lazslov/api-core";
import {
  type CursorListOptions,
  call,
  callCursorList,
  passInit,
  type RequestOptions,
} from "./call.js";
import type {
  AddCartItemInput,
  ApplyCouponInput,
  Cart,
  CreateCartInput,
  SetCartItemQuantityInput,
  SetShippingMethodInput,
  ShippingOption,
} from "./types.js";

/** The cart part of a storefront client. */
export interface CartMethods {
  /**
   * Create a cart.
   *
   * @param body - Your own labels. Omit both for a guest cart.
   * @returns The cart, with `items: []` and every total `"0"`.
   * @remarks
   * **Not idempotent** — each call makes a new cart. `currency` is not a field: a cart copies the
   * shop's currency and may not choose. The cart expires 30 days after creation, and no mutation
   * extends that.
   */
  createCart(body?: CreateCartInput, options?: RequestOptions): Promise<Cart>;

  /**
   * Read a cart, priced.
   *
   * @throws {@link ./errors.js | WebshopApiError} on a `404` — **never `null`**. Another shop's cart
   * and a malformed id both read as `404`, and a cart id you hold came from a cart you created, so
   * "not found" is a bug; the error says so.
   * @remarks
   * An expired or converted cart still reads. Only writes are refused, so a buyer can always see what
   * was in it. Prices are the **live** catalog prices, re-read on every call.
   */
  getCart(cartId: string, options?: RequestOptions): Promise<Cart>;

  /**
   * Add a variant, or increase its line.
   *
   * @param body - A **variant's** `public_id`, and the amount to **add**.
   * @remarks
   * **Not idempotent** — there is one line per variant and adding to it adds. Two calls of
   * `quantity: 2` make 4, and the 99 cap applies to the resulting line. Use
   * {@link CartMethods.setCartItemQuantity} for the call that is safe to retry.
   *
   * A `422 variant_unavailable` covers an archived variant, an unpublished product **and another
   * shop's variant** — not a `404`, because the id arrived in the body. A `422 insufficient_stock` is
   * measured against the resulting line quantity.
   */
  addCartItem(cartId: string, body: AddCartItemInput, options?: RequestOptions): Promise<Cart>;

  /**
   * Set a line's quantity.
   *
   * @param itemId - The line's `public_id`, from `cart.items[].public_id`.
   * @param body - An **absolute** quantity, 1–99.
   * @remarks
   * Absolute, not a delta — which is what makes this the safe call to retry. A `404` means the line
   * is not in this cart.
   */
  setCartItemQuantity(
    cartId: string,
    itemId: string,
    body: SetCartItemQuantityInput,
    options?: RequestOptions,
  ): Promise<Cart>;

  /**
   * Remove a line.
   *
   * @remarks
   * Answers the recalculated cart, not `204`. Removing is a mutation, so an expired cart refuses it.
   */
  removeCartItem(cartId: string, itemId: string, options?: RequestOptions): Promise<Cart>;

  /**
   * Apply or replace the coupon code.
   *
   * @remarks
   * A cart holds **at most one** code, so this is safely repeatable: calling it again replaces the
   * code. The coupon is judged **now**, against the cart as it is, and judged **again at checkout** —
   * a week in a cart is long enough for a campaign to end. A refused code leaves the existing one
   * untouched.
   *
   * `coupon_invalid` is deliberately uninformative: unknown, withdrawn, not yet started and
   * wrong-currency all read the same, so the endpoint is not a campaign-schedule oracle. Only
   * `coupon_minimum_not_met` names a number, because it is the one refusal a buyer can act on — and
   * the minimum is measured against the **subtotal**, before the discount and before carriage.
   */
  applyCoupon(cartId: string, body: ApplyCouponInput, options?: RequestOptions): Promise<Cart>;

  /** Remove the coupon code. No validation; a safe no-op when none was set. */
  removeCoupon(cartId: string, options?: RequestOptions): Promise<Cart>;

  /**
   * The shop's active carriage options.
   *
   * @remarks
   * **Ignores the cart entirely** today: no weight, no destination, no cart-value banding. It hangs
   * off the cart so carriage *can* depend on it later without moving the route. The cart id is still
   * validated, so another shop's cart is a `404`.
   */
  listShippingOptions(
    cartId: string,
    options?: CursorListOptions,
  ): Promise<CursorPage<ShippingOption>>;

  /**
   * Choose carriage, or clear the choice with `shipping_method_id: null`.
   *
   * @remarks
   * A `PUT`: a cart has exactly one choice, and setting it twice leaves the same cart. A withdrawn
   * method or another shop's is `422 shipping_method_inactive`.
   *
   * Carriage may be chosen and then withdrawn by an operator. The cart then reads
   * `shipping_method_id: null` and `shipping_total: "0"` with no error, and **checkout refuses it**.
   * Re-read the cart before checkout, or handle that `422` by re-offering the options.
   */
  setShippingMethod(
    cartId: string,
    body: SetShippingMethodInput,
    options?: RequestOptions,
  ): Promise<Cart>;
}

/**
 * Bind the cart methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCartMethods(cfg: ResolvedConfig): CartMethods {
  const cart = (cartId: string) => `/v1/carts/${encodeURIComponent(cartId)}`;
  const item = (cartId: string, itemId: string) =>
    `${cart(cartId)}/items/${encodeURIComponent(itemId)}`;

  return {
    createCart: (body = {}, options = {}) =>
      call<Cart>(cfg, {
        method: "POST",
        path: "/v1/carts",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getCart: (cartId, options = {}) =>
      call<Cart>(cfg, {
        method: "GET",
        path: cart(cartId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    addCartItem: (cartId, body, options = {}) =>
      call<Cart>(cfg, {
        method: "POST",
        path: `${cart(cartId)}/items`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    setCartItemQuantity: (cartId, itemId, body, options = {}) =>
      call<Cart>(cfg, {
        method: "PATCH",
        path: item(cartId, itemId),
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    removeCartItem: (cartId, itemId, options = {}) =>
      call<Cart>(cfg, {
        method: "DELETE",
        path: item(cartId, itemId),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    applyCoupon: (cartId, body, options = {}) =>
      call<Cart>(cfg, {
        method: "POST",
        path: `${cart(cartId)}/coupon`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    removeCoupon: (cartId, options = {}) =>
      call<Cart>(cfg, {
        method: "DELETE",
        path: `${cart(cartId)}/coupon`,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    listShippingOptions: (cartId, options = {}) =>
      callCursorList<ShippingOption>(cfg, {
        method: "GET",
        path: `${cart(cartId)}/shipping-options`,
        query: { limit: options.limit, cursor: options.cursor },
        ...passInit(options),
      }),

    setShippingMethod: (cartId, body, options = {}) =>
      call<Cart>(cfg, {
        method: "PUT",
        path: `${cart(cartId)}/shipping-method`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
