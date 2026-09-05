# Phase 9 — `@lazslov/booking`

**Goal:** both consumer tiers of booking-service — the `bpk_` browser tier and the `bsk_` tenant
tier — with the capability tokens typed so a create is the only place they exist, the closed `code`
table as code, and webhook verification with the route handler. The package where the failure mode
is a second appointment in a real diary, and there is no undo that leaves no trace.

**Depends on:** [phase 2](phase-2-api-core.md). Independent of the other phase 9 packages.

**Reference:** [booking-service/conventions.md](../booking-service/conventions.md),
[public-api.md](../booking-service/public-api.md),
[tenant-api.md](../booking-service/tenant-api.md),
[webhooks.md](../booking-service/webhooks.md) and
[workflows.md](../booking-service/workflows.md). The `code` table in conventions §4, the retry
table in workflows §3 and the receiver checklist in webhooks §6 are the acceptance criteria for
this phase, restated as code. Knowledge base at `18846e1`.

**Out of scope:** the admin tier (`bad_`), key management (`/v1/keys*`), `/v1/providers/*` (the
Google OAuth callback), `/api/cron/*`, and `/healthz`.

---

## 0. The scope decision

booking-service publishes three tiers and 118 endpoints. A consumer SDK is for "a website being
built for a client", so the package ships the two tiers that website touches and nothing else:

- **`bpk_`** — the twelve `/v1/public/*` endpoints. This is the only tier in the estate that a
  browser may hold, so it gets a browser constructor rather than a warning.
- **`bsk_`** — fifty-five of the fifty-nine `/v1/*` endpoints. The four that are absent are
  `/v1/keys*`: minting, rotating and revoking a credential is an operator's ceremony, not a call a
  backend makes on its own, and a client that could rotate its own key could also lock itself out.

The admin tier is a back office's and stays out. `/v1/providers/google/oauth` is reached by Google
and never by a caller of ours.

### The boundary this package exists to make visible

> **RULE — this service sends nothing. No email, no SMS, no push, ever.**

Every artefact repeats it, because it is the most expensive thing to discover late: the package
entry's TSDoc, `client.ts` on both tiers, `public/bookings.ts`, `tenant/identity.ts`,
`tenant/webhooks.ts`, `webhook.ts`, `next/index.ts` and the README's second heading. A test asserts
the sentence is on the package entry, so a refactor cannot quietly drop it.

The consequence is a design instruction, not a caveat. A tenant with a `bpk_` key and no backend
gets no confirmation, no reminder and no cancellation notice — so with `require_confirmation: true`
the booking expires and cancels itself. That tenant should run `require_confirmation: false`, and
the README says so.

---

## 1. The clients

```ts
createBookingPublicClient(config?)      // bpk_ → /v1/public/*
tryCreateBookingPublicClient(config?)

createBookingClient(config?)            // bsk_ → /v1/*
tryCreateBookingClient(config?)
```

Two constructors, not one client with a tier parameter. The two keys have different blast radii and
different browser rules, and a single object holding a `bsk_` that *can* read the catalogue is a
`bsk_` that ends up in a client component. Separate constructors mean the import graph shows which
tier a module touches.

Env: `BOOKING_SERVICE_BASE_URL`, `BOOKING_SERVICE_PUBLISHABLE_KEY`, `BOOKING_SERVICE_SECRET_KEY`
and `BOOKING_SERVICE_WEBHOOK_SECRET`. **All four are the SDK's proposal.** booking-service's
knowledge base names the key prefixes and the base URL, not what a deployment calls them; the names
follow the `<SERVICE>_SERVICE_<THING>` shape the other packages use, and `docs/plans/README.md`
records them as *proposed*.

**The browser rule is applied per key, not per constructor.** `assertServerOnly` runs on both
constructors with `serverOnlyPrefixes: ["bsk_"]`, so the public constructor is safe in a browser
with a `bpk_` — which is the whole point of the tier — and still throws for a leaked `bsk_`, naming
rotation. The public constructor does **not** fall back to the secret key: the knowledge base
documents no `bsk_` access to `/v1/public/*`, and a server holding a `bsk_` has the whole tenant
tier instead.

