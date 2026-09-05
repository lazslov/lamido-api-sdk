# @lazslov/booking

Consumer SDK for booking-service — the `bpk_` browser tier, the `bsk_` tenant tier, and the seven
events that are the only way anybody learns a booking happened.

**What ships in it:** the twelve public endpoints, the fifty-five tenant endpoints, the closed
`code` table with the service's own retry verdicts, capability tokens typed so a create is the only
place they exist, webhook verification, and the webhook route handler on `@lazslov/booking/next`.

## This service sends nothing. No email, no SMS, no push, ever.

Read this before you design anything else. The service **emits** `booking.created`,
`booking.confirmed` and `booking.reminder_reached`; telling a human is your side of the line.

A tenant integrating with a `bpk_` key and no backend gets **no confirmation email, no reminder and
no cancellation notice**. That is not a gap to fill in a later phase. It is the boundary. If your
integration needs a customer to be told something, you need a webhook receiver, and
`@lazslov/booking/next` is one.

Two consequences worth writing down now:

- The confirmation link that carries `confirmation_token` is a link **you** send. With
  `require_confirmation: true` and nobody to send it, the booking expires and cancels itself. A
  tenant with no backend should run `require_confirmation: false`, so a booking is born `confirmed`.
- `reminder_offsets_minutes` decides when `booking.reminder_reached` fires, and nothing after
  "fires" is this service. If a customer got no reminder, the question is whether the event was
  delivered.

## Install

```sh
pnpm add @lazslov/booking
```

Zero runtime dependencies except `@lazslov/api-core`, which is the shared transport.

## Configuration comes from your environment

```ini
BOOKING_SERVICE_BASE_URL=https://booking.example.com
BOOKING_SERVICE_PUBLISHABLE_KEY=bpk_YOUR_PUBLISHABLE_KEY
BOOKING_SERVICE_SECRET_KEY=bsk_YOUR_SECRET_KEY
BOOKING_SERVICE_WEBHOOK_SECRET=whsec_YOUR_SIGNING_SECRET
```

All four names are this SDK's proposal: booking-service documents the key prefixes and the base
URL, not what a deployment calls them. There is **no fallback host** — a missing base URL is a
configuration error the SDK reports, never a silent default.

Every field can also be passed to a constructor, which is what lets one process hold clients for two
tenants.

## Two tiers, two constructors

```ts
createBookingPublicClient(config?)   // bpk_ → /v1/public/*   — safe in a browser
tryCreateBookingPublicClient(config?)

createBookingClient(config?)         // bsk_ → /v1/*          — server only
tryCreateBookingClient(config?)
```

Two constructors rather than one client with a tier parameter. The two keys have different blast
radii, and a single object holding a `bsk_` that *can* read the catalogue is a `bsk_` that ends up
in a client component. Separate constructors make the import graph show which tier a module touches.

### Never import the tenant client into a browser bundle

A `bsk_` key can move, cancel and read every booking of its tenant. The service enforces this
itself: any request to `/v1/*` carrying an `Origin` or a `Sec-Fetch-Dest` header is refused with a
`403` **before authentication runs**, and the key is presumed burned. `createBookingClient` throws
earlier still, at construction — by the time that `403` arrives the key has shipped to every
visitor, and the only remedy left is **rotating** it.

`/v1/public/*` is exempt, so `createBookingPublicClient` is a browser constructor by design. It
still refuses a `bsk_`, and it does **not** fall back to the secret key.

A plain Node `fetch` sends neither header, so a backend needs to do nothing special. If you have
inherited code passing `mode: "same-origin"`, delete it: the service's docs say so, and this SDK
sets no `mode` on any request.

`tryCreateBookingPublicClient()` and `tryCreateBookingClient()` return `null` instead of throwing
when nothing is configured, so a site boots with the booking widget disabled rather than crashing. A
leaked key still throws.

## Booking, from a browser

