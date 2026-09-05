# @lazslov/email

Consumer SDK for email-service — template-only transactional mail on the `esk_` tenant tier,
and the delivery events it emits.

**What ships in it:** the five tenant endpoints, the `currency` variable's amount type, RFC 9457
error triage by `code`, webhook verification, and the webhook route handler on
`@lazslov/email/next`.

## Install

```sh
pnpm add @lazslov/email
```

Zero runtime dependencies except `@lazslov/api-core`, which is the shared transport.

## Configuration comes from your environment

```ini
EMAIL_SERVICE_BASE_URL=https://email.example.com
EMAIL_SERVICE_API_KEY=esk_YOUR_TENANT_KEY
EMAIL_SERVICE_WEBHOOK_SECRET=whsec_YOUR_SIGNING_SECRET
```

The first two names are the ones the knowledge base documents. The third is this SDK's proposal —
the service names no variable for the receiver's copy of the secret. There is **no fallback
host**: a missing base URL is a configuration error the SDK reports, never a silent default.

## Never import this into a browser bundle

An `esk_` key authorises every send for your tenant. The service enforces this itself: any request
to `/v1/*` carrying an `Origin` or `Sec-Fetch-Dest` header is refused with a `403` **before
authentication runs**. `createEmailClient` throws earlier still, at construction — because by the
time that `403` arrives the key has shipped to every visitor, and a leaked `esk_` yields *the email
that convinces a victim*, DKIM-signed from a domain they already trust. The only remedy is
**rotating** it.

There is deliberately no publishable tier, and so no browser-safe constructor. A plain Node `fetch`
is unaffected: no `mode: "same-origin"` is needed, and the SDK sets none.

`tryCreateEmailClient()` returns `null` instead of throwing when nothing is configured, so an order
flow completes with the confirmation skipped rather than crashing. A leaked key still throws.

## Sending

```ts
import "server-only";
import { derivedIdempotencyKey } from "@lazslov/api-core";
import { createEmailClient, minorAmount } from "@lazslov/email";

const email = createEmailClient();

const { message, replayed } = await email.sendMessage(
  {
    template: { key: "order.confirmation" },
    to: order.customerEmail,
    variables: {
      orderNumber: order.number,
      total: { amount: minorAmount(String(order.totalMinor)), currency: "HUF" },
      items: order.lines.map((line) => `${line.qty} × ${line.name}`),
    },
    metadata: { order_id: order.id },
  },
  derivedIdempotencyKey(`order-${order.id}`, 1),
);

await store(order.id, message.public_id); // the only handle for reads, cancels and support
```

**There is no `body` field and no raw HTML.** Sending is template-only, so a leaked key cannot
compose an arbitrary phishing mail from your domain. Templates are added by an operator, never
through this API. Unknown fields are **rejected, not stripped** — a typo'd `"subjekt"` is a `400`
naming it, not a `202` that sends the template default.

**`202` means queued, not sent.** No provider call happens in the request path. `replayed: true`
means the service answered `200` with the frozen body of an earlier request under the same key —
nothing was created, and that is a success. A replay carries the message's status *now*, which
can be `failed`.

`Idempotency-Key` is required and there is no overload without one. Derive it **from the business
event, not from the clock**: `order-2026-0001`, never a fresh UUID per attempt. There is no unsend,
so a random key per attempt removes all protection. Keys live 7 days, scoped per tenant.

### Which failures consume the key

The service validates **before** it reserves the key, so a `400` or `413` leaves it free: fix the
body and resend with the **same** key. A network timeout is the case where people reach for a new
key, and the old one is what protects them — resend it and you get the `202` you missed, or a
replay of it.

| Status · `code` | Retry the same key? | What to do |
| --- | --- | --- |
| `400` with `errors[]` · `unknown_template` · `template_variable_*` | **yes** | Fix the body. Nothing was created. |
| `409 idempotency_in_flight` | yes, after a pause | A concurrent request holds the key. `advice` says so. |
| `409 idempotency_mismatch` | **no** | Same key, different body. The first message stands. |
| `409 recipient_suppressed` | **no** | This address bounced permanently or complained. A `suppressed` row was created and the key is consumed. **Do not work around it.** |
| `409 stream_closed` | no | Marketing is not open on this service. |
| `422 identity_*` · `credential_*` | no — an operator acts first | Provisioning fault. Nothing was attempted; then retry the same key. |
| `429 rate_limited` | after `retryAfter` | The per-key throttle: 100 per 10 seconds. |
| `429 quota_exceeded` | after `retryAfter` | Your daily or monthly cap. `retryAfter` is the end of the **binding** period — for a monthly cap, measured in days. |

`retryable` follows that table. **Branch on `code`, never on `detail` or `title`** — `title`
summarises the HTTP status, so a `422` reads "Unprocessable Entity" whatever went wrong.

### The amount in a `currency` variable

A `type: currency` template variable is `{ amount, currency }`, and `amount` is a **decimal string
of minor units**. A JSON number is a `400`. HUF has zero minor units, so `"38100"` is 38 100 Ft;
EUR has two, so `"1000"` is €10.00.

```ts
minorAmount("38100"); // ok
minorAmount("0"); // ok — a zero total is a legitimate thing to put in an email
minorAmount("381.00"); // throws — major units
```

`minorAmount` rejects locally what the service rejects, and `CurrencyVariable.amount` is branded so a
bare string does not compile. There is no arithmetic, no conversion and no formatting: the service
renders the amount for the recipient with `BigInt` and no float on the path.

## Reading back

