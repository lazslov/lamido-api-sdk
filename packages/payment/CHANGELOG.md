# @lazslov/payment

## 1.0.2

Verified against knowledge base `714f2ee`: content-service `0048426`, invoice-service `706dc63`,
payment-service `e3828d2`, auth-service `bbeb4d4`, booking-service `18846e1`,
email-service `23051b9`, webshop-service `529003d`.

### Patch Changes

- Re-pin the contracts at knowledge base `714f2ee`, so the changelog inside each tarball names the
  commits these packages were verified against — now including the four services that gained a
  package in this release: auth-service, booking-service, email-service and webshop-service.

  No public surface moves in the five packages that already existed. Every operation and schema
  that changed upstream is outside what this SDK ships, and the regenerated types say so: two new
  admin routes (`POST /v1/admin/integrations/test` and
  `POST /v1/admin/invoices/{public_id}/revoke-download-links`), a `stats:read` admin scope,
  `signing_state` on an admin health body, and `publicly_enumerable` on a dataset **field
  descriptor** — which is dataset structure, written by staff, and referenced nowhere in
  `@lazslov/content`.

- Takes `@lazslov/api-core@2.0.0`, whose `ProblemFieldError.code` is now optional.

  Nothing in this package reads that member, so no behaviour moves here. A caller that reads
  `error.errors[0].code` on a `400` gets `string | undefined` and needs the fallback core's own
  changelog shows.

## 1.0.1

Verified against knowledge base `9b8228c`: content-service `eb0b88d`, invoice-service `7fdc5ec`,
payment-service `2cd0a4e`.

### Patch Changes

- Re-pin the contracts at knowledge base `9b8228c`, so the changelog inside the tarball names the
  commits these packages were verified against.

  No public surface moves in these three. The one shape that changed is payment-service's
  `DrainSummary`, which renamed `deadLettered` to `dead_lettered` at the service's `95c66a3`: it is
  the `/api/cron/webhooks` drain report, and this SDK has never exposed it.

## 1.0.0

Verified against knowledge base `5191225`: content-service `ecf20fd`, invoice-service `3aa099f`,
payment-service `62a1799`.

### Major Changes

- Track the three services onto their `/v1` surfaces. **Every package changes on every axis.**

  The services made one coordinated breaking move and gave it no deprecation window: an old path
  answers `404`. Nothing here is a rename you can shim — a caller that compiles against 0.1 and runs
  against the services today fails on the first request.

  ## What moved, across all three

  | Area            | Before                                                         | Now                                                                         |
  | --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
  | Paths           | `/api/client/*`, `/api/content/*`, `/api/invoices`, `/admin/*` | `/v1/*`, `/v1/public/*`, `/v1/admin/*`                                      |
  | Single resource | `{"data": {…}}`                                                | the resource, unwrapped                                                     |
  | Lists           | `{data, total, limit, offset}`                                 | `{data, next_cursor, total?}` — `next_cursor` **always present**            |
  | Pagination      | `limit`/`offset`                                               | opaque `cursor` on the unbounded lists; offset survives on the bounded ones |
  | Errors          | `{"error":{code,message,details}}` per service                 | one RFC 9457 problem document, one shared slug set                          |
  | Field errors    | Zod `flatten()`, top-level keys                                | `errors[]` with exact JSON Pointers                                         |
  | Casing          | `camelCase`                                                    | `snake_case`                                                                |
  | Health          | `503` when degraded                                            | always `200`                                                                |

  ## api-core

  - `LamidoApiError.code` is gone as the branch point. **Branch on `type`** — the RFC 9457 slug,
    from one closed set shared by all three services. `code` now carries the `409`/`422` sub-case
    where one exists, and `errors`, `retryAfter` and `requestId` are new.
  - `problemParser` and `readProblem` are new and exported: one reader, where each package used to
    ship its own. The three services' slug sets are identical by contract, so reading the document
    three times was three chances to disagree.
  - `collectAllCursor` is new, for the keyset lists. `collectAll` stays for the offset ones.
    **A short page no longer means the end of a list** — only a `null` cursor does, and a loop that
    assumes otherwise silently drops rows.
  - The `"data"` read mode is gone. There is no helper that unwraps `data`, deliberately: it
    discards `next_cursor`, and a dataset record's own payload member is also called `data`.

  ## content

  - Both tiers moved: `/api/content/*` → `/v1/public/*`, `/api/client/*` → `/v1/*`.
  - **The webhook is a different integration.** `verifyRevalidationWebhook` →
    `verifyContentWebhook`; the body is the estate event envelope (`event_type`, `occurred_at`,
    `data.page.slug`) rather than the flat revalidation POST; the headers are `X-Signature` and
    `X-Signature-Timestamp`; `slug: null` became a `site.revalidation_requested` event. **The
    signing secret is per endpoint now and the old per-site one cannot be carried across.** A
    receiver must answer `2xx` for an event type it does not know — five non-2xx answers disable
    the endpoint. `subjectOf` finds any event's subject without a per-type branch.
  - Dataset records and assets are keyset-paged; `getRecords` takes `cursor` and returns
    `nextCursor`. `to` became `until` and is **exclusive** where `to` was inclusive.
  - `getHealth` reads `/healthz`, which is liveness only and always answers `200`. The degraded-body
    smuggling is gone with the degraded response. Database health is admin-tier now.
  - **Assets and records are keyed by `public_id`, not `id`.** They are the two tables that grow
    without bound, so they are the two that carry one. Every other resource still uses `id`.

  ## invoice

  - **Money is a minor-unit decimal string.** `grossAmount: 38100` → `gross_amount_minor: "38100"`,
    and `netUnitPrice: 15000` → `net_unit_price_minor: "15000"`. HUF is zero-decimal here, so the
    digits are unchanged for forints and wrong by a factor of 100 for everything else. `"0"`,
    negatives, decimal points and numbers are rejected locally, before the request leaves.
  - Identity is `public_id`. Status `cancelled` → `canceled`.
  - The list is keyset-paged and still reports no `total`.
  - `InvoiceNotDownloadableError` is now a `422` with `code: "not_downloadable"`, and it is
    **retryable** — a state can change. It used to be a flat `400`, and the SDK used to read the
    invoice's status out of the message with a regex. It reads the code instead.
  - `InvoiceErrorCode` is gone; `InvoiceProblemCode` names the semantic sub-cases.

  ## payment

  - The merchant tier's paths were already `/v1`; the admin tier moved to `/v1/admin/*`.
  - `PaymentApiError.type` is the slug, not the URN. `conflictCode` merged into `code` and
    `retryAfterSeconds` into `retryAfter` — core owns both now.
  - **The delivered event is the estate envelope.** `event.payment` → `event.data.payment`,
    `created_at` → `occurred_at`, and the payment block is identified by `public_id` rather than
    `id`. `isKnownEvent` and `isRefundEvent` are new: `event_type` accepts any string so an event
    added upstream is still deliverable, and that is what stops a plain `===` narrowing the union.
  - The 502 provider-outcome triage and the in-flight `409` rule are unchanged. They are the part
    core cannot know.

