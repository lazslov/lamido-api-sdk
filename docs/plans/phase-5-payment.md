# Phase 5 — `@lazslov/payment`

**Goal:** the `pmk_` merchant tier — seven endpoints, the money type, RFC 7807 error triage,
and webhook verification. This is the package where a bug costs money, so it is the most
opinionated of the three.

**Depends on:** [phase 2](phase-2-api-core.md). Independent of phases 3 and 4.

**Reference:** [payment-service/merchant-api.md](../payment-service/merchant-api.md) and
[conventions.md](../payment-service/conventions.md). The
[integration checklist](../payment-service/merchant-api.md#integration-checklist) at the end of
merchant-api.md is the acceptance criteria for this phase, restated as code.

**Out of scope:** the admin tier (`pad_`), and `/v1/providers/*` — inbound PSP traffic,
*"never you"*.

---

## 1. The client

```ts
createPaymentClient(config?)      // pmk_ → /v1/*
tryCreatePaymentClient(config?)
```

Env, documented in
[merchant-api](../payment-service/merchant-api.md#what-the-operator-gives-you):
`PAYMENT_SERVICE_URL`, `PAYMENT_SERVICE_KEY`, `PAYMENT_SERVICE_WEBHOOK_SECRET`. Note the base
URL variable is `_URL`, not `_BASE_URL` — the other two services use `_BASE_URL` and the SDK
must not "harmonise" a name a deployment already sets.

Browser guard on `pmk_`, and it is the strictest of the three because the service itself has a
tripwire:

> Any request to `/v1/*` carrying an `Origin` header or `Sec-Fetch-Mode: cors` is rejected
> with **403 before authentication runs.** A browser-issued request to a server-to-server API
> means someone has wired `fetch()` in page JavaScript to an endpoint that takes a
> full-tenant key.

The SDK's guard fires earlier, at construction, with a message that says the key is now
exposed and needs **rotating, not hiding** — because by the time the 403 arrives the key has
already shipped to every visitor.

`mode` is never set. The service documents its own check as *"a tripwire, not a security
boundary"* — `Origin` is trivially forged outside a browser — so there is nothing for the SDK
to satisfy, and setting `mode: "same-origin"` here is the habit content-service explicitly
warns against carrying between these services.

**Mode is a property of the credential.** There is no `sandbox`/`live` option, no test
hostname, no `test: true` flag. The client exposes no way to ask for one, because asking would
imply it exists. Every payment reports the `mode` it was created under.

---

## 2. The money type

> **RULE — HUF has zero minor units in this API.** `"1000"` HUF means **1000 Ft**, not 10.00 Ft.
> EUR is 2-decimal, so `"1000"` EUR means €10.00.
> ([conventions §3](../payment-service/conventions.md#3-money))

> **RULE — never put an amount into a JavaScript `number`.** JSON numbers lose precision above
> 2^53 and floating point cannot represent `9.99`. Every amount is a **decimal string of
> canonical minor units**.

This is the highest-value type in the SDK, because the failure mode is a wrong charge.

```ts
/** A decimal string of canonical minor units. Digits only, no leading zero, never "0". */
export type MinorUnits = string & { readonly __minorUnits: unique symbol };

/** HUF is zero-decimal: huf(1000) → "1000" → 1000 Ft. */
export function huf(forint: number | bigint): MinorUnits;

/** EUR is 2-decimal: eurCents(1000) → "1000" → €10.00. */
export function eurCents(cents: number | bigint): MinorUnits;

/** Validate and brand a string that already holds minor units. */
export function minorUnits(value: string): MinorUnits;
```

Every request field that carries an amount is typed `MinorUnits`, not `string`. A caller
cannot pass a bare string or a number without going through a constructor, and the
constructors are named for the currency's actual exponent — `huf(1000)` reads as forint
because that is what it is, and there is deliberately no `huf(10.50)` that could round.

`minorUnits` rejects everything the service rejects, locally, with the service's own reason:

| Rejected | What it means about the caller |
|---|---|
| `"25.00"` | thinking in major units |
| `"1e3"` | a float leaked into the request |
| `" 1"` | a value was concatenated rather than computed |
| `"01"` | string manipulation on amounts — the habit that produces `"1000" + "00"` |
| `"0"` | a zero-amount payment, which no path may create |
| `-1`, `1000` (number) | not a string — and a type error, not a runtime one |

`huf`/`eurCents` accept `bigint` so a caller doing arithmetic can stay in `BigInt`, matching
how the service stores amounts (`bigint` in Postgres, `BigInt` in TypeScript — never
`numeric`, never `float`).

> **RULE — the SDK performs no arithmetic on amounts, and exports no `add`, `sum` or
> `subtract`.** Totals in the service are always grouped by currency and never summed across
> them; an SDK helper that summed a list of `MinorUnits` would have to either ignore currency
> or invent a currency-aware money object, and the second is a library this package should not
> become. Sites that need arithmetic do it in `BigInt`, visibly.

And see [phase 4 §5](phase-4-invoice.md#5-money-and-pagination--two-places-to-get-it-backwards):
there is **no conversion** to or from invoice-service's major-unit `number`. The two services
disagree by a factor of 100 and the conversion belongs in the site, written once, visibly.

---

## 3. Endpoints

| Method | Path | Notes |
|---|---|---|
| `createPayment(body, key)` | `POST /v1/payments` | `IdempotencyKey` required. Calls the PSP — the one endpoint with real latency |
| `getPayment(publicId)` | `GET /v1/payments/{public_id}` | |
| `refreshPayment(publicId)` | `POST /v1/payments/{public_id}/refresh` | throttled to 1 per payment per 5 s |
| `createRefund(publicId, body, key)` | `POST /v1/payments/{public_id}/refunds` | `IdempotencyKey` required. **Moves money** |
| `listRefunds(publicId)` | `GET /v1/payments/{public_id}/refunds` | unpaginated — bounded by the refund cap |
| `getRefund(publicId)` | `GET /v1/refunds/{public_id}` | |
| `listWebhookDeliveries(params)` | `GET /v1/webhook-deliveries` | `limit` 1–100, default 25, newest first |

**The merchant tier is not paginated.** Every list is bounded by construction, so
`collectAll` is not re-exported from this package.

Notes that shape the signatures:

- **`provider` is optional and must stay optional.** Omitted with one active credential uses
  it; omitted with two is a `400`, because *"guessing which PSP charges your buyer is not a
  defaulting decision."* The SDK must not default it either.
- **`merchant_payment_ref` is not required to be unique** — a retried checkout of the same
  cart legitimately reuses it. So it is not an idempotency key and the doc comment says so, to
  stop someone using it as one.
- **No buyer PII field exists**, and `metadata` must not be used as a smuggling route: it is
  stored **unencrypted** and echoed back on every read. The `metadata` type is
  `Record<string, unknown>` with a doc comment stating that, plus the 4096-byte serialised cap.
- **`createRefund` has no "refund the remainder" shortcut.** The service refuses to provide a
  default because *"a default would refund different amounts depending on when the request
  arrived."* The SDK does not add one. `amount_minor` is required.
- **Refund amounts come from what the API reports as remaining**, not from the caller's own
  bookkeeping — a checklist item in merchant-api.md. The README shows reading the payment
  first; the SDK does not compute a remaining amount itself, since that would be arithmetic
  on amounts (§2).

### `getPayment` returns `null` on 404? No.

> **GOTCHA — another merchant's id returns `404`, not `403`.** Every read is scoped to the
> key's merchant inside the same SQL predicate that fetches the row.

Unlike content-service, a 404 here is **not** a normal state — a payment id you hold came from
a payment you created. So `getPayment` **throws** on 404 rather than returning `null`, and the
error message says explicitly that this can mean *the wrong tenant's key is configured*, not
just "no such payment". Mapping it to `null` would turn a credential misconfiguration into an
empty result.

---

## 4. Status: fulfilment is a typed decision

> **RULE — never fulfil an order on `pending`.** It means the buyer has been sent to a
> gateway, nothing more. Only `succeeded` means money moved.

The status union is exported, and so is one small predicate:

```ts
export type PaymentStatus =
  | "pending" | "authorized" | "succeeded" | "failed" | "canceled" | "expired"
  | "partially_refunded" | "refunded";

/** True only for statuses where money has actually moved. */
export function isFulfillable(status: PaymentStatus): boolean;

/** True when no further transition is possible — stop reconciling. */
export function isTerminal(status: PaymentStatus): boolean;
```

`isFulfillable` deliberately excludes `authorized`, which *"exists in the model because
Stripe can produce it, not because it is driven"* — there is no auth/capture split here, so
treating it as paid is wrong.

`isTerminal` exists for the reconciliation loop, which must stop once a payment is terminal.

> **RULE — branch on `status`, never on `provider`.** `provider_status` is the PSP's own word
> verbatim (`"Succeeded"`, `"complete/paid→pi:succeeded"`) and is *"not stable across
> providers"*. It is exposed so an unmapped status is still actionable, and the doc comment
> says: for humans and logs, not for control flow.

---

## 5. Errors: RFC 7807, and a 502 that is not a failure

Success responses have **no envelope** — the resource itself. Failures are
`application/problem+json`. So the parser is entirely different from the other two packages.

```ts
export type PaymentProblemType =
  | "urn:payment-service:problem:validation"
  | "urn:payment-service:problem:unauthorized"
  | "urn:payment-service:problem:forbidden"
  | "urn:payment-service:problem:not-found"
  | "urn:payment-service:problem:conflict"
  | "urn:payment-service:problem:rate-limit"
  | "urn:payment-service:problem:internal";
```

> **RULE — branch on `type`, never on `title` or `detail`.** `title` summarises the HTTP
> **status**, not the type, so a 422 whose type is `conflict` reads "Unprocessable Entity".

Two documented shapes the error class must model faithfully:

- **`conflict` carries both 409 and 422.** A 409 is a duplicate or concurrent write; a 422
  means the resource's *state* forbids it and **is** retryable later, because state changes.
  So `retryable` cannot be derived from `type` alone — it needs `type` **and** `status`.
- **A PSP failure is `internal` with HTTP 502**, not a `provider` type. From the caller's
  point of view what matters is "their side, not mine", and the status already says whether
  retrying helps.

The `code` extension member on a 422 is exported as its own union, since these are the values
a caller actually switches on: `payment_not_refundable`, `currency_mismatch`,
`refund_target_unknown`, `refund_exceeds_remaining`, `not_releasable`, `known_to_provider`,
`already_attached`, `endpoint_disabled`.

### 502 triage — the one place the SDK reads `detail`

A 502 has four distinct meanings, and the *only* thing distinguishing them is the prose in
`detail`. The retry rule differs in each, and getting it wrong double-charges.

| `detail` says | What happened | Retry |
|---|---|---|
| "The provider rejected the …" | definitively nothing happened at the PSP | safe, **same** key, once the request is fixed |
| "…could not be reached and the outcome is unknown; retry with the same Idempotency-Key" | unknown | **same key only** — a retry with the same key is forced through a probe of the PSP before anything is sent again |
| "The refund was sent but the provider did not answer…" | a refund with an unknown outcome | **do not retry.** Read the refund; the reconciler resolves it |
| "The provider response could not be trusted" | an integrity check failed | **no.** An operator has to look |

So the SDK classifies it — and this is the one deliberate exception to *"branch on `type`,
never on `detail`"*, made explicitly and documented as such:

```ts
export type ProviderOutcome =
  | "rejected"          // safe to retry with the same key
  | "unknown"           // same key ONLY
  | "refund_unknown"    // do not retry; read the refund
  | "untrusted"         // do not retry; escalate
  | "unclassified";     // detail did not match — treat as `unknown` and do not retry blind

/** Present only when status === 502. */
readonly providerOutcome?: ProviderOutcome;
```

Two safety properties this must have:

1. **Matching is on stable substrings, and a miss falls back to `"unclassified"`** — never to
   `"rejected"`, the only value that permits a free retry. If the service rewords a message,
   the SDK becomes *more* cautious, not less.
2. **`retryable` is `false` for `"unclassified"`.** The default answer to "we could not tell
   what happened to money" is stop.

`provider_error` (the extension member on a 502) is a short, non-secret description of what
the PSP said, and is attached as-is.

Also modelled: `retry_after` (seconds, on a 429 from `refresh` — the per-payment throttle, and
**no provider call was made**), and `supported_events` on a 400.

`instance` is the request **path**, never a full URL and never with a query string, *"because
Barion puts `paymentId` in the query and there is no reason to echo it into anyone's logs."*
Core already enforces this for `requestPath` — same discipline, same reason.

---

## 6. Idempotency

Required on `createPayment` and `createRefund`; both take a branded `IdempotencyKey`. There is
no overload without one, and core will not generate one — see
[phase 2 §9](phase-2-api-core.md#9-idempotency-plumbing).

The return types surface replay, from the status and the `Idempotent-Replay` header:

```ts
type CreatePaymentResult = { payment: Payment; replayed: boolean };
```

Facts the README must state, because each changes what a caller writes:

- **Payment keys live 7 days; refund keys 24 hours.** After the TTL the key is free and
  reusing it starts a genuinely new operation.
- **Scoped per merchant *and* per operation type** — the same key may be used once for a
  payment and once for a refund.
- **The body is hashed with object keys sorted**, so a client library that reorders JSON keys
  replays rather than conflicting. **Array order is significant** — so the SDK must not
  reorder, dedupe or normalise an array in a request body, ever.
- **A 400 releases the key**, so a validation failure is retryable with the same key.
- **A 409 during an in-flight attempt is retryable after a pause** — the lease is 60 s. This
  is also what the [TTL-boundary clock-skew GOTCHA](../payment-service/conventions.md#5-idempotency)
  surfaces as: pause and retry the same key; it clears once both clocks agree. The SDK
  attaches a note to that error saying to pause and reuse the key, because the naive reading
  of a 409 is "use a new key", which here is a second payment.

> **GOTCHA — a new key after an unanswered request is how double charges happen.** Barion does
> **not** deduplicate on its own request id: two identical `Payment/Start` calls with the same
> `PaymentRequestId` produce two payments, confirmed against its sandbox.

---

## 7. Webhooks

`verifyPaymentWebhook` binds core's `verifySignedBody` to `X-Signature` /
`X-Signature-Timestamp` with a 300 s tolerance, and is the direct SDK equivalent of the
snippet published in the service repo — which is *drift-tested there against the signing
implementation*. Phase 7 mirrors that: the SDK's fixtures are the same fixtures, so a
divergence fails a build rather than a production webhook.

The whole `whsec_…` string is the key. The prefix is key material, not a label to strip.

Beyond verification, the SDK ships the **event types** and a parser that returns a discriminated
union on `event_type`, plus doc comments for the two traps:

- **`payment.id` in a webhook payload is the payment's `public_id`.** The webhook payload is a
  frozen wire format whose field names match v1's published contract, so it is spelled
  differently from the REST responses. The SDK's `PaymentWebhookEvent` type does **not**
  rename it to `public_id` — renaming would hide the discrepancy from someone reading both.
- **Dedupe on `X-Event-Id`**, which is stable across retries; `X-Delivery-Id` is per HTTP
  attempt. Delivery is **at-least-once** and *"the dedupe is not optional."* The SDK cannot
  dedupe for a consumer (it owns no storage), so the route-handler helper in
  [phase 6](phase-6-next-adapters.md) takes an `alreadyProcessed` callback as a **required**
  parameter — the one design choice available to make omitting it impossible.

Delivery facts for the README, all of which change what a site builds:

| Property | Value |
|---|---|
| Your deadline | **5 seconds.** A slower response is a failed attempt |
| Ordering | **not guaranteed** — reconcile against `payment.status` in the payload, not arrival order |
| Redirects | a `30x` is a failure, never followed |
| Attempts | 8, over ≈3.5 days, then dead-lettered. **5 consecutive dead-letters disable the endpoint entirely** |
| Retry intervals | **floors, not promises** — a delivery becomes *eligible* and is attempted by the next sweep, which on the current hosting tier can be hours later |

> **RULE — respond `2xx` within 5 seconds and do the real work asynchronously.** Fulfilment
> that takes eight seconds turns every delivery into a retry, and eventually into
> dead-letters that disable your endpoint.

Because the intervals are floors, **nothing may assume a webhook arrives within a bounded
time**, which is why §8 exists.

---

## 8. The reconciliation backstop

Webhooks plus the redirect cover almost everything. The gap is a buyer who closes the tab
*and* an endpoint that was down during the inline attempts. merchant-api.md publishes the
loop, and the SDK ships it as a helper because every site needs the identical thing:

```ts
reconcilePayments({
  publicIds: string[],
  onStatus: (publicId: string, payment: Payment) => Promise<void>,
}): Promise<void>
```

Behaviour, straight from the published loop and the throttle rules:

- `getPayment` each id; if still `pending`, call `refreshPayment`, then hand the result to
  `onStatus`.
- **Respect the 5-second-per-payment refresh throttle.** The helper serialises per id and
  surfaces a 429's `retry_after` rather than swallowing it. A failed refresh **consumes the
  throttle window**, so a retry loop cannot hammer a PSP that is timing out — the helper does
  not retry a 429 itself.
- **Stop once a payment is terminal** (`isTerminal`), so a settled payment is never refreshed
  again.
- The helper does **not** own scheduling, storage, or the "orders awaiting payment older than
  N minutes" query. Those are the site's. It owns only the throttle-and-refresh discipline,
  which is the part that is easy to get wrong and identical everywhere.

The README repeats the doc's framing: *let this be the thing you trust — not the delivery
schedule.*

---

## Public API surface

```ts
// @lazslov/payment
export { createPaymentClient, tryCreatePaymentClient }
export { PaymentApiError, type PaymentProblemType, type PaymentConflictCode, type ProviderOutcome }
export { huf, eurCents, minorUnits, type MinorUnits }
export { isFulfillable, isTerminal, type PaymentStatus }
export { verifyPaymentWebhook, parsePaymentWebhookEvent, type PaymentWebhookEvent }
export { reconcilePayments }
export type { Payment, Refund, RefundStatus, WebhookDelivery, Provider, PaymentMode }
```

---

## Exit criteria

Restating merchant-api.md's own integration checklist as tests:

- [ ] All seven merchant endpoints callable. No admin endpoint, no `/v1/providers/*`.
- [ ] `createPayment({ amount_minor: "25.00" })` is a **type** error; `minorUnits("25.00")`, `("1e3")`, `(" 1")`, `("01")`, `("0")` all throw. One test each.
- [ ] `huf(1000)` → `"1000"`; `eurCents(1000)` → `"1000"`; `huf(10.5)` throws.
- [ ] No exported function performs arithmetic on `MinorUnits`. Grep-asserted against the export list.
- [ ] No exported conversion between `MinorUnits` and invoice's `grossAmount`.
- [ ] `createPayment` and `createRefund` have no overload lacking an `IdempotencyKey`.
- [ ] A 502 for each of the four `detail` shapes classifies correctly; an unrecognised `detail` yields `"unclassified"` with `retryable: false`. **A reworded message must never classify as `"rejected"`** — asserted with a deliberately garbled fixture.
- [ ] A 422 is `retryable: true`; a 409 is `retryable: false` **except** the in-flight-lease case, whose error carries the pause-and-reuse note.
- [ ] `isFulfillable("pending")` and `isFulfillable("authorized")` are both `false`.
- [ ] `getPayment` throws on 404 and its message names the wrong-tenant possibility.
- [ ] `verifyPaymentWebhook` passes the same fixtures the service repo pins its signer against, including a non-ASCII body; a `whsec_` secret is used whole and never split.
- [ ] `parsePaymentWebhookEvent` handles `refund.*` events' extra block, and `payment.id` is **not** renamed to `public_id`.
- [ ] A request body containing an array is sent with its order intact — asserted, because reordering breaks the body hash.
- [ ] `reconcilePayments` skips terminal payments, serialises per id, and surfaces a 429's `retry_after` without retrying.
- [ ] `createPaymentClient` throws when constructed in a browser, with rotation named in the message.
- [ ] No request sets `mode`. Grep-asserted.

## Out of scope here

The admin tier, PSP callback handling (`/v1/providers/*` is inbound traffic, never ours),
Stripe or Barion SDKs of any kind, currency conversion (a payment is created and settled in
one currency), and recurring payments, saved cards, payouts or disputes — none of which the
service does.