```ts
import { createBookingPublicClient } from "@lazslov/booking";
import { idempotencyKey } from "@lazslov/api-core";

const booking = createBookingPublicClient();

// 1. Grey out the impossible dates with ONE call, not thirty-one.
const month = await booking.getAvailabilityDays({
  service_id: serviceId,
  from: "2026-09-01",
  until: "2026-10-01",
});
renderCalendar(month.days); // a day with slot_count: 0 carries null for both instants

// 2. The slots for the day the customer picked.
const { slots, timezone } = await booking.getAvailability({
  service_id: serviceId,
  from: "2026-09-14",
  until: "2026-09-15",
});

// 3. Hold it while the form is filled in. Keep the nonce.
const nonce = crypto.randomUUID();
const hold = await booking.createHold({
  service_id: serviceId,
  employee_id: slots[0].employee_ids[0],
  starts_at: slots[0].starts_at,
  nonce,
});

// 4. Book it.
const result = await booking.createBooking(
  {
    service_id: serviceId,
    employee_id: slots[0].employee_ids[0],
    starts_at: slots[0].starts_at,
    hold_id: hold.hold_id,
    nonce,
    customer: { email, name },
  },
  idempotencyKey(`booking-${formId}`),
);

if (!result.replayed) await storeTokens(result.booking); // the ONLY place they appear
```

**A slot is not a reservation.** It is what was true when the response was computed. Between reading
it and creating, someone else may take it, and you get `409 slot_taken`. A hold makes losing
unlikely; it does not make the correctness different. Without a hold, the create races the
database's exclusion constraint and loses cleanly with the same `409`.

**Keep the `nonce`.** Redeeming the hold in a create and releasing it early both need the same
value, and that is what proves the hold is yours without anyone needing a session. Generate it per
hold, from a random source. It is not an idempotency key, and this SDK does not mint it.

**Windows are location-local dates; slots come back as UTC instants.**
`from=2026-09-14&until=2026-09-15` is one local day, and a Budapest day's first slot may read
`2026-09-13T22:00:00Z`. Render from `starts_at` and the `timezone` in the answer, never from the
date you asked for. `from` is inclusive and `until` is exclusive on every range in this API.

**`employee_ids` is a list**, because a slot can be offered by several people. A slot with three
free employees is three chances at that time, not one — pick one, or let the customer pick, because
the create names an employee explicitly.

**Public creation is off unless the tenant enabled it.** A `bpk_` write surface is the
slot-exhaustion vector, so it is opt-in per tenant and a `422 public_create_disabled` is an admin
setting rather than a code fix. Read `public_booking_create_enabled` from `getSettings()` on your
backend before you build the button.

### The tokens exist once

The `201` from a create is **the only place** `management_token` and `confirmation_token` ever
appear. No read returns them. A lost token is re-minted from the tenant tier, never recovered.

The type says so: `BookingTokens` is reachable from `createBooking` and nowhere else, so reading
`booking.management_token` off a `getBooking` is a compile error.

`confirmation_token` is `null` when the tenant does not require confirmation — nothing was minted,
because the booking is already `confirmed`.

`CreateResult` is discriminated on `replayed`, and the two arms differ in what they can promise:

| `replayed` | Status | Tokens |
| --- | --- | --- |
| `false` | `201` | both present |
| `true` | `200`, or `Idempotent-Replay: true` | **optional** — a replay of a recovered create carries none |

A recovered create is the case where the first attempt made the booking and died before answering.
The tokens it minted reached nobody and are gone; re-mint with `mintManagementToken`. That is the
one case where a replay's body is thinner than the `201` would have been.

### `Idempotency-Key` is required on every create

There is no overload without one, on either tier, and `@lazslov/api-core` will not generate one.

Derive it **from the intent, not from the clock**: your own order id or form id, never a fresh UUID
per attempt. A customer double-clicking Book is the normal case, and a network timeout gives you no
way to tell "it failed" from "it worked and the answer was lost". Resending the same key is the
recovery mechanism; a new key on a request that actually succeeded is a second appointment nothing
downstream can identify as unintended.

