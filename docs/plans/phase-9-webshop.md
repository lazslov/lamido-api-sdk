# Phase 9 — `@lazslov/webshop`

**Goal:** the two consumer tiers of webshop-service — the `wpk_` public catalog with its `ETag`
contract, and the sixteen `wsk_` storefront endpoints that run carts, checkout and orders — plus
error triage by `status` and `code`, webhook verification and the route handler. The package where
the failure mode is a stranded order holding a shop's stock, and the cure is the request that looks
like the mistake.

**Depends on:** [phase 2](phase-2-api-core.md). Independent of the other phase 9 packages.

**Reference:** [webshop-service/conventions.md](../webshop-service/conventions.md),
[storefront-api.md](../webshop-service/storefront-api.md),
[public-api.md](../webshop-service/public-api.md),
[webhooks.md](../webshop-service/webhooks.md) and
[workflows.md](../webshop-service/workflows.md). The resume path in storefront-api.md, the
per-outcome checkout table beside it, and the receiver rules in webhooks.md §6 are the acceptance
criteria for this phase, restated as code. Knowledge base at `529003d`, verified against the
service at `18c4a9a`.

**Out of scope:** the admin tier (`wad_`, fifty-eight operations), `/v1/hooks/payment-service` (the
inbound receiver, which is payment-service's traffic *into* this service), `/api/cron/*`, and
`/healthz`.

---

## 0. The scope decision

The service has four surfaces and two of them belong to a consumer. `wpk_` is public by design and
browser-safe; `wsk_` is the storefront's backend. The other two are an operator's console and
another service's delivery endpoint, and neither is something the client site this SDK serves ever
calls.

**Decision:** ship both consumer tiers, in **two clients**, and nothing else. A single client with
a tier parameter would hold one key that serves both surfaces — and a `wsk_` that *can* serve a
public read is a `wsk_` that ends up in a client component. Two constructors make the import graph
say which tier a module touches.

---

## 1. The clients

```ts
createWebshopPublicClient(config?)   // wpk_ → /v1/public/*
tryCreateWebshopPublicClient(config?)

createWebshopClient(config?)         // wsk_ → /v1/*
tryCreateWebshopClient(config?)
```

Env: `WEBSHOP_SERVICE_BASE_URL`, `WEBSHOP_PUBLISHABLE_KEY`, `WEBSHOP_SECRET_KEY` and
`WEBSHOP_WEBHOOK_SECRET`.

**Only `WEBSHOP_SECRET_KEY` is the knowledge base's own name.** The Node snippet in
[workflows.md §1](../webshop-service/workflows.md) reads `process.env.WEBSHOP_SECRET_KEY`
literally. It breaks the estate's `<SERVICE>_SERVICE_<ROLE>` pattern, and the SDK **keeps it rather
than harmonising it**: a tidier name that nobody's `.env` contains is an outage on the next deploy.
The other three names are the SDK's proposals — the folder documents the host and the key tiers,
never a variable for either. There is no fallback host.

**The browser guard is per key, not per client.** `assertServerOnly` runs on both constructors with
`serverOnlyPrefixes: ["wsk_"]`. A `wpk_` in a browser is the point of the public tier; a `wsk_`
there is a leak, and the guard names rotation. The service's own tripwire refuses `Origin` or
`Sec-Fetch-Dest` on `/v1/*` with a `403` before the key lookup; this guard fires earlier still,
because by the time that `403` arrives the key has already shipped.

`mode` is never set and `Origin` is never sent. The tripwire keys on `Sec-Fetch-Dest`, which undici
does not send, so a correct backend caller needs no workaround — and a helpful `Origin` earns a
`403` before its key is read. Grep-asserted.

**The public client does not fall back to the secret key.** The path names the credential, and a
`wsk_` on `/v1/public` is a `403` from the service. A server-rendered storefront that already holds
a `wsk_` reads the same catalog shapes through `createWebshopClient` — without cache headers.

### The public tier has no origin allowlist, and that is the service's defect

> **CRITICAL — there is still NO ORIGIN RESTRICTION OF ANY KIND on this tier.**
> ([public-api.md](../webshop-service/public-api.md))

Phase 7 fixed the CORS *response headers*, so a cross-origin browser read works. It did not add an
allowlist, and the module's own comment has promised one "in phase 2" for five phases. The SDK
cannot fix this and does not pretend to: `WebshopPublicClient`'s TSDoc and the README both state
it, so a reader who assumes the key is scoped by origin is corrected before they rely on it. A
per-IP throttle, run before authentication, is the tier's actual defence.

---

## 2. Endpoints

**Public tier — two `GET`s, with the caching contract exposed.**

| Method | Path | Notes |
|---|---|---|
| `listProducts(options?)` | `GET /v1/public/products` | Overloaded: with `ifNoneMatch` it may answer `notModified`. `limit` is part of the validator |
| `getProduct(idOrSlug, options?)` | `GET /v1/public/products/{id_or_slug}` | `null` on the documented `404`. Its validator reads the variants too |

**Storefront tier — sixteen, asserted by a test that counts the client's own keys.**

| Method | Path | Notes |
|---|---|---|
| `getMe()` | `GET /v1/me` | The boot-time check that a key points at the shop you meant |
| `listProducts(options?)` | `GET /v1/products` | Same shapes as the public tier, no cache headers |
| `getProduct(idOrSlug)` | `GET /v1/products/{id_or_slug}` | `null` on the documented `404` |
| `createCart(body?)` | `POST /v1/carts` | **Not idempotent.** An empty body is a guest cart |
| `getCart(cartId)` | `GET /v1/carts/{public_id}` | Throws on `404` |
| `addCartItem(cartId, body)` | `POST /v1/carts/{public_id}/items` | **Adds.** The 99 cap is on the resulting line |
| `setCartItemQuantity(cartId, itemId, body)` | `PATCH …/items/{item_public_id}` | **Absolute**, so safe to retry |
| `removeCartItem(cartId, itemId)` | `DELETE …/items/{item_public_id}` | Answers the recalculated cart, not `204` |
| `applyCoupon(cartId, body)` | `POST …/coupon` | One code per cart, so repeatable |
| `removeCoupon(cartId)` | `DELETE …/coupon` | No validation; a safe no-op |
| `listShippingOptions(cartId, options?)` | `GET …/shipping-options` | Ignores the cart entirely today |
| `setShippingMethod(cartId, body)` | `PUT …/shipping-method` | `null` clears the choice |
| `checkout(cartId, body, key)` | `POST …/checkout` | `IdempotencyKey` **required**. See §5 |
| `listOrders(options?)` | `GET /v1/orders` | Keyset; `status`, `from`, `until`. No `total` |
| `getOrder(publicId)` | `GET /v1/orders/{public_id}` | Throws on `404`. `payment_ref`, no `payment` block |
| `cancelOrder(publicId)` | `POST /v1/orders/{public_id}/cancel` | Bodiless. A repeat is a `200`, not a `422` |

Notes that shape the signatures:

- **Every cart mutation returns the whole cart, priced.** No method sums anything, and a test
  asserts the package exports no `add*`/`sum*`/`total*`/`format*` symbol at all. There is one place
  the rounding rule lives and it is not this package.
- **`getProduct` is the only read that maps a `404` to `null`**, on both tiers, because the
  knowledge base documents that `404` as a normal state — a slug a crawler invented, a draft, an
  archived product. `getCart` and `getOrder` throw: an id you hold came from something you created,
  so "not found" is a bug, and quite often the bug is a deployment holding another shop's key. The
  error says so and names `WEBSHOP_SECRET_KEY`.
- **A list carries no `total`.** `callCursorList` renames `data`/`next_cursor` to
  `items`/`nextCursor` so core's `collectAllCursor` follows it with no adapter, and a type-level
  test makes reading a `total` a compile error.
- **`OrderListOptions.from` and `until` are passed through untouched.** The service is strict ISO
  8601 as of `18c4a9a`; a local guess would be looser than the thing it is guessing for.
- **`cancelOrder` sends no body and no `Idempotency-Key`.** No other endpoint on the tier accepts
  the header, and sending it elsewhere is silently ignored.

---

## 3. Money, and the two counts that are not numbers

> **RULE — every amount is a decimal string of minor units, and it never travels without its
> `currency`.** · **HUF has zero minor units.** · **Prices are GROSS and tax is extracted, never
> added.** ([conventions.md](../webshop-service/conventions.md))

`MinorAmount` is an **alias of the generated contract, not a brand**, and this is the deliberate
difference from `@lazslov/payment` and `@lazslov/email`. Those packages *send* amounts, so a brand
buys a compile error at the one place a mistake is expensive. This package only ever **reads**
them: every total is computed by the service, and no method here takes an amount. A brand with no
constructor call site would be ceremony.

What the SDK does instead is say it, everywhere the value is read: `tax_total` is contained in
`grand_total`; stock counts are strings too; and a cart line's `quantity` is the one JSON
**number** on the service. A type-level test rejects a string `quantity` on both cart writes.

---

## 4. Errors: branch on `status` **and** `code`

Every failure is `application/problem+json` under `urn:webshop-service:problem:<slug>`, over the
estate's closed slug set — core's reader. `WebshopProblemCode` aliases the generated
`Problem.code` union (seventeen values), with a runtime `Set` and a test that the two agree.

> **GOTCHA — one `type` covers two statuses.** `conflict` is `409` for the two idempotency codes
> and `422` for every state refusal; `internal` is `500` and `502` alike.

So the type alone is never a branch, and neither is `title` or `detail` — a test asserts no module
reads either. `retryable` overrides core in three places, each from the service's own table:

| Status | Core says | This package says | Why |
|---|---|---|---|
| `409` | not retryable | **`idempotency_in_flight` only** — retryable after a pause | The 60-second lease. `idempotency_key_reused` never clears |
| `422` | retryable | **seven codes are not** | `cart_expired`, `cart_converted`, `order_terminal`, the three `coupon_*` failures and `shipping_method_inactive`: the cart is gone, the order will never move, or the campaign is over |
| `502` | retryable | **`payment_create_rejected` is not** | The identical request refuses the same way until an operator changes the shop's credential. Every other `502` keeps `true`, because the resume path is idempotent by design |

`advice` carries the prose wherever the naive reading of a status strands an order: the two `502`s,
the `429` **on the checkout path only**, the in-flight lease, the reused key, and every `404`.
`providerError` is set only on a `502` and only for the two values the contract declares.

Four codes in the union can never reach a consumer — `key_revoked` is declared and never raised
(a revoked key is an ordinary `401`), and `endpoint_limit_reached`, `key_self_revoke` and
`last_managing_key` are admin-tier refusals. They stay in the type because the contract declares
them, and the TSDoc says not to branch on them.

---

## 5. Idempotency, and the resume path

Required on `checkout` and accepted nowhere else; the method takes a branded `IdempotencyKey` with
no overload without one, and core will not mint one for you. A test greps the source for
`randomUUID`, `Date.now()` and `Math.random` — a key from a clock is correct in the happy path and
a second order the moment a retry happens.

**The resume path is the headline behaviour of this package.** The checkout commits the order and
names it against the key, *then* calls payment-service. A failure at that second step therefore
leaves a real, `pending`, stock-holding order, and the key is **lapsed** rather than released: the
record and its `target_id` survive, so the identical request under the **same** key reloads that
order and retries only the payment.

| Outcome | Order? | Stock held? | What the SDK reports |
|---|:--:|:--:|---|
| `400`, pre-commit `422` | no | no | not retryable — the identical body fails identically, but the key was **released**, so fix the body and reuse it |
| `429` on `/checkout` | **yes** | **yes** | `retryable`, with advice: wait `retryAfter`, then re-POST the same key |
| `502 payment_create_unknown` | **yes** | **yes** | `retryable`, with advice: a payment may or may not exist; the derived key at payment-service makes one, not two |
| `502 payment_create_rejected` | **yes** | **yes** | **not** retryable, with advice naming the operator — and still naming the committed order |
| `409 idempotency_in_flight` | unknown | — | `retryable` after a pause |

`replayed` comes from the `Idempotent-Replay` header **alone**, never from the status: a replay is
a `201` like a fresh checkout. And a **resume** reports `replayed: false`, because it generates its
response for the first time — so `false` covers a first attempt and a recovery alike, and what
identifies the outcome is `order.public_id`, which a resume never changes. `isReplay` documents
exactly that.

The body is sent as given. The service hashes it with sorted object keys and refuses a
byte-different body under the same key with `409 idempotency_key_reused`, so the SDK normalises
nothing, defaults nothing and reorders nothing. Asserted.

---

## 6. Webhooks

`verifyWebshopWebhook` binds core's `verifySignedBody` to `X-Signature` / `X-Signature-Timestamp`
with a 300-second tolerance; the whole `whsec_` string is the key. Fixtures generated by
`test/fixtures/webhook/generate.mjs` with `node:crypto`: an `order.created`, an `order.confirmed`,
a non-ASCII body, and every failure reason including the stripped-prefix case.

The event model follows [webhooks.md §3](../webshop-service/webhooks.md) exactly:

- Envelope: `event_id`, `contract_version`, `occurred_at`, `service`, `account_id` (nullable — an
  unpaired shop, not an error), `tenant`, `correlation_id`, `causation_id` (never absent, `null`
  when nothing caused it), `hop`, `data`. **Eleven members, all always present.**
- `data` is `{ order }`, plus `customer` **only** when an operator ticked `include_customer`.
- `WebshopWebhookEventType` is the six `order.*` types; the union keeps a `string & {}` arm because
  an unrecognised type is a valid delivery a receiver must still `2xx`. `isKnownEvent` is the guard
  that narrows to the arm whose order block is guaranteed, and the parser refuses a *known* type
  carrying no order block — the union would otherwise be a lie.
- `webhook.ping` arrives through the unknown arm with `data: {}`. Verify it and do nothing.

> **GOTCHA — `order.created` is an observation.** "Created" is not a status, so nothing binds
> `data.order.status` on it.

That is the one place the event name and the payload can disagree, and it is why every doc comment
here says **read `data.order.status`**. The parser's and the handler's `order.created` cases both
read the status off the payload rather than off the name — which is what will still be right the
day a zero-total order commits as `confirmed`.

The route handler on `./next` is payment's, renamed: required `alreadyProcessed`/`markProcessed`,
verify before parse, `200` for a duplicate and for an unknown type, `500` without `markProcessed`
when `onEvent` throws, and the secret read per request so a route module cannot throw on import.

### The once-a-day drain

> **⚠️ THE MOST IMPORTANT THING ON THIS PAGE: the ladder's rungs are a floor, not a schedule.**
> ([webhooks.md §6](../webshop-service/webhooks.md))

Eight attempts over about 3.65 days, published as 1 min → 48 h. Only the first attempt is inline;
every later rung waits for a drain that runs once a day, and five exhausted ladders disable the
endpoint with no backlog. So the README, `getOrder`, `listOrders` and the handler's `onEvent` all
say the same thing: an event is a notification, `getOrder` is the authority, and a receiver
**subscribes and polls**.

---

## 7. Divergences from the knowledge base's own wording

Recorded so a later sync knows what was a choice and what was a finding.

1. **A cart line is spelled `variant_name`, and the pinned contract still says `name`.** The
   Markdown records the rename and the three added members (`product_public_id`, `product_slug`,
   `product_name`); `openapi.yaml` does not. `CartLine` is therefore hand-written to the Markdown
   and `Cart` is `Omit<…, "items"> & { items: CartLine[] }`. **Open question for the knowledge
   base:** the contract is behind its own folder here.
2. **`billing_address` is `Address | null`, and the contract says non-null.** The generated
   `Order.billing_address` and `CheckoutRequest.billing_address` collapse through an `allOf`
   artefact — `(Address | null) & Address` — which erases the `null` the service documents as "the
   same as shipping". `Order` and `CheckoutInput` are hand-written for that one member, and a
   `satisfies` chain in `test/type-safety.test.ts` proves a fully spelled-out input still fits the
   generated type.
3. **`Order.status` is widened** beyond the generated seven-value union, on the authority of
   storefront-api.md's *"still do not hard-code the reachable set"*. `KnownOrderStatus` keeps the
   closed set for the `status` **filter**, where an unknown value is a `400`.
4. **`MinorAmount` is an alias, not a brand** — see §3. A deliberate departure from payment's and
   email's treatment of the same rule, because this package never sends an amount.
5. **`CheckoutPayment.status` is left opaque.** It is payment-service's vocabulary republished
   verbatim and is not validated against a list by the service either. The TSDoc says never to map
   it onto an order status.
6. **`/healthz` is not exposed.** conventions.md lists it under monitoring, not a tier, and it
   dropped its `database` member at `18c4a9a`. Nothing in a consumer's surface reads it.
7. **The doc example at `storefront-api.md:601` is abbreviated**, not wrong: it shows four of the
   order's twenty members beside the `payment` block. Its classifier checks the undeclared
   direction only, and the plan records why — a `required` list would fail on an excerpt the
   service wrote as an excerpt.
8. **Two `403`s, one status.** The service's `403` table distinguishes the browser tripwire from a
   key on the wrong tier by `detail` alone — there is no `code` for either. The SDK does not branch
   on it and neither should a caller; the live suite asserts the status and leaves the prose alone.

---

## Public API surface

```ts
// @lazslov/webshop
export { createWebshopPublicClient, tryCreateWebshopPublicClient, type WebshopPublicClient }
export { createWebshopClient, tryCreateWebshopClient, type WebshopClient }
export { WebshopApiError, type WebshopProblemCode, type WebshopProviderError }
export { isConfirmed, isTerminal, type OrderStatus, type KnownOrderStatus }
export { verifyWebshopWebhook, parseWebshopWebhookEvent, isKnownEvent }
export { signatureHeader, timestampHeader, eventIdHeader, deliveryIdHeader }
export const VERSION
export type { CatalogFresh, CatalogNotModified, CatalogRead, ConditionalOptions }
export type { CursorListOptions, OrderListOptions, RequestOptions, WebshopRequest }
export type { CartMethods, CatalogMethods, CheckoutMethods, IdentityMethods, OrderMethods, PublicCatalogMethods }
export type { Address, Cart, CartLine, CartStatus, Currency, MinorAmount, Order, OrderLine, Product, ProductType, ProductVariant, ShippingOption, StorefrontIdentity }
export type { AddCartItemInput, ApplyCouponInput, CheckoutInput, CheckoutOrder, CheckoutPayment, CheckoutResult, CreateCartInput, SetCartItemQuantityInput, SetShippingMethodInput }
export type { KnownWebshopEvent, WebhookCustomerBlock, WebhookOrderBlock, WebhookOrderLine, WebshopEventData, WebshopEventEnvelope, WebshopEventTenant, WebshopWebhookEvent, WebshopWebhookEventType, WebshopWebhookInput }

// @lazslov/webshop/next
export { createWebshopWebhookHandler, type WebshopWebhookHandlerOptions }
```

Fifteen runtime exports, asserted exactly by `test/public-surface.test.ts`.

---

## Exit criteria

Restating the resume path and the receiver rules as tests:

- [x] Two clients, four constructors. The storefront client offers exactly sixteen endpoints and the public client exactly two, counted from the object itself.
- [x] `createWebshopClient` throws in a browser naming rotation; `createWebshopPublicClient` constructs with a `wpk_` there and throws for a `wsk_`, naming `WEBSHOP_SECRET_KEY`.
- [x] The public client reads `WEBSHOP_PUBLISHABLE_KEY` and does **not** fall back to the secret key. `WEBSHOP_SECRET_KEY` is read verbatim, and a test asserts that name.
- [x] `try*` answers `null` only for `NotConfiguredError`; a leaked key still throws.
- [x] No admin path, no `/v1/hooks`, no `/api/cron` appears in the source. No deployment host, no default base URL, no `mode`, no `Origin`, no timeout, no minted key. Grep-asserted.
- [x] A conditional public read sends `If-None-Match` and turns a `304` into `notModified: true` with its `etag`; every other failure still throws. A stripped `ETag` reads as `null`.
- [x] `getProduct` maps the documented `404` to `null` on both tiers, and only that status; `getCart` and `getOrder` throw on a `404` whose message names the wrong-shop possibility and the key variable.
- [x] `checkout` has no overload lacking an `IdempotencyKey`; a raw string is a type error. The body reaches `fetch` unnormalised.
- [x] `replayed` is read from the header alone. A `429`, a `502 payment_create_unknown` and a `502 payment_create_rejected` each carry the resume advice, and only the last is not retryable.
- [x] Every one of the seventeen `code` values is recognised; an invented one and an invented `provider_error` are dropped.
- [x] The seven hopeless `422`s are not retryable and the rest are; `409 idempotency_in_flight` is retryable and `idempotency_key_reused` is not.
- [x] `listOrders` passes every filter under its wire name and sends no query when nothing was asked for; every list answers `{ items, nextCursor }` with no `total`, and a cursor goes back verbatim.
- [x] `isConfirmed` is false for `pending` and for `paid`; both predicates are false for a status this SDK has never heard of.
- [x] A cart line has `variant_name` and the three product members and **no** `name`; a string `quantity` is a compile error; reading a `total` on a list is a compile error.
- [x] `verifyWebshopWebhook` passes every pinned fixture, including a non-ASCII body and the stripped-prefix case, and never throws.
- [x] `parseWebshopWebhookEvent` keeps an unknown type, accepts `webhook.ping`, answers `null` for a known type with no order block, and carries an `order.created`'s status through untouched.
- [x] The route handler dedupes on `X-Event-Id` and not `X-Delivery-Id`, falls back to the payload's `event_id`, marks after `onEvent`, answers `500` without marking on a throw, `200` for a duplicate and for an unknown type, `401` naming the edge runtime, and `500` naming the variable when unset. It imports nothing from `next` (node baseline).
- [x] Every documented JSON example is claimed: 101 examples, 39 key-checked across 14 classifiers, 57 of the remainder on the admin tier.
- [ ] **The resume path itself is unproven end to end.** The unit suite proves what the SDK reports for a `429` and both `502`s; that a re-POST under the same key actually returns the *same* `order.public_id` is a claim about the service, and proving it needs a checkout — which the live suite refuses to make. See below.
- [ ] Live: `401` unknown key, `403` tripwire before auth, `403` for a `wpk_` on the storefront tier, `404` stranger order id, `400` on a loose `?from=`. **Not run** — no `WEBSHOP_*` credentials in this environment.

## What the live suite deliberately does not do

**It creates nothing — not a cart, and above all not a checkout.** A checkout commits an order that
holds real stock, and the failure modes this package exists to document commit one *as well*: a
`429` or a `502` from a probe would take a shop's last unit off the shelf until
`inventory.release_expired` sweeps it, which on this deployment is the next morning. Every case is
a `GET` or a refusal, so `allowWrites` gates nothing here — there is nothing behind it to gate.

The consequence is stated rather than hidden: the resume path, `replayed`, `payment: null` and the
`Idempotent-Replay` header are proved against stubs and against the documentation, and not against
a running shop. Proving them needs a scratch shop whose stock nobody is selling, and that is a
provisioning task rather than a test.

## Out of scope here

The admin tier, the inbound receiver, the cron routes, `/healthz`, and every absence the service
itself records: a refund route, an operator override on an order's status, statistics, stock
returning on a refund, a per-shop CORS origin allowlist, and a browser-only storefront.