The service's own tripwire refuses `Origin` or `Sec-Fetch-Dest` on `/v1/*` with a `403` **before
authentication**, and presumes the key burned. The SDK's guard fires earlier, at construction,
because by the time that `403` arrives the key has shipped to every visitor.

`mode` is never set, on either tier. The tripwire keys on `Sec-Fetch-Dest`, which undici does not
send, and conventions §2 says to *delete* an inherited `mode: 'same-origin'`, not to carry it.

---

## 2. Endpoints

### The public tier — twelve

| Method | Path | Notes |
|---|---|---|
| `listLocations()` | `GET /v1/public/locations` | Not paginated: the contract declares no `limit` and no `cursor` |
| `listServices(locationId)` | `GET /v1/public/locations/{id}/services` | Not paginated |
| `listEmployees(serviceId)` | `GET /v1/public/services/{id}/employees` | Not paginated. Name and id only |
| `getAvailability(query)` | `GET /v1/public/availability` | Local dates in, UTC instants out |
| `getAvailabilityDays(query)` | `GET /v1/public/availability/days` | One computation summarised, not thirty-one |
| `createHold(body)` | `POST /v1/public/holds` | Keep the `nonce` |
| `releaseHold(id, nonce)` | `DELETE /v1/public/holds/{id}` | `nonce` as a query parameter. `204` |
| `createBooking(body, key)` | `POST /v1/public/bookings` | `IdempotencyKey` required. The `201` is the only place the tokens appear |
| `getBooking(id, token)` | `GET /v1/public/bookings/{id}` | `X-Booking-Token`. Answers the public view **plus `windows`** |
| `confirmBooking(id, token)` | `POST …/confirm` | The token travels in the **body** |
| `rescheduleBooking(id, token, body, key)` | `POST …/reschedule` | `IdempotencyKey` required — a reschedule creates |
| `cancelBooking(id, token, body?)` | `POST …/cancel` | Records `cancellation_reason: "customer"` |

### The tenant tier — fifty-five

| Group | Methods | Notes |
|---|---|---|
| Identity | `getMe`, `getSettings` | `getMe` touches nothing; settings are read-only here |
| Catalogue | 18, over locations, services, employees and their two assignments | Keyset-paged lists; assignments are `PUT`/`DELETE` with no body, `204` either way |
| Calendar | `authorizeCalendar`, `getCalendarConnection`, `disconnectCalendar` | The one `null`-on-404 in the package |
| Working hours | `listRules`, `createRule`, `updateRule`, `deleteRule`, `listExceptions`, `createException`, `deleteException` | Both lists take `employee_id` and nothing else, so neither is paginated |
| Holds | `createHold`, `releaseHold` | The same binding as the public tier, under `/v1/holds` |
| Bookings | 10, from `listBookings` to the two token re-mints | `createBooking` and `rescheduleBooking` take an `IdempotencyKey` |
| Webhooks | 13, from `listEventTypes` to `redeliverWebhook` | This tenant's own endpoints, events and deliveries |

A table-driven test drives every one of the fifty-five through the real transport and asserts the
method and path, so a route that drifts fails by name; a second test asserts the table covers
`keyof BookingClient`, so a method added without a row fails too.

Notes that shape the signatures:

- **Holds are one binding parameterised on the prefix.** `/v1/public/holds` and `/v1/holds` take
  the same bodies and the same `nonce` rule, so both clients share `bindHoldMethods`.
- **The create body is sent as given.** The idempotency hash covers the body, so a helpful tidy-up
  would turn a replay into a `409 idempotency_mismatch`. Asserted: no defaults added, array order
  intact.
- **`releaseHold` puts the `nonce` in the query string** because the contract does, and `DELETE`
  carries no body here.
- **Two list readers, not one.** `callCursorList` answers core's `CursorPage` for the seven keyset
  lists; `callUnpaginated` returns the rows alone for the lists whose contract declares no `limit`
  and no `cursor`. Keeping them separate makes every place that discards `next_cursor` greppable,
  and a list that grows a pagination parameter becomes a compile error rather than a short answer.
