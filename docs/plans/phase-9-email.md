# Phase 9 — `@lazslov/email`

**Goal:** the `esk_` tenant tier — five endpoints, the `currency` variable's amount type, RFC 9457
error triage by `code`, and webhook verification with the route handler. The package where the
failure mode is a duplicate email to a real person, and there is no unsend.

**Depends on:** [phase 2](phase-2-api-core.md). Independent of the other phase 9 packages.

**Reference:** [email-service/tenant-api.md](../email-service/tenant-api.md),
[conventions.md](../email-service/conventions.md), [webhooks.md](../email-service/webhooks.md)
and [workflows.md](../email-service/workflows.md). The retry decision table in workflows.md and
the receiver checklist in webhooks.md §5 are the acceptance criteria for this phase, restated as
code. Knowledge base at `23051b9`.

**Out of scope:** the admin tier (`ead_`), `/v1/providers/*` (inbound provider callbacks),
`/v1/hooks/*` (inbound house events), `/api/cron/*`, and `/healthz`.

---

## 0. The scope decision

The maintainer's earlier note doubted whether email belongs in a consumer SDK at all: the
seven services' consumer is "a website being built for a client", and a website does not send
mail from the browser.

**Decision:** any backend that sends transactional mail is a consumer of the tenant tier. An
order confirmation, a magic link, an invoice notification — each is sent by the application
backend of a client site, with that site's own `esk_` key, and each needs the same five things
the other packages provide: a typed client, the error table as code, the idempotency rule
enforced by a signature, a webhook verifier and a route handler. So the package ships **the
tenant tier and nothing else**. The admin tier is a back office's, and stays out.

---

## 1. The client

```ts
createEmailClient(config?)      // esk_ → /v1/*
tryCreateEmailClient(config?)
```

