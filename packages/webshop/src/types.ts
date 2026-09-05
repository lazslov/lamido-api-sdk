/**
 * Named aliases over the generated contract, and the shapes the SDK hand-writes where the contract
 * is behind the service.
 *
 * @remarks
 * Wire names are kept exactly as the service spells them — `public_id`, `grand_total`,
 * `has_unavailable_items`. The SDK does not camelCase them: these are the strings in the service's
 * own docs and in every `curl` an integrator will paste while debugging.
 *
 * Three shapes are hand-written rather than aliased, each recorded in `docs/plans/phase-9-webshop.md`:
 *
 * - {@link CartLine} — the contract still spells the line `name`; the service renamed it
 *   `variant_name` and added `product_public_id`, `product_slug` and `product_name`. The Markdown wins.
 * - {@link Order} and {@link CheckoutInput} — the contract's `billing_address` collapses to a
 *   non-null `Address` through an `allOf` artefact; the service documents `null` as "same as shipping".
 * - {@link OrderStatus} on an order — widened, because the knowledge base says not to hard-code the
 *   reachable set.
 */

import type { components } from "./generated/schema.js";
import type { OrderStatus } from "./status.js";

/** @internal Shorthand for the generated component schemas. */
type Schemas = components["schemas"];

/**
 * A decimal string of **minor units**, never a JSON number.
 *
 * @remarks
 * `^(0|[1-9][0-9]{0,17})$` — no sign, no decimal point, no leading zero. **HUF has zero minor units**,
 * so `"4990"` HUF is 4990 Ft; EUR is two-decimal, so `"1000"` EUR is €10.00. Every amount on this
 * service is **gross**: `tax_total` is contained in `grand_total`, never added to it. This package
 * only reads amounts, so the alias is documentation rather than a brand.
 */
export type MinorAmount = Schemas["MinorAmount"];

/** ISO 4217, upper case. One currency per shop, and every amount carries it. */
export type Currency = Schemas["Currency"];

/** `physical`, `digital` or `service`. Informational — nothing in the service branches on it. */
export type ProductType = Schemas["ProductType"];

/**
 * One purchasable variant.
 *
 * @remarks
 * **Add this `public_id` to a cart, not the product's.** A single-option product still has exactly
 * one variant. `compare_at_price` is the struck-through price and is not validated to exceed `price`.
 */
export type ProductVariant = Schemas["PublicVariant"];

/**
 * A published product, as both catalog tiers serve it.
 *
 * @remarks
 * The same shape from the same implementation on `/v1/public/products` and `/v1/products`, so a
 * browser and a storefront backend never disagree about what is published. `status` and `metadata`
 * are absent, archived variants are filtered out, and `variants` is never empty. `updated_at` is the
 * product row only — a price change moves a *variant* row.
 */
export type Product = Schemas["PublicProduct"];

/** The shop and the key behind a `wsk_` credential, from `GET /v1/me`. */
export type StorefrontIdentity = Schemas["StorefrontSelf"];

/** One carriage option, as a buyer sees it. */
export type ShippingOption = Schemas["ShippingOption"];

/**
 * A cart's status.
 *
 * @remarks
 * **Computed**: `expires_at` in the past reads as `expired` whatever the stored column says. Trust
 * this field, not a clock comparison of your own.
 */
export type CartStatus = Schemas["Cart"]["status"];

/**
 * One cart line.
 *
 * @remarks
 * Hand-written: the pinned contract still spells the line `name` alone. The service renamed it
 * `variant_name` and added the three product members, and a storefront reading `item.name` gets
 * `undefined`. `product_name` is what the buyer thinks they are buying; `variant_name` is the option.
 *
 * `quantity` is a **JSON number** — the one count on this service that is, unlike money and stock.
 * `unit_price` is the **live** catalog price, not the price when the line went in. `discount_total`
 * is always `"0"`: there are no per-line discounts.
 *
 * An `unavailable` line stays visible, shows its own `unit_price`, and contributes `"0"` to every
 * total — so `subtotal` does not equal the sum of the lines. Checkout refuses the cart until it is
 * removed.
 */
export interface CartLine {
  /** The id used in the `PATCH` and `DELETE` item paths. */
  readonly public_id: string;
  readonly variant_public_id: string;
  readonly product_public_id: string;
  /** The natural key your own product route is built on. */
  readonly product_slug: string;
  readonly product_name: string;
  readonly variant_name: string;
  readonly quantity: number;
  readonly unit_price: MinorAmount;
  readonly line_total: string;
  readonly discount_total: string;
  readonly unavailable: boolean;
}

/**
 * A cart, priced.
 *
 * @remarks
 * Every cart response and every cart mutation returns this whole object. **A storefront never adds
 * anything up.** Two flags are what to branch on, never the totals:
 *
 * - `has_unavailable_items` — when `true`, `subtotal` excludes the flagged lines and checkout will
 *   refuse the cart with `422 variant_unavailable`.
 * - `coupon_applied` — whether `coupon_code` is taking anything off **right now**. A code set with
 *   `coupon_applied: false` is a lapsed campaign; show the pair, not a discount of zero.
 *
 * `grand_total` is `max(0, subtotal - discount_total + shipping_total)` and is **gross**: `tax_total`
 * is contained in it. `expires_at` is 30 days from creation and never extended.
 */