- **`BookingStatus` and `CancellationReason` are widened** with `string & {}`, per conventions §6's
  unknown-enum RULE. `BookingCommon` is therefore
  `Omit<generated, "status" | "cancellation_reason"> & { … }` rather than a bare alias, and a
  type-level test asserts a generated `Booking` still fits the SDK's.

### `getBooking` returns `null` on 404? No — except once.

Every read is scoped to the key's tenant inside the query, so another tenant's id is
indistinguishable from one that does not exist. A booking id you hold came from a booking you
created, so "not found" is a bug — often a deployment holding the wrong
`BOOKING_SERVICE_SECRET_KEY`. Mapping that to `null` would turn a misconfiguration into an empty
screen.

The exception is `getCalendarConnection`, because tenant-api.md documents the status as a normal
state: *"404 if there is none, which is normal"*. `callOrNull` exists for that one method, and a
source test asserts it is used exactly once.

---

## 3. The capability tokens

> **RULE — the create response is the only place either token appears.** Stored as SHA-256; a
> re-mint replaces rather than adds. ([conventions §2](../booking-service/conventions.md))

Encoded rather than documented. `BookingTokens` is intersected into `CreatedBooking` and
`CreatedPublicBooking` only, so `booking.management_token` off a `getBooking`, off a
`PublicBookingWithWindows` or off a list row is a **compile error** — three cases, each with a
type-level test.

`CreateResult<T>` is discriminated on `replayed`, because the two arms differ in what they can
promise:

| `replayed` | Wire | Tokens |
|---|---|---|
| `false` | `201` | both, guaranteed by the type |
| `true` | `200`, or `Idempotent-Replay: true` | `Partial<BookingTokens>` |

The replay arm is optional because of one documented case: a replay of a *recovered* create carries
no tokens, since the attempt that minted them died before answering. That is the only case where a
`200` replay's body is thinner than the `201` would have been, and the type is what makes a caller
look before sending a link.

`isReplay` reads **both** signals — the status and the `Idempotent-Replay` header — so a proxy that
rewrites one cannot make a replay look like a fresh booking.

A token never reaches a path: it travels in `X-Booking-Token` or in a body. A source test asserts
it, and it is why `BookingApiError.requestPath` can be carried without redaction.

---

## 4. Idempotency

Required on both creates and on both reschedules, and accepted nowhere else. Each takes a branded
`IdempotencyKey` with **no overload without one**, and core will not mint one — a source test
asserts this package mints neither a key nor a `nonce`.

A reschedule takes one because a reschedule **creates**: it makes a new booking and cancels the old
one atomically, and the answer carries a new `public_id`.

Facts the README states because each changes what a caller writes: derive the key from the intent
rather than the clock; resend the **same** key after a timeout, which is the recovery mechanism
rather than a risk; a `500` releases the reservation, so the same key is reusable; and a replay is
byte-identical since the service's 2026-08-16, so a caller that hashes responses may compare them.

---

## 5. Errors: branch on `code`

Every failure is `application/problem+json` under `urn:booking-service:problem:<slug>`, over the
estate's closed slug set — core's reader. `BookingProblemCode` aliases the generated
`Problem.code` union (seventeen values), with a runtime `Set` and a test that the two agree.

> **RULE — branch on `code`, never on `detail`.** A test asserts no module reads `detail` or
> `title` to decide anything.

`retryable` overrides core in two places, both narrowing, and both read off conventions §4's own
table:

| Status | Core says | This package says | Why |
|---|---|---|---|
| `409` | not retryable | **`idempotency_in_flight` only** — retryable after a pause, same key | The lease clears when the original finishes. `slot_taken` needs a different slot; `idempotency_mismatch` and `hold_not_yours` are caller bugs |
| `422` | retryable later | **not retryable** | Every `422` code names a rule, a window or a tenant setting. `already_confirmed` is a success, not a retry |

`429`, `500` and `502` keep core's verdict. A `409` with **no** `code` is not retryable either: a
proxy's `409` is not a lease.

`advice` is attached in the two places where the naive reading of a status costs an appointment:
`idempotency_in_flight` (*reuse the same key — a new one is a second booking*) and
`already_confirmed` (*treat this as success*).

