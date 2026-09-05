# @lazslov/webshop

Consumer SDK for webshop-service — the `wpk_` public catalog a browser may read, the `wsk_`
storefront tier that runs carts, checkout and orders, and the events the shop emits.

**What ships in it:** two clients for the two credentials, the public tier's `ETag` / `304`
contract, the sixteen storefront endpoints, RFC 9457 error triage by `status` **and** `code`, the
checkout resume path encoded as `retryable` and `advice`, webhook verification, and the webhook
route handler on `@lazslov/webshop/next`.

## Install

```sh
pnpm add @lazslov/webshop
```

Zero runtime dependencies except `@lazslov/api-core`, which is the shared transport.

## Configuration comes from your environment

```ini
WEBSHOP_SERVICE_BASE_URL=https://webshop.example.com
WEBSHOP_PUBLISHABLE_KEY=wpk_YOUR_PUBLISHABLE_KEY
WEBSHOP_SECRET_KEY=wsk_YOUR_SECRET_KEY
WEBSHOP_WEBHOOK_SECRET=whsec_YOUR_SIGNING_SECRET
```

`WEBSHOP_SECRET_KEY` is **the knowledge base's own name** — the integration snippet in the
service's `workflows.md` reads exactly that variable. It breaks the estate's
`<SERVICE>_SERVICE_<ROLE>` pattern, and this SDK keeps it rather than harmonising it: a tidier name
that nobody's `.env` contains is an outage on the next deploy. The other three names are this SDK's
proposals; the service documents no variable for them.

There is **no fallback host**: a missing base URL is a configuration error the SDK reports, never a
silent default.

## Two credentials, two clients

| | `createWebshopPublicClient` | `createWebshopClient` |
| --- | --- | --- |
| Key | `wpk_` publishable | `wsk_` secret |
| Where it may live | page source | a server, only |
| Surface | two catalog `GET`s | catalog, carts, checkout, orders |
| Caching | `ETag` and `s-maxage=60` | none |

Two constructors rather than one client with a tier parameter, because the credentials have
different blast radii. A single object holding a `wsk_` that *can* serve public reads is a `wsk_`
that ends up in a client component; separate constructors mean the import graph shows which tier a
module touches.

### Never import the storefront client into a browser bundle

A `wsk_` key can check out and read every order the shop has. The service enforces this itself: any
request to `/v1/*` carrying an `Origin` or `Sec-Fetch-Dest` header is refused with a `403` **before
the key is looked up**. `createWebshopClient` throws earlier still, at construction — because by
the time that `403` arrives the key has shipped to every visitor, and the only remedy is
**rotating** it.

`createWebshopPublicClient` applies the same guard **per key**: a `wpk_` in a browser is the point
of the tier, a `wsk_` there is a leak. Neither client sets `mode` and neither sets `Origin`; the
tripwire keys on `Sec-Fetch-Dest`, which Node's `fetch` does not send.

`tryCreateWebshopPublicClient()` and `tryCreateWebshopClient()` return `null` instead of throwing
when nothing is configured, so a storefront boots and renders — with buying disabled — in an
environment that has no credentials. A leaked key still throws.

> **The public tier has no origin allowlist of any kind.** The knowledge base records this as a
> standing defect: the phase-7 CORS work added response headers, not a restriction, and every
> origin that asks is answered. A per-IP throttle is what protects the tier. If you need an
> allowlist, it is yours to put in front of it.

## Amounts

Every amount is a **decimal string of minor units**, and it never travels without its `currency`.
`^(0|[1-9][0-9]{0,17})$` — no sign, no point, no exponent, no leading zero.

- **HUF has zero minor units.** `"4990"` HUF is 4990 Ft. EUR is two-decimal, so `"1000"` is €10.00.
- **Prices are gross and tax is contained, never added.** `tax_total` is already inside
  `grand_total`. Adding them double-counts, and it is the most expensive mistake here.
- **Stock counts are strings too**, for the same reason. A line `quantity` is the one count that is
  a JSON **number**.

This package reads amounts and never computes with them. There is no money type, no arithmetic and
no formatting: the service prices every cart and every order, and there is exactly one place the
rounding rule lives.