A reschedule takes one too. A reschedule **creates** a booking.

## What a customer does to their own booking

A `bpk_` key says which tenant; a **capability token** says which booking. The management token
travels in the `X-Booking-Token` header — never a query string, where it would reach referrer
headers, browser history and every log in between. The confirmation token travels in the body of
`confirmBooking` and works once.

```ts
const view = await booking.getBooking(publicId, managementToken);

// `null` means the operation is not offered AT ALL — the tenant set that window to 0, or the
// booking is terminal. A past timestamp means it was offered and the window has closed.
if (view.windows.cancel_until === null) showNoSelfServiceCancel();
else if (Date.parse(view.windows.cancel_until) < Date.now()) showWindowClosed();
```

`confirmBooking` answers `422 already_confirmed` for a second confirm, and that is a **success** —
the SDK attaches advice saying so. `422 pending_expired` means the window ran out: ask for the slot
again and rebook.

`rescheduleBooking` answers the **new** booking with a new `public_id`; follow `rescheduled_from_id`
back and `rescheduled_to_id` forward. The old booking becomes `canceled`, atomically, and one event
fires. The same management token keeps working, so nothing new is minted.

A larger `reschedule_window_minutes` closes the window **earlier** — it is measured backwards from
the appointment.

## From your backend

```ts
import "server-only";
import { collectAllCursor, idempotencyKey } from "@lazslov/api-core";
import { createBookingClient } from "@lazslov/booking";

const booking = createBookingClient();

// Park a booking on a payment, then release it when the payment settles.
const { booking: held } = await booking.createBooking(
  { service_id, employee_id, starts_at, customer, pending_reason: "awaiting_payment" },
  idempotencyKey(`order-${order.id}`),
);
await booking.confirmBooking(held.public_id);

// Tomorrow's day sheet, in full.
const tomorrow = await collectAllCursor(({ limit, cursor }) =>
  booking.listBookings({ from, until, limit, cursor }),
);
```

Your key is the authority here: no capability token is needed for any tenant-tier operation, and the
customer's `reschedule_window_minutes` and `cancel_window_minutes` do not bind this tier.

The state machine:

```
(create) ──► pending ──► confirmed ──┬──► completed  (terminal)
                │            │       ├──► no_show    (terminal)
                └────────────┴───────┴──► canceled   (terminal)
```

**Nothing leaves a terminal status.** Every attempt is `422 booking_terminal`, including cancelling
a completed booking. A `confirmed` booking whose `ends_at` is more than two hours past is
auto-completed by a job; the delay leaves a window to mark `no_show` first, which is deliberately
distinct from `canceled` — a policy about repeat no-shows cannot be written against a status that
also means "they told us in advance".

`listBookings` is keyset-paged with **no `total`**, and its rows carry **no `customer` object at
all**. Read one booking for the full record. There is no `updated_since` filter: `from` and `until`
bound `starts_at`, so a reconciliation poll reads the window of bookings you are about to act on,
not the tail of a change log.

### Three assignments make a slot appear

This is the single most common cause of "availability returns nothing":

1. the employee performs the service — `assignService`;
2. the employee works at the location — `assignLocation`;
3. a working-hour rule exists for that **(employee, location)** pair — `createRule`.

**`day_of_week` is `0` = Monday (ISO), through `6` = Sunday.** Getting this wrong shifts an entire
schedule by one day, and every slot will still look plausible. Rules are wall-clock `HH:MM` in the
location's zone, resolved per occurrence, so 09:00 still says 09:00 on the morning the clocks
change. A rule crossing midnight is refused — split it in two.

Deactivating a location, service or employee removes it from **future** availability and leaves
existing bookings standing. A closed shop still owes its customers an answer.

### Money, timezone and unknown enum members