`providerError` is read from the `provider_error` extension and appears only on a `502` — Google's
own wording from the freebusy pre-check, for an operator reading a log. Never parsed, never matched
on, never shown to a customer; and the pre-check runs before anything is written, so that `502` is
safely retryable with the same key.

`invalid_confirmation_token` is the one `code` that rides a `403`, and the parser carries it —
recognising a code only on its documented status would have dropped it.

---

## 6. Webhooks

`verifyBookingWebhook` binds core's `verifySignedBody` to `X-Signature` /
`X-Signature-Timestamp` with a 300-second tolerance; the whole `whsec_` string is the key.
Fixtures are generated by `test/fixtures/webhook/generate.mjs` with `node:crypto`: two valid
booking events (one with the opt-in `customer` block), a non-ASCII body, and every failure reason
including a secret with its prefix stripped.

The event model follows [webhooks.md §2](../booking-service/webhooks.md) exactly: eleven envelope
members, `data` holding four blocks of **ids** plus the optional `customer` block.
`BookingEventType` is the seven booking events; `BookingWebhookEventType` adds `webhook.ping`; the
union keeps a `string & {}` arm because *"ignore an unrecognised `event_type` and still answer
`2xx`"* is checklist item 5. `isKnownEvent` is the single guard — it answers `true` for the seven
whose blocks the parser has already checked, and `false` for a ping and for a type added upstream.

`parseBookingWebhookEvent` requires only the envelope members the contract marks always-present,
and answers `null` for a **known** event missing a block its arm promises — otherwise a handler
reading `data.booking.status` on a `booking.confirmed` would get `undefined` with no type error.

The route handler on `./next`: required `alreadyProcessed`/`markProcessed`, verify before parse,
`200` for a duplicate and for an unknown type, `500` without `markProcessed` when `onEvent` throws,
and the secret read per request so an unset variable is a `500` on delivery rather than a throw at
import. It dedupes on `X-Event-Id` and falls back to the payload's own `event_id` when a proxy
dropped the header — the same value, because the payload is frozen at emission.

### Branch on the status, not on the event name

A booking created already `confirmed` fires `booking.created` **only**, carrying
`status: "confirmed"`. A receiver subscribed only to `booking.confirmed` therefore never hears from
a tenant running without a confirmation gate, which is a supported configuration. The rule is on
`BookingEventType`'s TSDoc, in the handler's `onEvent` TSDoc and in the README.

### The once-a-day cron

> **CRITICAL — attempts 2 onward ride the cron, and this deployment gets one cron per day.**

The first attempt is inline and prompt; every later rung waits for a drain a quiet service may not
run until tomorrow, and the same ceiling delays a reminder offset and a pending expiry. So the
README, `listWebhookDeliveries` and `verifyBookingWebhook` all say the same thing: a retry interval
is a floor, an event is a notification rather than a fact, `getBooking` is the authority, and a
receiver **keeps a reconciliation poll** over `listBookings({ from, until })`.

---

## 7. Divergences from the knowledge base's own wording

Recorded so a later sync knows what was a choice and what was a finding.

1. **`hold_expired` and `already_confirmed` are `422` on the wire, and the published
   `openapi.yaml` says `409`.** conventions §4 states the spec is the bug, measured at
   `lib/bookings/holds.ts:183` and `lib/bookings/transition.ts:436`. The generated types carry the
   spec's shape; the SDK's `isRetryable` and its tests follow the **Markdown**, which is why every
   `422` is non-retryable and why `already_confirmed` carries success advice. Nothing in the
   package branches on the status of those two codes, so the disagreement changes no behaviour —
   but a consumer generating a client from that spec and branching on `409` would never match.
2. **`examples.http` §2.59 sends `{ "reason": … }` to `POST /v1/webhook-endpoints/{id}/disable`,
   and the route reads no body.** `openapi.yaml` says *"Takes no body … anything sent here is read
   by nobody"*, and `disabled_reason` is a fixed string the service writes itself. The SDK sends no
   body, a test asserts it, and the doc example is classified out of scope by route.
   **Finding for the knowledge base:** the example implies a caller-supplied reason that does not
   exist.