## The public catalog

```ts
import { createWebshopPublicClient } from "@lazslov/webshop";

const catalog = createWebshopPublicClient();

const first = await catalog.listProducts({ limit: 24 });
render(first.value.items);

// …a minute later, revalidating rather than refetching:
const again = await catalog.listProducts({ limit: 24, ifNoneMatch: first.etag ?? "" });
if (!again.notModified) render(again.value.items);
```

Every read returns its validator beside the value, and a conditional read may answer
`notModified: true` instead of a value — so narrow on `notModified` before reading `value`.
`getProduct(idOrSlug)` answers `null` for the documented `404`: an unknown slug, a `draft` product
or an `archived` one. That `404` is cached at the edge for ten seconds, so wait ten seconds after
publishing before you investigate one.

`limit` is part of the validator: an `etag` from `limit=24` never matches a read at `limit=50`.
And **a price change moves a variant row, not a product row** — the single-product validator reads
both, the list validator reads only the product, so budget one minute of stale pricing on a list
page. There is no purge and no invalidation webhook; sixty seconds is the whole story.

The storefront client serves the **same shapes from the same implementation**, without cache
headers, so a backend and a browser never disagree about what is published.

## Check the key on boot

`getMe()` is the one call that says *which shop* a key belongs to, and pointing a staging
storefront at a production shop is the failure it catches. Read `shop.currency` to decide how to
format every amount. `shop.status` is deliberately absent: a suspended shop's keys all answer
`401`, so a shop that answers this call is active by definition.

## The cart

```ts
import "server-only";
import { createWebshopClient } from "@lazslov/webshop";

const shop = createWebshopClient();

const cart = await shop.createCart(); // not idempotent — each call makes a new cart
const priced = await shop.addCartItem(cart.public_id, { variant_id: variantId, quantity: 2 });

if (priced.has_unavailable_items) return askToRemoveUnavailableLines(priced);
render(priced.grand_total, priced.currency); // never sum the lines yourself
```

**Every mutation returns the whole cart, priced.** A storefront never adds anything up and never
needs a second call to find out what changed.

- **Add by a *variant's* `public_id`**, never a product's. A single-option product still has one
  variant.
- **`addCartItem` adds.** There is one line per variant, so two calls of `quantity: 2` make 4, and
  the 99 cap applies to the resulting line. `setCartItemQuantity` takes an **absolute** quantity,
  which is what makes it the safe call to retry.
- **An unavailable line stays listed, shows its own `unit_price`, and contributes `"0"` to every
  total** — so `subtotal` does not equal the sum of the lines. Branch on `has_unavailable_items`,
  and expect checkout to refuse the cart until the line is gone.
- **Branch on `coupon_applied`, not on `discount_total`.** A `coupon_code` set with
  `coupon_applied: false` is a lapsed campaign, and it is the normal way one ends. Show the pair.
- A cart line carries `variant_name`, `product_public_id`, `product_slug` and `product_name`, and
  **no `name`.** The pinned contract still spells the line `name`; the service renamed it, so a
  storefront written against the contract reads `undefined`.
- `status` is computed: `expires_at` in the past reads as `expired` whatever a clock of yours says.
  A cart expires 30 days after creation and no mutation extends that.
- **Carriage can be withdrawn under a cart.** An operator deactivating a method leaves the cart
  reading `shipping_method_id: null` and `shipping_total: "0"` with no error — and checkout then
  refuses it. Re-read the cart before you check out, or handle the `422` by re-offering
  `listShippingOptions`.
- **A cart is not scoped to a customer or a session.** Anyone with a `wsk_` key and a cart's
  `public_id` can read and mutate it, so keep cart ids server-side.

`getCart` **throws** on a `404` rather than answering `null`: another shop's cart and a malformed
id both read as `404`, and a cart id you hold came from a cart you created.

## Checkout