### Minor Changes

- 4edf718: Raise the minimum supported Node from 18.17 to 20.19.

  Node 18 was never actually able to run the signature-verification paths: it exposes
  `globalThis.crypto` only under `--experimental-global-webcrypto`, so `verifySignedBody`,
  `verifyRevalidationWebhook` and `verifyPaymentWebhook` all threw there. The unflagged global
  arrives in Node 19. The old `engines` field promised support that did not exist.

  If you are on Node 18, upgrade to 20.19 or newer. Nothing else changed: no export was added,
  removed or renamed, and no behaviour differs on a runtime that already worked.

### Patch Changes

- Updated dependencies [4edf718]
- Updated dependencies
  - @lazslov/api-core@1.0.0

## 0.1.0

Verified against knowledge base `0bca8b0`: content-service `d7b5c46`, invoice-service `f5af0dc`,
payment-service `586eede`.

### Minor Changes

First release. The seven merchant endpoints. No admin endpoint, no `/v1/providers/*`, and no
browser-safe tier — every surface here throws when constructed in a browser.

- `MinorUnits` — a branded decimal string minted by `minorUnits()`, `huf()` or `eurCents()`.
  `createPayment({ amount_minor: "25.00" })` is a type error, and no exported function performs
  arithmetic on the type. HUF is zero-decimal; the branding is what stops that becoming a
  hundredfold mistake.
- `createPayment` and `createRefund` require an `IdempotencyKey`. The key is body-hashed
  upstream, so a request body's array order is preserved exactly as given.
- **502 triage.** Each of the four documented `detail` shapes classifies to a distinct verdict;
  an unrecognised one is `"unclassified"` with `retryable: false`. Failing closed is the only
  safe direction when the question is "did the money move?".
- `isFulfillable` is `true` for `succeeded` and for nothing else — not for `authorized`, not for
  `pending`, and deliberately not for `partially_refunded`.
- `verifyPaymentWebhook` and `parsePaymentWebhookEvent`, plus `./next`'s route handler, which
  cannot be constructed without `alreadyProcessed` and `markProcessed`.
- `reconcilePayments` — skips terminal payments, serialises per id, and returns a report rather
  than `void`, so a `429`'s `retry_after` reaches the caller instead of being swallowed.
