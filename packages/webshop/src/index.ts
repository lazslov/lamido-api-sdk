/**
 * `@lazslov/webshop` — consumer SDK for webshop-service's two consumer tiers.
 *
 * @remarks
 * Two clients, because there are two credentials with different blast radii:
 *
 * - {@link createWebshopPublicClient} — the `wpk_` public catalog. Two `GET`s, browser-safe, with
 *   the `ETag` / `s-maxage=60` contract exposed: every read returns its `etag`, and a read with
 *   `ifNoneMatch` may answer `notModified: true` instead of a value.
 * - {@link createWebshopClient} — the `wsk_` storefront tier: catalog, carts, checkout and orders.
 *   Server-only, and guarded at construction.
 *
 * Three things the package makes hard on purpose:
 *
 * - **A checkout cannot happen without an idempotency key**, and there is no overload without one.
 * - **A `429` or a `502` from checkout is not a failed checkout.** The order committed before the
 *   payment step, so the error is `retryable` with an `advice` naming the one recovery: the identical
 *   request under the **same** key, which resumes at the payment. A new key or a new cart is a second
 *   order.
 * - **The `201` is not a paid order.** `isConfirmed` is `true` only once payment-service has reported
 *   success, asynchronously; `paid` is a step you will almost never observe.
 *
 * Amounts are gross minor-unit **strings** with tax contained — never add `tax_total` to
 * `grand_total` — and HUF has zero minor units. Stock counts are strings too; a line `quantity` is a
 * number. This package performs no arithmetic on any of them.
 *
 * The admin tier (`wad_`), the cron routes and the inbound receiver `/v1/hooks/payment-service` are
 * out of scope — the last is payment-service's traffic into webshop-service, never yours to call.
 *
 * @example
 * ```ts
 * import "server-only";
 * import { createWebshopClient, isConfirmed } from "@lazslov/webshop";
 * import { derivedIdempotencyKey } from "@lazslov/api-core";
 *
 * const shop = createWebshopClient();
 *
 * const cart = await shop.createCart();
 * const priced = await shop.addCartItem(cart.public_id, { variant_id: variantId, quantity: 2 });
 *
 * const { order } = await shop.checkout(
 *   cart.public_id,
 *   { guest_email: "ada@example.com", shipping_address: address },
 *   derivedIdempotencyKey(`checkout-${cart.public_id}`, 1),
 * );
 * if (order.payment?.gateway_url) redirect(order.payment.gateway_url);
 *
 * // …later, from a webhook or a poll:
 * const settled = await shop.getOrder(order.public_id);
 * if (isConfirmed(settled.status)) await sendConfirmation(settled);
 * ```
 */

export type { CursorListOptions, RequestOptions, WebshopRequest } from "./call.js";
export type { CartMethods } from "./carts.js";
export type { CatalogMethods } from "./catalog.js";
export type { CheckoutMethods } from "./checkout.js";
export { createWebshopClient, tryCreateWebshopClient, type WebshopClient } from "./client.js";
export {
  WebshopApiError,
  type WebshopProblemCode,
  type WebshopProviderError,
} from "./errors.js";
export type { IdentityMethods } from "./identity.js";
export type { OrderListOptions, OrderMethods } from "./orders.js";
export type {
  CatalogFresh,
  CatalogNotModified,
  CatalogRead,
  ConditionalOptions,
  PublicCatalogMethods,
} from "./public-catalog.js";
export {
  createWebshopPublicClient,
  tryCreateWebshopPublicClient,
  type WebshopPublicClient,
} from "./public-client.js";
export { isConfirmed, isTerminal, type KnownOrderStatus, type OrderStatus } from "./status.js";
export type {
  AddCartItemInput,
  Address,
  ApplyCouponInput,
  Cart,
  CartLine,
  CartStatus,
  CheckoutInput,
  CheckoutOrder,
  CheckoutPayment,
  CheckoutResult,
  CreateCartInput,
  Currency,
  MinorAmount,
  Order,
  OrderLine,
  Product,
  ProductType,
  ProductVariant,
  SetCartItemQuantityInput,
  SetShippingMethodInput,
  ShippingOption,
  StorefrontIdentity,
} from "./types.js";
export {
  deliveryIdHeader,
  eventIdHeader,
  isKnownEvent,
  type KnownWebshopEvent,
  parseWebshopWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyWebshopWebhook,
  type WebhookCustomerBlock,
  type WebhookOrderBlock,
  type WebhookOrderLine,
  type WebshopEventData,
  type WebshopEventEnvelope,
  type WebshopEventTenant,
  type WebshopWebhookEvent,
  type WebshopWebhookEventType,
  type WebshopWebhookInput,
} from "./webhook.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that disagrees with
 * the tarball it came from.
 */
export const VERSION = "1.0.1";