Env: `EMAIL_SERVICE_BASE_URL` ([conventions §1](../email-service/conventions.md#1-surfaces))
and `EMAIL_SERVICE_API_KEY` (the Node snippet in
[workflows.md](../email-service/workflows.md#integrating-from-a-node--nextjs-backend)) — both
documented. `EMAIL_SERVICE_WEBHOOK_SECRET` is the SDK's proposal; the service names no variable
for a receiver's copy of the secret.

**One constructor, server-only.** conventions §2 states there is *deliberately no publishable
tier*: a browser-safe email key is an open relay with the key printed in the page source. So no
second constructor, and `assertServerOnly` on `esk_` at construction. The service's own tripwire
refuses `Origin` or `Sec-Fetch-Dest` with a `403` before authentication; the SDK's guard fires
earlier, naming rotation.

`mode` is never set. The tripwire keys on `Sec-Fetch-Dest`, which undici does not send; the
knowledge base says to delete the `mode: "same-origin"` workaround, not to carry it.

### `startGoogleOauth` — the fifth endpoint, and why it is here

tenant-api §5 was the open question: does a Gmail connection flow belong in an application
backend's SDK? The Markdown decides it. The route is on the tenant tier *"because a tenant may
connect their own mailbox without an operator"*, and its RULE addresses the caller directly:
*"You are a server-side integration, not a browser. This answers a URL."* That is this package's
caller, so the method ships. What does not: the callback (Google's contract, no key of ours) and
the disconnect (admin-tier).

---

## 2. Endpoints

| Method | Path | Notes |
|---|---|---|
| `sendMessage(body, key)` | `POST /v1/messages` | `IdempotencyKey` required. **`202`, never `201`** — queued, not sent. `replayed` from the `200` and the `Idempotent-Replay` header |
| `getMessage(publicId)` | `GET /v1/messages/{public_id}` | With `events`, ordered by the provider's clock. Throws on `404` |
| `listMessages(options)` | `GET /v1/messages` | Keyset; `{ items, nextCursor }`, no `total`. `limit` 1–200, default 50 |
| `cancelMessage(publicId)` | `POST /v1/messages/{public_id}/cancel` | Only while `queued`; a `422` otherwise, including for an already-cancelled message |
| `startGoogleOauth(body)` | `POST /v1/oauth/google/start` | Answers a URL; nothing is redirected |

Notes that shape the signatures:

- **No `body`, `html` or `text` field exists on `SendMessageInput`**, and a test greps `types.ts`
  to keep it that way. Template-only sending is the control that makes a leaked key unable to
  compose arbitrary mail.
- **`to` is one string.** No `cc`, no `bcc`, no arrays — one message, one recipient, one status.
- **`stream` is typed `"transactional"` only.** The wire accepts `"marketing"` and refuses it with
  `409 stream_closed`; offering it in the type would offer a guaranteed failure.
- **The body is sent as given.** The service rejects unknown fields rather than stripping them,
  hashes the body with sorted object keys and keeps array order significant — so the SDK
  defaults nothing, reorders nothing and tidies nothing. Asserted.
- **`variables` is `Record<string, unknown>`** on the input and **absent** from `Message`. The
  read type does not declare the member, so reading a magic link back is a compile error.
- **`MessageStatus` is widened** with `string & {}`, per conventions §11's RULE that a new enum
  value is not a breaking change. `Message.status` and `MessageEvent.type` are overridden on the
  generated aliases to carry it. `isCancellable` is the one status predicate: `queued` alone.

### `getMessage` returns `null` on 404? No.

> **A message that belongs to another tenant is a `404`, never a `403`**, so an id cannot be
> probed for existence.

A `404` is therefore never mapped to `null`. A `public_id` you hold came from a `202` you
received, so "not found" is a bug — and the error names the wrong-key possibility, with
`EMAIL_SERVICE_API_KEY` spelled out.

---

## 3. The amount type

> **RULE — a `currency` template variable's `amount` is a decimal string of MINOR units, and a
> JSON number is a `400`.** ([conventions §6](../email-service/conventions.md#6-types-and-formats))

The rule changed at the service's `7cbff0e` and is the headline breaking change for a client
written earlier. The SDK encodes it as `CurrencyVariable { amount: MinorAmount; currency }`, with
`MinorAmount` branded and reachable only through `minorAmount(value)`. The validator mirrors the
service's own format — digits, no sign, point, exponent or leading zero — with one difference
from payment's: **`"0"` is accepted**, because a zero total is a legitimate thing to put in an
email and the service says `"0"` is the one value that may begin with a zero.

Deliberately **not** a money library: no `huf()`/`eurCents()`, no arithmetic, no formatting. The
service formats the amount for the recipient itself, with `BigInt` and no float on the path.

---

## 4. Errors: branch on `code`

Every failure is `application/problem+json` under `urn:email-service:problem:<slug>`, over the
estate's closed slug set — core's reader. `EmailProblemCode` aliases the generated `Problem.code`
union (eighteen values), with a runtime `Set` and a test that the two agree.

> **RULE — branch on `code`, never on `detail` or `title`.** A test asserts no module reads either.

`retryable` overrides core in two places, both from the service's own retry table:

| Status | Core says | This package says | Why |
|---|---|---|---|
| `409` | not retryable | **`idempotency_in_flight` only** — retryable after a pause, same key | The 60-second lease. Every other `409` never clears |
| `422` | retryable later | **not retryable** | workflows.md's anti-pattern table: *retry a 422 unchanged — a retry cannot fix it.* The state changes only when an operator acts (a send) or never (a cancel) |

`advice` — prose attached where the naive reading of a status sends a second email or hides a
misconfiguration: the in-flight lease (*reuse the same key*), a mismatch (*the first message
stands*), a suppression (*the key is consumed; do not route around it*), `quota_exceeded` against
`rate_limited` (*only `code` tells the two 429s apart*), a `422` on a send (*operator, then same
key*) against a `422` on a cancel (*no longer queued*), and every `404` (*wrong tenant's key?*).

Which failures **consume the idempotency key** follows the guard order in tenant-api §1 and is
documented on `sendMessage` and in the README rather than carried as a field: validation runs
before the key is reserved, so a `400`/`413` leaves it free; `409 recipient_suppressed` is the one
refusal that consumes it, because it creates a `suppressed` row.

---

## 5. Idempotency

Required on `sendMessage` and accepted nowhere else on the tier; the method takes a branded
`IdempotencyKey` with no overload without one, and core will not generate one. The result
surfaces replay from the status **and** the `Idempotent-Replay` header — `202` queued, `200`
replayed — via `callWithMeta` + `isReplay`.

Facts the README states because each changes what a caller writes: 7-day TTL, scoped per
tenant; the body hashed with sorted keys, arrays significant; a `400` releases the key; a frozen
`409` replays as that `409`; and **a timeout is resent under the same key** — the recovery
mechanism, not a risk.

---

## 6. Webhooks

`verifyEmailWebhook` binds core's `verifySignedBody` to `X-Signature` / `X-Signature-Timestamp`
with a 300-second tolerance; the whole `whsec_` string is the key. Fixtures generated by
`test/fixtures/webhook/generate.mjs` with `node:crypto`: three valid message events (one with
the opt-in `to`), a `webhook.ping`, a non-ASCII body, and every failure reason.

The event model follows [webhooks.md §2](../email-service/webhooks.md#2-the-envelope) exactly:

- Envelope: `schema_version`, `event_id`, `event_type`, `occurred_at`, `service`, `account_id`
  (nullable — *an unpaired tenant, not an error*), `correlation_id`, `hop`, `data`.
- **`data` is the message block itself** — `public_id`, `status`, `template`, `metadata`, and
  `to` only when the endpoint opted in — not a `data.message` layer as on payment-service.
- `EmailWebhookEventType` is the nine `message.*` types plus `webhook.ping`; the union keeps a
  `string & {}` arm because *"ignore an unrecognised `event_type` and still answer `2xx`"* is
  checklist item 5. `isKnownEvent` (ten) and `isMessageEvent` (nine, with the block guaranteed)
  are the guards.

The route handler on `./next` is payment's, renamed: required `alreadyProcessed`/`markProcessed`,
verify before parse, `200` for a duplicate and for an unknown type, `500` without
`markProcessed` when `onEvent` throws, secret read per request.

### The once-a-day cron

> **GOTCHA — the retry ladder is bounded by a cron that runs once a day.**

The first attempt is inline and prompt; every later rung waits for a drain that a quiet service
may not run until tomorrow, and an auto-disabled endpoint has no backlog at all. So the README,
`getMessage` and the handler's `onEvent` all say the same thing: an event is a notification,
`getMessage` is the authority, and a receiver **keeps a reconciliation poll**.

---

## 7. Divergences from the knowledge base's own wording

Recorded so a later sync knows what was a choice and what was a finding.

1. **The webhook envelope differs from payment-service's.** webhooks.md §2 shows
   `schema_version` and no `tenant` or `causation_id`; payment shows `contract_version`, `tenant`
   and `causation_id`, and the openapi's *inbound* `HouseEventEnvelope` carries `causation_id`.
   Both folders call it "the estate's envelope, identical across services". The type follows this
   service's Markdown; the parser tolerates the extra members by ignoring them. **Open question
   for the knowledge base:** which spelling is the estate's.
2. **`events` on the read.** The contract marks `events` optional; tenant-api §3 shows it on the
   read and calls it "the resource, plus its timeline". `MessageDetail` follows the contract.
3. **`Message.status` and `MessageEvent.type`** are widened beyond the generated closed union, on
   the authority of conventions §11's unknown-enum RULE. The `Message` alias is therefore
   `Omit<…, "status"> & { status: MessageStatus }` rather than a bare alias, and a type-level test
   asserts its key set still equals the generated response's.
4. **`SendMessageInput` is hand-written.** The generated `SendMessage` marks `stream`,
   `variables` and `attachments` required and types `variables` as `Record<string, never>`. A
   `satisfies` chain in `test/type-safety.test.ts` proves a fully spelled-out input still fits the
   generated type.
5. **`/healthz` is not exposed.** conventions §1 lists it under *monitoring*, not the tenant
   tier, and the two Markdown files disagree on its body — workflows.md says `{"status":"ok"}`,
   the contract adds `version`, `commit` and `now`. Nothing in a consumer's surface reads it.
6. **`title` is rendered from the status** in the stubbed problem responses, as the service does;
   `problemResponse(422, "conflict")` reads "Unprocessable Entity" — the reason nothing branches on
   it.
7. **One doc example is wrong on purpose** — `examples.http:254` carries `"subjekt"` to prove
   unknown fields are a `400`. Classified out of scope by name rather than key-checked.
8. **The live suite's OAuth case sends a `return_url` the service must refuse.** A `400` mints no
   state. Were the service to accept it, `failure()` fails the case — and the residue is a
   ten-minute, single-use `state` row nobody can consume.

---

## Public API surface

```ts
// @lazslov/email
export { createEmailClient, tryCreateEmailClient }
export { EmailApiError, type EmailProblemCode }
export { minorAmount, type MinorAmount }
export { isCancellable, type MessageStatus, type KnownMessageStatus }
export { verifyEmailWebhook, parseEmailWebhookEvent, isKnownEvent, isMessageEvent }
export { signatureHeader, timestampHeader, eventIdHeader, deliveryIdHeader }
export type { EmailWebhookEvent, EmailWebhookEventType, EmailMessageEventType, EmailEventEnvelope, WebhookMessageBlock }
export type { Message, MessageDetail, MessageEvent, MessageList, SendMessageInput, SendMessageResult, CurrencyVariable, TemplateRef, Attachment, OauthStartInput, StartedOauthFlow }

// @lazslov/email/next
export { createEmailWebhookHandler }
```

---

## Exit criteria

Restating the retry table and the receiver checklist as tests:

- [x] All five tenant endpoints callable. No admin endpoint, no `/v1/providers/*`, no `/v1/hooks/*`, no cron, no `/healthz`. Grep-asserted.
- [x] `sendMessage` has no overload lacking an `IdempotencyKey`; a raw string is a type error.
- [x] A `202` reports `replayed: false` with `status: "queued"`; a `200` or an `Idempotent-Replay` header reports `true`; a replay's `failed` status is carried through.
- [x] `SendMessageInput` rejects `html`/`body`, an array `to`, and `stream: "marketing"` at compile time; a fully populated input satisfies the generated `SendMessage`.
- [x] The body reaches `fetch` with no defaults added and array order intact.
- [x] `minorAmount("381.00")`, `("1e3")`, `(" 1")`, `("01")`, `("-1")`, `("")` throw; `("0")` is accepted; a `number` throws naming the `400`. `CurrencyVariable.amount` rejects a bare string and a number at compile time.
- [x] `Message` declares no `variables`; reading it is a compile error. Its key set equals the generated response's.
- [x] Every one of the eighteen `code` values is recognised; an unknown one is dropped.
- [x] `409 idempotency_in_flight` is retryable with the same-key advice; `recipient_suppressed`, `stream_closed`, `idempotency_mismatch` are not. `422` is not retryable, with the operator advice on a send and the not-queued advice on a cancel.
- [x] `quota_exceeded` and `rate_limited` are told apart by advice; `retryAfter` is read from the member and the header.
- [x] `getMessage` throws on a `404` and names the wrong-tenant possibility and `EMAIL_SERVICE_API_KEY`.
- [x] `listMessages` passes every filter under its wire name, returns `{ items, nextCursor }` with no `total`, and `collectAllCursor` walks it with the cursor verbatim.
- [x] `cancelMessage` sends no body and no `Content-Type`.
- [x] `verifyEmailWebhook` passes every pinned fixture, including a non-ASCII body and the stripped-prefix case.
- [x] `parseEmailWebhookEvent` keeps an unknown type, reads `data` as the block, leaves `to` absent unless present, reads `account_id: null`, and answers `null` for a message event with no block.
- [x] The route handler: dedupes on `X-Event-Id` not `X-Delivery-Id`, marks after `onEvent`, answers `500` without marking on a throw, `200` for a duplicate and for an unknown type, `401` naming the edge runtime, `500` naming the variable when unset. It imports nothing from `next` (node baseline).
- [x] `createEmailClient` throws in a browser with rotation named; `tryCreateEmailClient` answers `null` only for `NotConfiguredError`.
- [x] No request sets `mode`; no module reads `detail` or `title`; no key is minted. Grep-asserted.
- [x] Every documented JSON example is claimed: 17 examples, 11 key-checked across 5 classifiers.
- [ ] Live: `401` unknown key, `403` tripwire before auth, `404` stranger id, `400` out-of-range `limit`, `400` off-host `return_url`. **Not run** — no `EMAIL_SERVICE_*` credentials in this environment.

## Out of scope here

The admin tier, provider callbacks, inbound house events, the cron, template management, batch
sends, marketing sends, suppression removal, and open/click tracking — none of which the tenant
tier offers.