```ts
import { derivedIdempotencyKey } from "@lazslov/api-core";

const key = derivedIdempotencyKey(`checkout-${cart.public_id}`, 1);

const { order, replayed } = await shop.checkout(
  cart.public_id,
  { guest_email: "ada@example.com", shipping_address: address },
  key,
);

await store(order.public_id); // the only handle for reads, cancels and support
if (order.payment?.gateway_url) redirect(order.payment.gateway_url);
```

`Idempotency-Key` is **required** and there is no overload without one. Derive it from the
**intent** — one key per checkout button press — never from the clock. Keep `attempt` at `1` across
every retry of that press: incrementing it is how you start a second order. Send a **byte-identical
body** on a retry; a changed one is `409 idempotency_key_reused`, not a resume. A completed key
replays for 24 hours.

Nothing about money is in the body. Totals come from the cart, because a checkout that let a caller
state a price would be a checkout that let them choose one. Supply `customer_id` **or**
`guest_email`; neither is individually required and a body with neither is a `400` carrying two
issues.

> **The `201` is not a paid order, and `gateway_url` is not proof of payment.** The order is
> `pending` until payment-service reports success — asynchronously — at which point it becomes
> `paid` and then `confirmed` inside one transaction. **Wait for `confirmed`, never for `paid`**,
> which you will almost never observe. `isConfirmed(status)` is that rule.

> **`payment: null` means the shop holds no payment credential.** The order still committed and
> still holds stock; there is nothing to redirect to. Handle a `null` `payment` and a `null`
> `payment.gateway_url` as the same thing: **do not redirect.** No sweep will invent a payment —
> an operator has to provision the shop.

### The resume path

**A `429` or a `502` from checkout is not a failed checkout.** The payment call runs *after* the
checkout transaction commits, so both leave a real, `pending`, stock-holding order behind.

The recovery is to re-POST the **identical** request under the **same** `Idempotency-Key`. The key
is *lapsed* rather than released, so the retry keeps the order it already named, resumes at the
payment, and answers **that same order**. There is no lease to wait out.

```ts
import { WebshopApiError } from "@lazslov/webshop";

try {
  return await shop.checkout(cart.public_id, body, key);
} catch (error) {
  if (!(error instanceof WebshopApiError)) throw error;
  // These two statuses are the ones that commit an order. `retryable` is false for the one 502 an
  // operator has to fix first. Same key, same body, same cart — nothing else resumes.
  const committedAnOrder = error.status === 429 || error.status === 502;
  if (committedAnOrder && error.retryable) return await shop.checkout(cart.public_id, body, key);
  throw error;
}
```

**Do not start a new cart and do not mint a new key.** Under a new key the converted cart answers
`422 cart_converted` — a dead end with a real paid-for-nothing order behind it. A resume that turns
out to be unnecessary is safe: the derived key at payment-service returns that same payment rather
than creating a second one.

A pre-commit `400` or `422` is the other case. It committed nothing and **released** the key, so
fix the body and reuse it. Either way, the same key is the right thing to send next.

`replayed` is `true` only when the service answered with the frozen bytes of an earlier request.
**A resume reports `false`**, because it produces its response for the first time — so `false`
covers both a first attempt and a recovery. What identifies the outcome is `order.public_id`, which
a resume never changes.

## Errors: branch on `status` and `code`

Every failure is `application/problem+json` under `urn:webshop-service:problem:<slug>`, over the
estate's closed slug set. **One `type` covers two statuses**, so the type alone is not a branch:
`conflict` is `409` for the idempotency codes and `422` for every state refusal, and `internal` is
`500` and `502` alike. Never branch on `title` or `detail` — `title` summarises the HTTP status.

`retryable` answers one question: can the **identical** request succeed? It is not the same
question as "may I reuse the key", which a `400` answers yes to and this column answers no to.

