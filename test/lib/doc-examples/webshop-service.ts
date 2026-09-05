import type {
  AddCartItemInput,
  ApplyCouponInput,
  Cart,
  CheckoutInput,
  CheckoutOrder,
  CreateCartInput,
  Order,
  Product,
  SetCartItemQuantityInput,
  SetShippingMethodInput,
  ShippingOption,
  StorefrontIdentity,
  WebshopWebhookEvent,
} from "@lazslov/webshop";
import type { AllKeys, MandatoryKeys } from "../type-keys.js";
import {
  adminTier,
  type Classifier,
  type DocExample,
  isRecord,
  problemDocument,
  type ServiceExamples,
  spec,
  unwrap,
} from "./shared.js";

/**
 * webshop-service's documented examples, and the `@lazslov/webshop` type each one is checked
 * against.
 *
 * @remarks
 * Most of the folder is the admin tier — fifty-seven of the hundred and one examples — and the
 * shared `adminTier` classifier claims all of them. What is left is the two consumer tiers, and
 * every one of those examples is checked against a type this package exports.
 */

const productSpec = spec(
  {
    public_id: true,
    slug: true,
    name: true,
    description: true,
    product_type: true,
    variants: true,
    updated_at: true,
  } satisfies AllKeys<Product>,
  {
    public_id: true,
    slug: true,
    name: true,
    description: true,
    product_type: true,
    variants: true,
    updated_at: true,
  } satisfies MandatoryKeys<Product>,
);

const shippingOptionSpec = spec(
  {
    public_id: true,
    name: true,
    description: true,
    price: true,
    currency: true,
  } satisfies AllKeys<ShippingOption>,
  {
    public_id: true,
    name: true,
    description: true,
    price: true,
    currency: true,
  } satisfies MandatoryKeys<ShippingOption>,
);

const identitySpec = spec(
  { shop: true, key: true } satisfies AllKeys<StorefrontIdentity>,
  { shop: true, key: true } satisfies MandatoryKeys<StorefrontIdentity>,
);

/**
 * The cart, priced.
 *
 * @remarks
 * Only the cart's own keys are checked. `items` holds `CartLine`, which the SDK hand-writes because
 * the pinned contract still spells the line `name` — but a key check reads one level, so the
 * documented line's `variant_name` and its three `product_*` members are proved by
 * `packages/webshop/test/type-safety.test.ts` rather than here.
 */
const cartSpec = spec(
  {
    public_id: true,
    status: true,
    currency: true,
    customer_id: true,
    session_id: true,
    items: true,
    coupon_code: true,
    coupon_applied: true,
    shipping_method_id: true,
    subtotal: true,
    discount_total: true,
    shipping_total: true,
    tax_total: true,
    grand_total: true,
    has_unavailable_items: true,
    expires_at: true,
    created_at: true,
    updated_at: true,
  } satisfies AllKeys<Cart>,
  {
    public_id: true,
    status: true,
    currency: true,
    customer_id: true,
    session_id: true,
    items: true,
    coupon_code: true,
    coupon_applied: true,
    shipping_method_id: true,
    subtotal: true,
    discount_total: true,
    shipping_total: true,
    tax_total: true,
    grand_total: true,
    has_unavailable_items: true,
    expires_at: true,
    created_at: true,
    updated_at: true,
  } satisfies MandatoryKeys<Cart>,
);

const orderKeys = {
  public_id: true,
  status: true,
  currency: true,
  customer_id: true,
  guest_email: true,
  items: true,
  subtotal: true,
  discount_total: true,
  shipping_total: true,
  tax_total: true,
  grand_total: true,
  shipping_method_name: true,
  shipping_method_price: true,
  coupon_code: true,
  coupon_discount: true,
  shipping_address: true,
  billing_address: true,
  payment_ref: true,
  created_at: true,
  updated_at: true,
} as const;

const orderSpec = spec(
  orderKeys satisfies AllKeys<Order>,
  orderKeys satisfies MandatoryKeys<Order>,
);

