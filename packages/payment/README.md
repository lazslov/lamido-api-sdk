# @lamido/payment

Consumer SDK for payment-service — Stripe and Barion behind one uniform merchant-tier API,
using each merchant's own PSP credentials.

**Status: phase 6.** All seven merchant endpoints, the money type, RFC 7807 triage, webhook
verification, the reconciliation backstop, and the webhook route handler on
`@lamido/payment/next`.

## Install

```sh
pnpm add @lamido/payment
```

Zero runtime dependencies except `@lamido/api-core`, which is the shared transport.

## Configuration comes from your environment

```ini
PAYMENT_SERVICE_URL=https://payment.example.com
PAYMENT_SERVICE_KEY=pmk_YOUR_MERCHANT_KEY
PAYMENT_SERVICE_WEBHOOK_SECRET=whsec_YOUR_SIGNING_SECRET
```

Note `PAYMENT_SERVICE_URL`, not `_BASE_URL` — this service's documented name differs from the
other two, and the SDK does not harmonise a name a deployment already sets. There is **no
fallback host**: a missing base URL is a configuration error the SDK reports, never a silent
default.

**Mode is a property of your credential**, not of your request. There is no `sandbox` option,
no test hostname and no `test: true` flag; every payment reports the `mode` it was created
under. A preview deployment cannot reach live money at all — the service refuses to construct a
live PSP adapter outside production.

## Never import this into a browser bundle

A `pmk_` key can take payments and move money back out. The service enforces this itself: any
request to `/v1/*` carrying an `Origin` header or `Sec-Fetch-Mode: cors` is rejected with a
`403` **before authentication runs**. `createPaymentClient` throws earlier still, at
construction — because by the time that 403 arrives, the key has shipped to every visitor and
the only remedy left is **rotating** it.

`tryCreatePaymentClient()` returns `null` instead of throwing when nothing is configured, so a
checkout renders with payment disabled rather than crashing. A leaked key still throws.

## Amounts

> **HUF has zero minor units in this API.** `"1000"` HUF means **1000 Ft**, not 10.00 Ft. EUR is
> two-decimal, so `"1000"` EUR means €10.00.

Every amount is a decimal string of canonical minor units, never a JavaScript `number`: JSON
numbers lose precision above 2^53 and floating point cannot represent `9.99`.

```ts
import { eurCents, huf, minorUnits } from "@lamido/payment";

huf(2500); // "2500" → 2500 Ft
eurCents(1000); // "1000" → €10.00
minorUnits("2500"); // for an amount that is already in minor units
```

`MinorUnits` is branded, so `{ amount_minor: "25.00" }` is a **compile** error rather than a
`400` — or worse, a charge in the wrong units. `minorUnits` rejects locally everything the
service rejects, and each rejection says something about the caller:

| Rejected | What it means |
| --- | --- |
| `"25.00"` | thinking in major units |
| `"1e3"` | a float leaked into the request |
| `" 1"` | a value was concatenated rather than computed |
| `"01"` | string manipulation on amounts |
| `"0"` | a zero-amount payment, which no path may create |

`huf(10.5)` throws rather than rounding. There is **no arithmetic** here — no `add`, no `sum`,
no conversion to or from `@lamido/invoice`'s major-unit numbers. Totals in the service are
always grouped by currency and never summed across them; do arithmetic in `BigInt`, in your own
code, visibly.

## Taking a payment

```ts
import "server-only";
import { derivedIdempotencyKey } from "@lamido/api-core";
import { createPaymentClient, huf, isFulfillable } from "@lamido/payment";

const payments = createPaymentClient();

const { payment, replayed } = await payments.createPayment(
  { merchant_payment_ref: order.id, amount_minor: huf(2500), currency: "HUF" },
  derivedIdempotencyKey(`order-${order.id}`, 1),
);

if (!payment.gateway_url) throw new Error("no gateway yet — do not redirect");
redirect(payment.gateway_url);
```