export type Cart = Omit<Schemas["Cart"], "items"> & { readonly items: CartLine[] };

/** What to create a cart with. Both members are your own labels; the service never resolves them. */
export type CreateCartInput = Schemas["CartCreate"];

/**
 * What to add to a cart.
 *
 * @remarks
 * `variant_id` is a **variant's** `public_id`. `quantity` is the amount to **add**, 1–99, and the cap
 * applies to the resulting line — adding 2 to a line of 2 needs stock for 4. Another shop's variant
 * is `422 variant_unavailable`, not `404`, because the id arrived in the body.
 */
export type AddCartItemInput = Schemas["CartItemCreate"];

/** An absolute quantity, not a delta — which is what makes the call safe to retry. */
export type SetCartItemQuantityInput = Schemas["CartItemUpdate"];

/** A coupon code. Case-insensitive on the way in; stored and matched upper case. */
export type ApplyCouponInput = Schemas["CartCoupon"];

/** Which carriage. The key must be **present**; `null` clears the choice. */
export type SetShippingMethodInput = Schemas["CartShippingMethod"];

/**
 * A postal address.
 *
 * @remarks
 * Strict, and stored exactly as sent. `country` is exactly two **upper-case** letters — `"hu"` is a
 * `400`. `postal_code` and `phone` are free text with no format validation of any kind.
 */
export type Address = Schemas["Address"];

/**
 * What to check out with.
 *
 * @remarks
 * Hand-written because the contract's `billing_address` collapses to a non-null `Address` through an
 * `allOf` artefact, and the service documents `null` as "the same as shipping" — which **you**
 * resolve; the service does not copy it.
 *
 * **Supply `customer_id` or `guest_email`.** Neither is individually required and at least one must
 * be present, or the `400` carries two issues, one on each pointer. `guest_email` is the only place
 * this service ever holds an email address.
 *
 * **Nothing about money is here.** Totals come from the cart; a checkout that let a caller state a
 * price would be a checkout that let them choose one.
 */
export interface CheckoutInput {
  /** An opaque reference to your own signed-in user. Never validated, never resolved. */
  readonly customer_id?: string | null;
  /** A valid email address, ≤ 320 characters. */
  readonly guest_email?: string | null;
  readonly shipping_address: Address;
  /** `null` means "the same as shipping". Defaults to `null`. */
  readonly billing_address?: Address | null;
}

/** One order line. Copied at checkout; the catalog may say something else today. */
export type OrderLine = Schemas["OrderLine"];

/**
 * An order — immutable history.
 *
 * @remarks
 * Every value a buyer was shown is copied here at checkout, and no order read joins the live catalog.
 * `items[].product_id` and `variant_id` are for a link back, never for a price. `billing_address`
 * is `null` when it is the same as shipping. `payment_ref` is payment-service's payment `public_id`:
 * `null` until the payment is created, and permanently `null` for a shop holding no credential — and
 * a `pending` order with a `null` `payment_ref` is **not** reconcilable by the service's poll; what
 * recovers it is the buyer retrying the checkout with the same `Idempotency-Key`.
 *
 * `status` is widened — see {@link OrderStatus}.
 */
export type Order = Omit<Schemas["Order"], "billing_address" | "status"> & {
  readonly billing_address: Address | null;
  readonly status: OrderStatus;
};

/**
 * payment-service's payment, re-published verbatim on the checkout response.
 *
 * @remarks
 * `status` is **payment-service's vocabulary**, not this service's order status, and it is not
 * validated against a list here. Treat it as opaque display data and never map it onto an order
 * status. `gateway_url: null` means **do not redirect** — handle it exactly as you handle a `null`
 * `payment`.
 */
export type CheckoutPayment = Schemas["Payment"];

/**
 * What checkout answers: the order, plus the one member no other read carries.
 *
 * @remarks
 * `payment` is `null` when the shop holds no payment credential. That is a configuration state, not
 * a failure: the order still committed `pending` with its stock held, and there is nothing to
 * redirect to. `GET /v1/orders/{id}` returns `payment_ref` and no `payment` block, because the block
 * is payment-service's resource fetched at that one instant rather than something this service stores.
 */
export type CheckoutOrder = Order & { readonly payment: CheckoutPayment | null };

/**
 * A checkout's answer, and whether it was a replay.
 *
 * @remarks
 * `replayed: true` means the service answered with the frozen bytes of an earlier identical request
 * under the same key — nothing new happened, and that is a success. `false` means the response was
 * generated now, which covers **both** a first attempt and a resume that recovered a stranded order.
 * A resume returns the same `order.public_id` as the attempt that failed, never a second one.
 *
 * **The `201` is not a paid order.** `order.status` is `pending` until payment-service reports
 * success; see `isConfirmed`.
 */
export interface CheckoutResult {
  readonly order: CheckoutOrder;
  readonly replayed: boolean;
}