3. **booking-service's field error is `{ pointer, detail }`; core's `ProblemFieldError` requires
   `code`.** conventions §4 shows `{ "pointer": "/customer/email", "detail": "Invalid email" }`,
   and the generated `ProblemFieldError` has exactly those two members with both required. The
   shared type in `@lazslov/api-core` declares `pointer` and `code` required and `detail` optional.
   The runtime filter only requires `pointer`, so booking's field errors survive parsing intact and
   `BookingApiError.errors` is correct at run time — but the declared type promises a `code` this
   service never sends. **Not fixed here:** `api-core` is shared by seven packages and outside this
   phase's scope. The doc example is classified out of scope with this reason attached.
   **Open question:** whether `code` is optional across the estate, or absent only here.
4. **The envelope is payment-service's shape, not email-service's.** booking's webhooks.md §2 shows
   `contract_version`, `tenant` and `causation_id`; email-service's shows `schema_version` and
   neither of the other two. Both folders call it "the estate's envelope, identical across
   services". The type follows this service's Markdown, and the parser tolerates extra members by
   ignoring them. **Open question for the knowledge base:** which spelling is the estate's.
5. **Five small response types are hand-written — a choice, not a finding.** `TenantIdentity`,
   `CalendarAuthorization`, `WebhookTestResult`, `MintedConfirmationToken` and
   `MintedManagementToken` are declared inline on their operation in the contract rather than as
   named `components["schemas"]` entries, so there is nothing to alias. Each hand-written interface
   restates the contract's inline shape exactly, `event_public_id` included as optional because the
   contract marks it so.
6. **`/healthz` is not exposed**, and neither is `GET /v1/admin/health`. operations.md §4 lists
   both under observability rather than under a consumer surface, and `/healthz` can no longer
   report `degraded` at all. Nothing a consumer writes reads either.
7. **Money is a bare alias, not a branded type.** email-service's `minorAmount()` guards a value a
   caller *constructs*; here `price_minor` is only ever **read** — the SDK writes it only when a
   caller passes a service body through. So `MinorAmount` aliases the contract's `string | null`,
   and the control that matters is the absence of arithmetic: a test asserts no exported helper
   name looks like money maths and that no source line contains `/ 100` or `* 100`.
8. **Two doc examples are abbreviations, not response shapes.** `README.md:97` and
   `conventions.md:146` show a booking cut down to the members their sentence is about. Both are
   classified out of scope by name rather than key-checked; key-checking either would report every
   omitted member as a divergence.
9. **One doc example is wrong on purpose** — `examples.http:382` carries `buffer_after_minute` to
   prove the service refuses an unknown field rather than ignoring it. Classified out of scope.
10. **The live suite's `400` case assumes the window is validated before the service is looked
    up.** It sends an unparseable `from` with a `service_id` that belongs to nobody, and expects a
    `400` rather than a `404`. public-api.md lists both statuses for that route without ordering
    them. If the lookup runs first, the case fails loudly with a `404` — which is the right way to
    learn it, and is recorded here because it cannot be settled without a live tenant.

---

## Public API surface

```ts
// @lazslov/booking
export { createBookingPublicClient, tryCreateBookingPublicClient }
export { createBookingClient, tryCreateBookingClient }
export { BookingApiError, type BookingProblemCode }
export { bookingTokenHeader }
export { verifyBookingWebhook, parseBookingWebhookEvent, isKnownEvent }
export { signatureHeader, timestampHeader, eventIdHeader, deliveryIdHeader }
export { VERSION }
export type { BookingClient, BookingPublicClient, /* and each tier's method interfaces */ }
export type { Booking, BookingCommon, BookingListRow, PublicBooking, PublicBookingWithWindows }
export type { BookingTokens, CreatedBooking, CreatedPublicBooking, CreateResult, RescheduleResult }
export type { BookingStatus, KnownBookingStatus, CancellationReason, KnownCancellationReason }
export type { Availability, AvailabilityDays, Slot, Hold, BookingWindows, MinorAmount }
export type { BookingWebhookEvent, BookingWebhookEventType, BookingEventData, /* the five blocks */ }

// @lazslov/booking/next
export { createBookingWebhookHandler }
```