`Idempotency-Key` is required on both creates and there is no overload without one. Derive it
**from the operation, not from the clock**: `order-12345-attempt-1`, never a fresh UUID per
retry. Payment keys live 7 days and refund keys 24 hours, scoped per merchant *and* per
operation type. `replayed: true` means the service answered `200` with the frozen body of an
earlier identical request — nothing was created, and that is a success.

`merchant_payment_ref` is **not** an idempotency key: it is not required to be unique, because
a retried checkout of the same cart legitimately reuses it.

There is no buyer PII field anywhere, and `metadata` is not a way around that — it is stored
unencrypted and echoed back on every read.

## Never fulfil on `pending`

```ts
const settled = await payments.getPayment(publicId);
if (isFulfillable(settled.status)) await fulfil(order);
```

`pending` means the buyer has been sent to a gateway and nothing more. `isFulfillable` is
`true` only for `succeeded` — `authorized` is excluded too, because funds are held rather than
captured and this service drives no capture step.

Branch on `status`, never on `provider`. `provider_status` is the PSP's own word verbatim
(`"Succeeded"`, `"complete/paid→pi:succeeded"`) and exists so an unmapped status is still
actionable by a human.

`getPayment` **throws** on a `404` rather than answering `null`: every read is scoped to your
merchant inside the same SQL predicate that fetches the row, so another merchant's id is
indistinguishable from one that does not exist. A payment id you hold came from a payment you
created — the error says so, and names the wrong-key possibility.

## When a 502 arrives

A 502 means the PSP, not the service, and it has four distinct meanings. The SDK classifies
them — the one place it reads a problem's `detail`:

| `providerOutcome` | What happened | Retry |
| --- | --- | --- |
| `rejected` | definitively nothing happened at the PSP | safe, **same key**, once fixed |
| `unknown` | the PSP could not be reached | **same key only** |
| `refund_unknown` | a refund was sent, no answer | **no** — read the refund |
| `untrusted` | an integrity check failed | **no** — escalate |
| `unclassified` | the message matched nothing known | **no** |

> **A new key after an unanswered request is how double charges happen.** Barion does not
> deduplicate on its own request id: two identical calls with the same `PaymentRequestId`
> produce two payments. An unreachable PSP means "we do not know", not "it failed".

An unrecognised message classifies as `unclassified` with `retryable: false` — never as
`rejected`, the only value that permits a free retry. If the service rewords a message, this
SDK becomes *more* cautious.

Elsewhere: a `422` carries `conflictCode` and **is** retryable later, because all four causes
describe the payment's *state* and state changes. A `409` is not — except an attempt still in
flight, whose 60-second lease clears; that error carries a note saying to pause and reuse the
same key.

## Refunds

```ts
const { refund } = await payments.createRefund(
  publicId,
  { amount_minor: minorUnits(remaining), currency: "HUF", reason: "ticket #812" },
  derivedIdempotencyKey(`refund-${order.id}-1`, 1),
);
```

**This moves real money and there is no confirmation step** — your backend owns the "are you
sure" UX. There is no "refund the rest" shortcut, because a default would refund different
amounts depending on when the request arrived; take the amount from what the API reports as
remaining, not from your own bookkeeping. The remaining balance is enforced by database CHECK
constraints, so any pre-check you build is advisory.

Never re-issue a refund under a new key because the first did not answer.

## Webhooks

```ts
export const runtime = "nodejs"; // an edge runtime may transform the body

export async function POST(request: Request) {
  const rawBody = await request.text(); // BEFORE any parsing
  const verdict = await verifyPaymentWebhook({
    secret: process.env.PAYMENT_SERVICE_WEBHOOK_SECRET!,
    rawBody,
    headers: request.headers,
  });
  if (!verdict.ok) return new Response(verdict.reason, { status: 401 });

  const eventId = request.headers.get("x-event-id")!;
  if (await alreadyProcessed(eventId)) return new Response(null, { status: 200 });

  const event = parsePaymentWebhookEvent(rawBody);
  if (!event) return new Response("malformed", { status: 400 });

  await enqueueFulfilment(event); // the slow work goes off this request
  await markProcessed(eventId);
  return new Response(null, { status: 200 });
}
```