| Status · `code` | `retryable` | What to do |
| --- | --- | --- |
| `400` with `errors[]` | no | The same body fails the same way. Fix it and **reuse the key** — nothing was created. |
| `401` | no | An unknown key, a revoked key and a suspended shop are byte-identical. Ask an operator. |
| `403` | no | The browser tripwire, or a key on the wrong tier. Both are informative. |
| `404` | no | Another shop's row, or a malformed id — never a `403`, which would confirm it exists. |
| `409 idempotency_in_flight` | **yes**, after a pause | A concurrent attempt holds the 60-second lease. Same key. |
| `409 idempotency_key_reused` | no | Same key, different body. A client bug. |
| `422 insufficient_stock` | yes | Somebody bought it while you were checking out. Normal traffic. |
| `422 variant_unavailable` | yes | Archived, unpublished, or another shop's variant. Remove the line. |
| `422 cart_expired` · `cart_converted` | **no** | The cart is gone. For `cart_converted`, find the order. |
| `422 coupon_invalid` · `coupon_expired` · `coupon_exhausted` | **no** | The campaign is over. |
| `422 coupon_minimum_not_met` | yes | The one refusal that names a number, measured against the **subtotal**. |
| `422 shipping_method_inactive` | **no** | An operator withdrew it. Re-offer the options. |
| `422 invalid_transition` | yes | The order is `paid` or `confirmed` — not cancellable, but not terminal either. |
| `422 order_terminal` | **no** | `fulfilled` or `refunded`. Nothing moves it. |
| `429` on checkout | **yes** | The payment throttle fired **after** the commit. Wait `retryAfter`, then resume. |
| `502 payment_create_rejected` | **no** | payment-service refused this shop's credential. An operator acts first. |
| `502 payment_create_unknown` | **yes** | A payment may or may not exist. Resume; the derived key makes one payment, not two. |

`error.advice` carries the prose for each case where the naive reading of a status strands an
order. `error.providerError` is present only on a `502`. `coupon_invalid` is deliberately
uninformative — unknown, withdrawn, not yet started and wrong-currency all read the same, so the
endpoint is not a campaign-schedule oracle.

## Orders

```ts
const order = await shop.getOrder(publicId);
if (isConfirmed(order.status)) await fulfil(order);
if (isTerminal(order.status)) await stopPolling(order.public_id);
```

An order is immutable history: every value the buyer was shown is copied at checkout and no read
joins the live catalog. **`status` is widened beyond the seven the service documents today** —
treat a value you do not recognise as "in progress, do not act", which is what both predicates do.
`isConfirmed` is `confirmed` and `fulfilled`; `isTerminal` is `fulfilled`, `canceled` and
`refunded`. `canceled` has one `l`.

`listOrders` is keyset-paged with **no `total`**. Follow `nextCursor` until it is `null`, or hand
the method to `collectAllCursor` from `@lazslov/api-core`. Its `from` and `until` filters test
`created_at` and are **strict ISO 8601**: a full instant with an offset, or a bare `YYYY-MM-DD`
read as UTC midnight. `?from=2026` used to widen the window silently and is now a `400`.

`cancelOrder` sends no body and no `Idempotency-Key`. The reservation goes back in the **same
transaction** as the status change, and cancelling an already-canceled order answers `200` rather
than `422` — so it is safe to retry. **It does not cancel the payment.** A buyer who cancels and
then completes the gateway redirect anyway produces a `payment.succeeded` for a canceled order; the
money is at payment-service and a human resolves it there.

## Webhooks

```ts
export const runtime = "nodejs"; // an edge runtime may transform the body

export async function POST(request: Request) {
  const rawBody = await request.text(); // BEFORE any parsing
  const verdict = await verifyWebshopWebhook({
    secret: process.env.WEBSHOP_WEBHOOK_SECRET!,
    rawBody,
    headers: request.headers,
  });
  if (!verdict.ok) return new Response(verdict.reason, { status: 401 });

  const eventId = request.headers.get("x-event-id")!;
  if (await alreadyProcessed(eventId)) return new Response(null, { status: 200 });

  const event = parseWebshopWebhookEvent(rawBody);
  if (!event) return new Response("malformed", { status: 400 });

  if (isKnownEvent(event)) await enqueue(event.data.order.public_id, event.data.order.status);
  await markProcessed(eventId);
  return new Response(null, { status: 200 });
}
```

- Verification and parsing are two functions, so a handler cannot parse before it verifies.
- The whole `whsec_…` string is the key — the prefix is key material, not a label to strip.
- **Dedupe on `X-Event-Id`**, which is stable across every retry and every operator redelivery.
  `X-Delivery-Id` is per attempt, and deduping on it would process one event up to eight times.