**`HUF` is zero-decimal.** `price_minor: "4500"` with `currency: "HUF"` is 4500 Ft, not 45.00. Read
an amount against the `currency` beside it, and **never divide a minor amount by 100**. `null` is
not zero: it means the tenant does not display a price. This package performs no arithmetic on
amounts and ships no helper that could.

**`Europe/Budapest` is the only timezone this deployment accepts**, enforced at validation. Every
location carries its timezone and every booking and slot repeats it, so nothing has to guess.

**Treat an unknown enum member as unknown, not as an error.** `BookingStatus`,
`CancellationReason` and the webhook `event_type` all accept a member added upstream after this SDK
shipped. A client that throws on one breaks on a Tuesday for no reason. The known literals stay in
autocompletion; `KnownBookingStatus` and `KnownCancellationReason` are there when you want the
closed set.

## Errors: branch on `code`

Every failure is `application/problem+json` under `urn:booking-service:problem:<slug>`, over the
estate's closed slug set. `BookingApiError` carries `status`, `type`, `code`, `retryable`,
`retryAfter`, `requestId`, `errors` and, on a `502`, `providerError`.

```ts
try {
  await booking.createBooking(body, key);
} catch (error) {
  if (!(error instanceof BookingApiError)) throw error;
  if (error.code === "slot_taken") return offerAnotherSlot();
  if (error.retryable) return scheduleRetry(error.retryAfter); // the SAME key
  throw error;
}
```

**Branch on `code`, never on `detail` or `title`.** The `code` set is closed and stable; `detail` is
prose for a human and changes without notice, and `title` describes the **status** — a `422`
carrying the `conflict` type correctly reads "Unprocessable Entity". No module in this package reads
either to decide anything.

| `code` | HTTP | Retryable | What to do |
| --- | --- | --- | --- |
| `slot_taken` | `409` | no | Refresh availability and offer another slot. |
| `hold_not_yours` | `409` | no | Wrong `nonce`. A bug in the caller. |
| `idempotency_mismatch` | `409` | no | Same key, different body. The first booking stands. |
| `idempotency_in_flight` | `409` | **yes**, after a pause | An identical request is running. Retry the **same** key. |
| `endpoint_limit_reached` | `409` | no | This tenant's webhook endpoint cap. |
| `hold_expired` | `422` | no | Re-hold, or create without a hold. |
| `already_confirmed` | `422` | no — it is a **success** | Do not re-mint or re-send. |
| `pending_expired` | `422` | no | Ask for the slot again and rebook. |
| `public_create_disabled` | `422` | no | An admin setting, not a code fix. |
| `outside_reschedule_window` · `outside_cancel_window` | `422` | no | Too late for the customer. The tenant tier is not bound by either. |
| `booking_terminal` | `422` | no | Nothing leaves a terminal status. |
| `employee_unavailable` · `service_inactive` · `lead_time_violated` · `horizon_exceeded` | `422` | no | Each names a rule or a setting. Show the bookable window. |
| `invalid_confirmation_token` | `403` | no | The booking exists; the capability is wrong. Re-mint and re-send. |

`retryable` follows that table, and narrows `@lazslov/api-core`'s estate-wide default in two places:
**every `422` is not retryable**, because each names a rule rather than a passing state; and a `409`
is not retryable **except** `idempotency_in_flight`, which clears when the original request
finishes. `429`, `500` and `502` keep core's verdict — a `500` releases the idempotency reservation,
so the same key is reusable, and the `502` from the Google freebusy pre-check runs before anything
is written.

A few statuses carry no `code` at all and still matter:

- A **duplicate slug is a `400`**, not a `409`, with a JSON Pointer in `errors`. The `409` set is
  closed, and a taken slug is a fact about your input.
- A **`404` is never mapped to `null`** — with one exception below. Every read is scoped to the
  key's tenant inside the query, so another tenant's id is indistinguishable from one that does not
  exist. A booking id you hold came from a booking you created, so "not found" is a bug, and often
  the bug is a deployment holding the wrong `BOOKING_SERVICE_SECRET_KEY`.