- Verification and parsing are two functions, so a handler cannot parse before it verifies.
- The whole `whsec_…` string is the key — the prefix is key material, not a label to strip.
- **Dedupe on `X-Event-Id`**, which is stable across retries; `X-Delivery-Id` is per attempt.
  Delivery is at-least-once and the dedupe is not optional.
- **Answer `2xx` within 5 seconds** and do the real work asynchronously. Eight failed attempts
  dead-letter the delivery, and five consecutive dead-letters disable your endpoint entirely.
- Ordering is **not guaranteed**: reconcile against `payment.status` in the payload, not arrival
  order.
- `payment.id` in a payload **is** the payment's `public_id`. The payload is a frozen wire
  format and the SDK does not rename the field, so a payload and a REST response can be read
  side by side.

`listWebhookDeliveries()` answers "why haven't I received the event?" without a support ticket —
including *your* HTTP status on the last attempt, which is usually where the problem is.

## `@lamido/payment/next` — the route handler, written for you

The whole route, with every rule above enforced rather than remembered:

```ts
// app/api/webhooks/payment/route.ts
export const runtime = "nodejs"; // an edge runtime may transform the body, which breaks the HMAC

import { createPaymentWebhookHandler } from "@lamido/payment/next";

export const POST = createPaymentWebhookHandler({
  alreadyProcessed: (id) => db.webhookEvents.exists(id),
  markProcessed: (id) => db.webhookEvents.insert(id),
  onEvent: async (event) => {
    await queue.push({ type: event.event_type, paymentId: event.payment.id });
  },
});
```

**`alreadyProcessed` and `markProcessed` are required parameters.** Delivery is at-least-once, the
dedupe is not optional, and the SDK owns no storage — so the most it can do is make forgetting them a
compile error rather than a doubled fulfilment you find out about from a customer's second charge.
Back them with a unique constraint in your own database, not an in-memory set: that set is empty
again on the next cold start.

| Answer | When |
| --- | --- |
| `401` | verification failed — the body names the edge runtime, which is the cause far more often than a wrong secret |
| `400` | verified, but the body is not an event |
| `200` `duplicate` | already processed. `onEvent` is **not** called — a duplicate is a success, the sender's job is done |
| `200` `accepted` | enqueued and marked |
| `500` | `onEvent` threw. `markProcessed` is **not** reached, so the sender retries |

`onEvent` runs only after the dedupe passes, and `markProcessed` only after `onEvent` resolves — a
crash in between yields a redelivery, which is the safe direction. Outside production the handler
warns once if `onEvent` takes over 3 seconds, because the production symptom of a slow one is
dead-lettering days later.

This subpath imports **nothing** from `next`: the handler takes a `Request` and answers a `Response`,
so it runs unchanged in any Web-standard runtime, and this package declares no peer dependency. It
lives on `./next` because that is where you would look for a route handler, and because
`export const runtime = "nodejs"` is the Next-specific line that keeps the signature valid.

An unset `PAYMENT_SERVICE_WEBHOOK_SECRET` answers `500` on delivery rather than throwing at import: a
route module that throws on import takes the whole route tree down, and would stop the site building
with an empty environment.

## The reconciliation backstop

Retry intervals are **floors, not promises**: a delivery becomes eligible at its next attempt
time and is then attempted by the next sweep, which can be hours later. So nothing may assume a
webhook arrives within a bounded time.

```ts
const results = await reconcilePayments(payments, {
  publicIds: orders.map((order) => order.paymentPublicId),
  onStatus: (publicId, payment) => applyPaymentStatus(publicId, payment.status),
});
for (const result of results) {
  if (result.retryAfterSeconds) scheduleRecheck(result.publicId, result.retryAfterSeconds);
}
```

It reads each payment, refreshes only the `pending` ones, never refreshes a terminal payment,
and serialises per id — `refresh` is throttled to one call per payment per 5 seconds, and a
failed refresh consumes the window too. A `429` comes back as `retryAfterSeconds` rather than
being retried or swallowed. Scheduling, storage and the "orders awaiting payment older than N
minutes" query stay yours.

*Let this be the thing you trust — not the delivery schedule.*

## Licence

MIT.