- **Answer `2xx` within 5 seconds** and do the real work asynchronously. Eight failed attempts
  dead-letter the delivery; five exhausted ladders disable your endpoint entirely.
- **Ignore an event type you do not recognise and still answer `2xx`.** `isKnownEvent` is the
  guard; a new type is additive, and refusing one dead-letters a delivery that was fine.
- `data.customer` — the buyer's email and addresses — arrives **only** when an operator has ticked
  `include_customer` on your endpoint. The default is off.

Six events: `order.created`, `.confirmed`, `.payment_failed`, `.canceled`, `.fulfilled` and
`.refunded`, plus `webhook.ping` from an operator's test. There is no `order.paid`.

> **`order.created` is an observation, not a confirmation.** "Created" is not a status, so nothing
> binds `data.order.status` on it. Today it always lands on `pending`, and the service deliberately
> does not promise that. **Read `data.order.status`; never branch on the event name alone.** For
> every other event the name and the status agree, and the service's own tests enforce it.

### Subscribe *and* poll

The retry ladder is published in minutes — 1 min to 48 h over eight attempts — and delivered in
days. Only the first attempt is inline; every later rung waits for a drain that runs **once a day**
on this deployment. A receiver that is down for ten minutes gets the missed event the next morning,
and a disabled endpoint gets nothing at all until an operator re-enables it.

So an event is a notification rather than a fact. `getOrder` is the authority, and a periodic
`listOrders({ from, until })` is how you find the gap.

## `@lazslov/webshop/next` — the route handler, written for you

```ts
// app/api/webhooks/webshop/route.ts
export const runtime = "nodejs"; // an edge runtime may transform the body, which breaks the HMAC

import { isKnownEvent } from "@lazslov/webshop";
import { createWebshopWebhookHandler } from "@lazslov/webshop/next";

export const POST = createWebshopWebhookHandler({
  alreadyProcessed: (id) => db.webhookEvents.exists(id),
  markProcessed: (id) => db.webhookEvents.insert(id),
  onEvent: async (event) => {
    if (!isKnownEvent(event)) return; // a ping, or a type added after this SDK shipped
    await queue.push({ orderId: event.data.order.public_id, status: event.data.order.status });
  },
});
```

**`alreadyProcessed` and `markProcessed` are required parameters.** Delivery is at-least-once and
unordered, the dedupe is not optional, and the SDK owns no storage — so the most it can do is make
forgetting them a compile error. Back them with a unique constraint in your own database, not an
in-memory set.

| Answer | When |
| --- | --- |
| `401` | verification failed — the body names the edge runtime, which is the cause far more often than a wrong secret |
| `400` | verified, but the body is not an event |
| `200` `duplicate` | already processed. `onEvent` is **not** called — a duplicate is a success |
| `200` `accepted` | enqueued and marked — including for an event type this SDK does not know |
| `500` | `onEvent` threw. `markProcessed` is **not** reached, so the sender retries |

`onEvent` runs only after the dedupe passes, and `markProcessed` only after `onEvent` resolves — a
crash in between yields a redelivery, which is the safe direction. Outside production the handler
warns once if `onEvent` takes over 3 seconds.

This subpath imports **nothing** from `next`: the handler takes a `Request` and answers a
`Response`, so it runs unchanged in any Web-standard runtime, and this package declares no peer
dependency. An unset `WEBSHOP_WEBHOOK_SECRET` answers `500` on delivery rather than throwing at
import.

## What is not here

The admin tier (`wad_`) — provisioning, keys, inventory, coupons, carriage, webhook endpoints and
the audit log. The cron routes. And `/v1/hooks/payment-service`, which is payment-service's traffic
*into* webshop-service and never yours to call.

Also absent because the service has none: a refund route, an operator override on an order's
status, statistics, stock returning on a refund, and a browser-only storefront — carts, checkout
and orders are `wsk_` only, because an order carries a postal address and an email address.

## Licence

MIT.