- `provider_error` appears **only on a `502`** and carries Google's own wording. It is for an
  operator reading a log. Never parse it, never match on it, never show it to a customer.

### The one `404` that means `null`

```ts
const connection = await booking.getCalendarConnection(employeeId);
if (connection === null) offerTheConnectButton();
else if (connection.status !== "active") warnThatAvailabilityMayBeStale();
```

`getCalendarConnection` is the only method in this package that answers `null` for a `404`, because
the knowledge base documents that status as a normal state: *"404 if there is none, which is
normal"*. `degraded` means the sync is failing and availability may be stale; `revoked` means the
staff member disconnected us and only a fresh authorisation fixes it. Both are availability bugs
your customers see before you do.

`authorizeCalendar` requires a `return_url` — there is no default, and an empty body is a `400`.
Google returns the staff member to exactly that URL with `?calendar=connected|denied|gone`
appended; the callback renders nothing and answers no JSON, so **you** build the landing page that
reads the parameter.

## Webhooks

```ts
export const runtime = "nodejs"; // an edge runtime may transform the body

export async function POST(request: Request) {
  const rawBody = await request.text(); // BEFORE any parsing
  const verdict = await verifyBookingWebhook({
    secret: process.env.BOOKING_SERVICE_WEBHOOK_SECRET!,
    rawBody,
    headers: request.headers,
  });
  if (!verdict.ok) return new Response(verdict.reason, { status: 401 });

  const eventId = request.headers.get("x-event-id")!;
  if (await alreadyProcessed(eventId)) return new Response(null, { status: 200 });

  const event = parseBookingWebhookEvent(rawBody);
  if (!event) return new Response("malformed", { status: 400 });

  if (isKnownEvent(event)) await enqueue(event.data.booking.public_id, event.data.booking.status);
  await markProcessed(eventId);
  return new Response(null, { status: 200 });
}
```

- Verification and parsing are two functions, so a handler cannot parse before it verifies.
- The whole `whsec_…` string is the key — the prefix is key material, not a label to strip.
- **Dedupe on `X-Event-Id`**, which equals the envelope's `event_id` and is stable across every
  retry and every redelivery. `X-Delivery-Id` is a fresh id **per HTTP attempt** and would let every
  retry through as new.
- **Answer `2xx` within 5 seconds** and do the real work asynchronously. Everything else is a
  failed attempt, including a `3xx`; five consecutive failures disable the endpoint, and a disabled
  endpoint has **no backlog** — nothing is queued for it until somebody re-enables it.
- **Ignore an event type you do not recognise and still answer `2xx`.** `isKnownEvent` is the guard;
  a new type is additive and ships inside `contract_version: 1`.
- Events are **at-least-once and unordered**. Treat one as *"something changed, go look"* and
  re-read the booking. If a read and an event disagree, the read is right and the event is old.

Seven booking events — `booking.created`, `.confirmed`, `.rescheduled`, `.canceled`, `.completed`,
`.no_show`, `.reminder_reached` — plus `webhook.ping` from `testWebhookEndpoint`. Build a
subscription UI from `listEventTypes()`, which is the catalogue as data; the SDK's
`BookingWebhookEventType` is for narrowing a parsed delivery, not for offering choices.

**Branch on `data.booking.status`, never on the event name.** A booking created already `confirmed`
fires `booking.created` **only**, carrying `status: "confirmed"` — so a receiver subscribed only to
`booking.confirmed` never hears from a tenant running without a confirmation gate, which is a
supported configuration. A pending booking that expires fires `booking.canceled` with
`cancellation_reason: "system_pending_expired"`; there is no separate expiry event.

`data` carries ids, not a denormalised copy of the world: a `booking` block, and `location`,
`service` and `employee` blocks that are ids to read with. The `customer` block is present **only**
where the endpoint set `include_customer: true`, and it is stripped from `listWebhookEvents` reads
even then.