/**
 * The checkout response: the order plus the one member no other read carries.
 *
 * @remarks
 * The Markdown shows this one **abbreviated** — four of the order's twenty members beside the
 * `payment` block — so `required` is deliberately empty and only the other direction is asserted:
 * every member the service documents on a checkout response is a member this SDK declares. That is
 * the direction that matters here, because `payment` is what `CheckoutOrder` exists for.
 */
const checkoutOrderSpec = spec(
  { ...orderKeys, payment: true } satisfies AllKeys<CheckoutOrder>,
  {} satisfies Partial<MandatoryKeys<CheckoutOrder>>,
);

const checkoutInputSpec = spec(
  {
    customer_id: true,
    guest_email: true,
    shipping_address: true,
    billing_address: true,
  } satisfies AllKeys<CheckoutInput>,
  { shipping_address: true } satisfies MandatoryKeys<CheckoutInput>,
);

const addCartItemSpec = spec(
  { variant_id: true, quantity: true } satisfies AllKeys<AddCartItemInput>,
  { variant_id: true, quantity: true } satisfies MandatoryKeys<AddCartItemInput>,
);

const setQuantitySpec = spec(
  { quantity: true } satisfies AllKeys<SetCartItemQuantityInput>,
  { quantity: true } satisfies MandatoryKeys<SetCartItemQuantityInput>,
);

const applyCouponSpec = spec(
  { code: true } satisfies AllKeys<ApplyCouponInput>,
  { code: true } satisfies MandatoryKeys<ApplyCouponInput>,
);

const setShippingMethodSpec = spec(
  { shipping_method_id: true } satisfies AllKeys<SetShippingMethodInput>,
  { shipping_method_id: true } satisfies MandatoryKeys<SetShippingMethodInput>,
);

/** Both members are optional, so `{}` is a documented body — see the classifier for the consequence. */
const createCartSpec = spec(
  { customer_id: true, session_id: true } satisfies AllKeys<CreateCartInput>,
  {} satisfies MandatoryKeys<CreateCartInput>,
);

const webhookEventKeys = {
  event_id: true,
  contract_version: true,
  event_type: true,
  occurred_at: true,
  service: true,
  account_id: true,
  tenant: true,
  correlation_id: true,
  causation_id: true,
  hop: true,
  data: true,
} as const;

/**
 * The event envelope, as webhooks.md §3 shows it.
 *
 * @remarks
 * Eleven members, all always present. Note `contract_version`, `tenant` and `causation_id` — this
 * service's envelope is payment-service's, not email-service's.
 */
const webhookEventSpec = spec(
  webhookEventKeys satisfies AllKeys<WebshopWebhookEvent>,
  webhookEventKeys satisfies MandatoryKeys<WebshopWebhookEvent>,
);

/** A list whose first row carries the given keys. */
function firstRowHas(example: DocExample, ...keys: string[]): boolean {
  const rows = unwrap(example.json);
  const first = Array.isArray(rows) ? rows[0] : undefined;
  return isRecord(first) && keys.every((key) => key in first);
}

/** The first row of a list, for a key check. */
function firstRow(example: DocExample): object {
  return (unwrap(example.json) as object[])[0] as object;
}

const classifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("webshop: problem document"),
  {
    // payment-service's traffic INTO webshop-service. Signature-authenticated, carries no key of
    // ours, and is never a call a consumer makes — so no SDK type describes it.
    id: "out of scope: the inbound receiver /v1/hooks/payment-service",
    matches: (example) => example.context.includes("/v1/hooks/"),
  },
  {
    // `/healthz` is monitoring, not a tier. Nothing in a consumer's surface reads it.
    id: "out of scope: the /healthz body, which is monitoring rather than a consumer surface",
    matches: (example) =>
      example.file === "operations.md" && isRecord(example.json) && "commit" in example.json,
  },
  {
    // A log line, not a response. `event` is what every one of them carries.
    id: "out of scope: a structured log line, which no SDK type describes",
    matches: (example) =>
      example.file === "operations.md" && isRecord(example.json) && "event" in example.json,
  },
  {
    // `tenant` is what separates an outbound delivery from the inbound envelope above, which has
    // no such member.
    id: "webshop: WebshopWebhookEvent",
    matches: (example) =>
      isRecord(example.json) && "event_type" in example.json && "tenant" in example.json,
    check: (example) => ({ value: example.json as object, spec: webhookEventSpec }),
  },
  {
    // The same shape from both catalog tiers, which is the point of checking both files against
    // one spec: a browser and a storefront backend must never disagree about what is published.
    id: "webshop: Product[]",
    matches: (example) => firstRowHas(example, "variants"),
    check: (example) => ({ value: firstRow(example), spec: productSpec }),
  },
  {
    id: "webshop: ShippingOption[]",
    matches: (example) => firstRowHas(example, "price", "currency"),
    check: (example) => ({ value: firstRow(example), spec: shippingOptionSpec }),
  },
  {
    id: "webshop: StorefrontIdentity",
    matches: (example) => isRecord(example.json) && "shop" in example.json && "key" in example.json,
    check: (example) => ({ value: example.json as object, spec: identitySpec }),
  },
  {
    // Before every cart request body: a cart response carries `coupon_code` and
    // `shipping_method_id` too, and this flag is what only a cart has.
    id: "webshop: Cart",
    matches: (example) => isRecord(example.json) && "has_unavailable_items" in example.json,
    check: (example) => ({ value: example.json as object, spec: cartSpec }),
  },
  {
    // Before the checkout body, which also carries `shipping_address`. `items` is what makes this
    // the whole order rather than the abbreviated excerpt below.
    id: "webshop: Order",
    matches: (example) =>
      isRecord(example.json) && "payment_ref" in example.json && "items" in example.json,
    check: (example) => ({ value: example.json as object, spec: orderSpec }),
  },
  {
    id: "webshop: CheckoutOrder",
    matches: (example) => isRecord(example.json) && "payment" in example.json,
    check: (example) => ({ value: example.json as object, spec: checkoutOrderSpec }),
  },
  {
    id: "webshop: CheckoutInput",
    matches: (example) => isRecord(example.json) && "shipping_address" in example.json,
    check: (example) => ({ value: example.json as object, spec: checkoutInputSpec }),
  },
  {
    // Before the quantity-only body, which an add also carries.
    id: "webshop: AddCartItemInput",
    matches: (example) => isRecord(example.json) && "variant_id" in example.json,
    check: (example) => ({ value: example.json as object, spec: addCartItemSpec }),
  },
  {
    id: "webshop: SetCartItemQuantityInput",
    matches: (example) => isRecord(example.json) && "quantity" in example.json,
    check: (example) => ({ value: example.json as object, spec: setQuantitySpec }),
  },
  {
    id: "webshop: ApplyCouponInput",
    matches: (example) => isRecord(example.json) && "code" in example.json,
    check: (example) => ({ value: example.json as object, spec: applyCouponSpec }),
  },
  {
    id: "webshop: SetShippingMethodInput",
    matches: (example) => isRecord(example.json) && "shipping_method_id" in example.json,
    check: (example) => ({ value: example.json as object, spec: setShippingMethodSpec }),
  },
  {
    // Last, and matched by exclusion rather than by a key. Both members are optional and `{}` is a
    // documented body — a guest cart — so there is no key whose presence identifies this shape.
    id: "webshop: CreateCartInput",
    matches: (example) =>
      isRecord(example.json) && Object.keys(example.json).every((key) => key in createCartSpec.all),
    check: (example) => ({ value: example.json as object, spec: createCartSpec }),
  },
];

export const webshopExamples: ServiceExamples = {
  id: "webshop-service",
  classifiers,
  minChecked: 39,
  minTypes: 14,
};
