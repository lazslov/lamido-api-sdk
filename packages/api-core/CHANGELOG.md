# @lazslov/api-core

## 1.0.0

Verified against knowledge base `54fd521`: content-service `ecf20fd`, invoice-service `3aa099f`,
payment-service `4e3a0a5`.

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
  - `assetId` and `recordId` are new. The service's prose and its schema disagree about whether
    those resources carry `id` or `public_id`; both are declared optional and these read whichever
    arrived.

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

## 0.1.0

Verified against knowledge base `0bca8b0`: content-service `d7b5c46`, invoice-service `f5af0dc`,
payment-service `586eede`.

### Minor Changes

First release. The shared foundation the three service packages are built on, and the only
runtime dependency any of them declares.

- `request` — one `fetch` wrapper covering all five read modes, passing a caller's `init`
  through intact while refusing to let it overwrite `Authorization`.
- `LamidoApiError` and `NotConfiguredError`, with a redaction contract: no serialisation of a
  client or of a caught error contains any substring of the API key.
- `verifySignedBody` — a constant-time HMAC verifier on `crypto.subtle`, so it runs unchanged in
  an edge runtime with no `node:crypto` and no `Buffer`. **This is the one piece that must exist
  in exactly one place**, and the reason core is published rather than inlined three times.
- `resolveConfig`, `assertServerOnly`, `collectAll`, `idempotencyKey`, `buildQuery`.

Core exports no host, no default base URL and no service-specific error code. Nothing here
knows which service it is talking to.