Fourteen runtime exports, pinned by a test.

---

## Exit criteria

Restating the `code` table, the retry table and the receiver checklist as tests:

- [x] All twelve public endpoints and all fifty-five tenant endpoints callable, each asserted by method and path. No admin endpoint, no `/v1/keys*`, no `/v1/providers/*`, no cron, no `/healthz`. Grep-asserted.
- [x] `createBookingPublicClient` does **not** throw in a browser with a `bpk_`, and does throw with a `bsk_`, naming rotation. `createBookingClient` throws in a browser. The public constructor does not fall back to the secret key.
- [x] The `try*` constructors answer `null` for a missing configuration and still throw for a leaked key.
- [x] Neither create has an overload lacking an `IdempotencyKey`, and neither does either reschedule; a raw string is a type error.
- [x] A `201` reports `replayed: false` and carries both tokens; a `200` or an `Idempotent-Replay` header reports `true`; a replay of a recovered create with no tokens type-checks and is carried through.
- [x] Reading a capability token off `getBooking`, off the public read with `windows`, or off a list row is a compile error.
- [x] The create body reaches `fetch` with no defaults added and array order intact; no request sets `mode`; no key and no `nonce` is minted.
- [x] Every one of the seventeen `code` values is recognised on its documented status, and an undocumented one is dropped. `invalid_confirmation_token` is carried on its `403`.
- [x] `retryable` is false for every `422`, false for every `409` except `idempotency_in_flight`, false for a `409` with no code, and true for `429`, `500` and `502`.
- [x] `already_confirmed` carries success advice; `idempotency_in_flight` carries same-key advice; nothing else carries advice.
- [x] `provider_error` is attached on a `502` and nowhere else; `retry_after` is read from the member and from the header; field errors are read with their JSON Pointers.
- [x] `getBooking` throws on a `404` on both tiers; `getCalendarConnection` answers `null` on a `404` and throws on every other status; a source test asserts the mapping exists exactly once.
- [x] The keyset lists answer `{ items, nextCursor }` with no `total`, pass the cursor back verbatim, send every documented filter and nothing for an omitted one; `collectAllCursor` walks them with no adapter. The unpaginated lists answer bare rows.
- [x] `disableWebhookEndpoint` sends no body; `redeliverWebhook` reads the reset off the `202`; `createWebhookEndpoint` and `rotateWebhookSecret` are the only responses carrying a `secret`.
- [x] `verifyBookingWebhook` passes every pinned fixture, including a non-ASCII body, a re-serialised body and the stripped-prefix case, and never throws.
- [x] `parseBookingWebhookEvent` keeps an unknown event type and an unknown booking status, accepts a `webhook.ping`, and answers `null` for a known event missing a block.
- [x] The route handler dedupes on `X-Event-Id` and not on `X-Delivery-Id`, falls back to the payload's `event_id`, marks after `onEvent`, answers `500` without marking on a throw, `200` for a duplicate and for an unknown type, `401` naming the edge runtime, and `500` naming the variable when unset. It imports nothing from `next` (node baseline).
- [x] No module reads `detail` or `title`; no source line divides or multiplies by 100; no exported name looks like money arithmetic; no deployment host and no default base URL appears.
- [x] Every documented JSON example is claimed: 69 examples, 50 key-checked across 28 classifiers.
- [ ] Live: `401` unknown `bsk_`, `403` tripwire before auth, `404` stranger's booking id, `400` unparseable availability window. **Not run** — no `BOOKING_SERVICE_*` credentials in this environment. The `400` case additionally assumes query validation precedes the service lookup; see §7.10.
- [ ] The `422` verdicts for `hold_expired` and `already_confirmed` confirmed **on the wire**. The SDK follows the Markdown against the published spec, and only a live tenant settles it. See §7.1.

## Out of scope here

The admin tier, key management, the Google OAuth callback, the cron routes, `/healthz`, bulk
endpoints, CSV import, a second timezone, payments and invoices — none of which the two consumer
tiers offer.