Nothing fires for a hold, a catalogue change, a working-hours change, a calendar connecting or
degrading, a customer record, a key, or a tenant setting. An integrator who assumes one of those
events exists will design around a fiction.

### Subscribe, and also poll

The retry ladder is bounded by a cron that runs **once a day** on this deployment. The first attempt
is inline and prompt; every later rung waits for a drain that a quiet service may not run until
tomorrow. So **every retry interval is a floor, not a promise**, and the same ceiling delays a
reminder offset and a pending expiry.

An endpoint that was down for six hours has a backlog and drains it. An endpoint auto-disabled after
five consecutive failures has **no backlog at all**. So keep a reconciliation poll:
`listBookings({ from, until })` over the window you are about to act on — tomorrow's day sheet, this
week's diary — compared with what you hold. `getBooking` is the authority when you need the state
now.

`listWebhookDeliveries` is how "why haven't I received the event?" is answerable without a support
ticket: a `pending` row is either an attempt in flight or a failed attempt with rungs left, and
`next_attempt_at` tells them apart. `redeliverWebhook` re-sends the stored payload byte for byte and
answers `202` — **read the reset off that `202`**, never by re-reading the row, because the first
fresh attempt bursts within milliseconds.

## `@lazslov/booking/next` — the route handler, written for you

```ts
// app/api/webhooks/booking/route.ts
export const runtime = "nodejs"; // an edge runtime may transform the body, which breaks the HMAC

import { isKnownEvent } from "@lazslov/booking";
import { createBookingWebhookHandler } from "@lazslov/booking/next";

export const POST = createBookingWebhookHandler({
  alreadyProcessed: (id) => db.webhookEvents.exists(id),
  markProcessed: (id) => db.webhookEvents.insert(id),
  onEvent: async (event) => {
    if (!isKnownEvent(event)) return; // a ping, or a type added after this SDK shipped
    await queue.push({ type: event.event_type, bookingId: event.data.booking.public_id });
  },
});
```

**`alreadyProcessed` and `markProcessed` are required parameters.** Delivery is at-least-once, the
dedupe is not optional, and the SDK owns no storage — so the most it can do is make forgetting them
a compile error. Back them with a unique constraint in your own database, not an in-memory set that
is empty again on the next cold start.

| Answer | When |
| --- | --- |
| `401` | verification failed — the body names the edge runtime, which is the cause far more often than a wrong secret |
| `400` | verified, but the body is not an event |
| `200` `duplicate` | already processed. `onEvent` is **not** called — a duplicate is a success |
| `200` `accepted` | enqueued and marked — including for a `webhook.ping` and for a type this SDK does not know |
| `500` | `onEvent` threw. `markProcessed` is **not** reached, so the sender retries |

`onEvent` runs only after the dedupe passes, and `markProcessed` only after `onEvent` resolves — a
crash in between yields a redelivery, which is the safe direction. `onEvent` is *enqueue, do not
process*: the confirmation email belongs on a queue, not on this request. Outside production the
handler warns once if `onEvent` takes over 3 seconds.

This subpath imports **nothing** from `next`: the handler takes a `Request` and answers a
`Response`, so it runs unchanged in any Web-standard runtime, and this package declares no peer
dependency. An unset `BOOKING_SERVICE_WEBHOOK_SECRET` answers `500` on delivery rather than throwing
at import.

## What is not here

The admin tier (`bad_`), key management (`/v1/keys*`), the Google OAuth callback under
`/v1/providers/*`, the cron routes and `/healthz` — none of them is yours to call. Minting, rotating
and revoking credentials is an operator's ceremony, not a call a backend makes on its own.

Also absent because the service has none: bulk endpoints, CSV import, payments, invoices, a second
timezone, and any way to store more about a customer than name, email and phone.

## Licence

MIT.