```ts
const detail = await email.getMessage(publicId);
if (detail.status === "sent") await markDispatched(order); // sent is not delivered
```

**`sent` is not `delivered`.** `sent` means the provider accepted the bytes; only `delivered`
means a receiving server accepted it, and only Resend reports that. **For an SMTP tenant `sent`
is terminal** — waiting for `delivered` there waits forever.

`variables` never come back on a read, and `Message` does not declare the member: echoing a magic
link or a one-time code out of a read endpoint would turn a leaked key into a token oracle. Keep
your own copy; `metadata` is echoed.

`getMessage` **throws** on a `404` rather than answering `null`: a message that belongs to another
tenant is a `404`, never a `403`, so an id you hold answering "not found" is a bug — and the error
names the wrong-key possibility.

`listMessages` is keyset-paged with **no `total`**. Follow `nextCursor` until it is `null`, or hand
the method to `collectAllCursor` from `@lazslov/api-core`. Do not poll it in a loop: it spends your
own throttle. `cancelMessage` succeeds only while `queued`; anything else is a `422` carrying the
current status — and a second cancel is a `422`, not a silent `200`.

## Connecting a Gmail mailbox

```ts
const { authorize_url, expires_at } = await email.startGoogleOauth({
  config_id: "primary_mailbox",
  return_url: `${process.env.EMAIL_SERVICE_BASE_URL}/connected`,
});
```

Nothing is redirected. You are a server-side integration; hand `authorize_url` to whoever connects
the mailbox. `return_url` must be under the service's own base URL and is checked here, at the
start. There is no tenant-tier disconnect.

## Webhooks

```ts
export const runtime = "nodejs"; // an edge runtime may transform the body

export async function POST(request: Request) {
  const rawBody = await request.text(); // BEFORE any parsing
  const verdict = await verifyEmailWebhook({
    secret: process.env.EMAIL_SERVICE_WEBHOOK_SECRET!,
    rawBody,
    headers: request.headers,
  });
  if (!verdict.ok) return new Response(verdict.reason, { status: 401 });

  const eventId = request.headers.get("x-event-id")!;
  if (await alreadyProcessed(eventId)) return new Response(null, { status: 200 });

  const event = parseEmailWebhookEvent(rawBody);
  if (!event) return new Response("malformed", { status: 400 });

  if (isMessageEvent(event)) await enqueue(event.data.public_id, event.data.status);
  await markProcessed(eventId);
  return new Response(null, { status: 200 });
}
```

- Verification and parsing are two functions, so a handler cannot parse before it verifies.
- The whole `whsec_…` string is the key — the prefix is key material, not a label to strip.
- **Dedupe on `X-Event-Id`**, which is stable across retries; `X-Delivery-Id` is per attempt.
  Delivery is at-least-once **and unordered**: branch on `data.status`, never on arrival order.
- **Answer `2xx` within 5 seconds** and do the real work asynchronously. Five consecutive
  dead-letters disable your endpoint, and a disabled endpoint has **no backlog** — nothing arrives
  later to say what you missed.
- **Ignore an event type you do not recognise and still answer `2xx`.** `isKnownEvent` and
  `isMessageEvent` are the guards; a new type is additive.
- `data` **is** the message block: `public_id`, `status`, `template`, `metadata`, and `to` only
  when the endpoint opted in. `account_id` can be `null` — an unpaired tenant, not an error.

Nine message events: six transitions (`message.sent`, `.delivered`, `.bounced`, `.complained`,
`.failed`, `.canceled`) and three observations that move no status (`.dropped`, `.opened`,
`.clicked`) — plus `webhook.ping` from an operator's test. `message.delivered` never fires for an
SMTP tenant.

### Keep a reconciliation poll

The retry ladder is bounded by a cron that runs **once a day**. The first attempt is inline and
prompt; every later rung waits for a drain that a quiet service may not run until tomorrow. So a
retry is not a promise about time, and an event is a notification rather than a fact. When you need
the state now — after downtime, before acting on anything expensive — `getMessage` is the
authority, and a periodic `listMessages({ from, until })` is how you find the gap.

## `@lazslov/email/next` — the route handler, written for you

```ts
// app/api/webhooks/email/route.ts
export const runtime = "nodejs"; // an edge runtime may transform the body, which breaks the HMAC

import { isMessageEvent } from "@lazslov/email";
import { createEmailWebhookHandler } from "@lazslov/email/next";

export const POST = createEmailWebhookHandler({
  alreadyProcessed: (id) => db.webhookEvents.exists(id),
  markProcessed: (id) => db.webhookEvents.insert(id),
  onEvent: async (event) => {
    if (!isMessageEvent(event)) return; // a ping, or a type added after this SDK shipped
    await queue.push({ type: event.event_type, messageId: event.data.public_id });
  },
});
```

**`alreadyProcessed` and `markProcessed` are required parameters.** Delivery is at-least-once, the
dedupe is not optional, and the SDK owns no storage — so the most it can do is make forgetting them
a compile error. Back them with a unique constraint in your own database, not an in-memory set.

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
dependency. An unset `EMAIL_SERVICE_WEBHOOK_SECRET` answers `500` on delivery rather than throwing
at import.

## What is not here

The admin tier (`ead_`), the provider callbacks (`/v1/providers/*`), the inbound house-event
receivers (`/v1/hooks/*`), the cron, and `/healthz` — none of them is yours to call. Also absent
because the service has none: a batch endpoint, template management, more than one recipient per
message, marketing sends, and any way to remove a suppression.

## Licence

MIT.
