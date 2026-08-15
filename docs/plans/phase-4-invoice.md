# Phase 4 — `@lazslov/invoice`

**Goal:** the `isk_` client tier — issue, list, fetch, download and cancel invoices. Six
endpoints plus a public PDF link. Small surface, unusually sharp edges.

**Depends on:** [phase 2](phase-2-api-core.md). Independent of phases 3 and 5.

**Reference:** [invoice-service/client-api.md](../invoice-service/client-api.md) and
[conventions.md](../invoice-service/conventions.md).

**Out of scope:** the admin tier (`iad_`), which is the larger half of this service
(1,083 lines of docs) and is operator-only.

---

## 1. The client

```ts
createInvoiceClient(config?)      // isk_ → /api/invoices/*
tryCreateInvoiceClient(config?)
```

Env: `INVOICE_SERVICE_BASE_URL` (documented), `INVOICE_SERVICE_CLIENT_KEY` (proposed).

Browser guard on `isk_`: no CORS headers are served on **any** route, so a browser `fetch`
fails regardless — but it fails opaquely, and the key is public by then. The guard turns that
into a legible construction-time error.

> **GOTCHA — do not set `mode: "same-origin"` here as a habit and then copy it to
> `@lazslov/content`.** invoice-service's admin tier rejects a request carrying `Origin` or
> `Sec-Fetch-Mode: cors`, and content-service's docs specifically warn that integrators who
> added a workaround for that
> [must not copy it](../content-service/conventions.md#8-security-invariants). Since v1 does
> not cover the admin tier, this package sets **no** `mode` at all. Recorded here so the next
> person does not add one.

---

## 2. Endpoints

| Method | Endpoint | Read mode |
|---|---|---|
| `createInvoice(body, key)` | `POST /api/invoices` | `data` + **meta** (status matters — §3) |
| `listInvoices(params)` | `GET /api/invoices` | `envelope` — **no `total`**, see §5 |
| `getInvoice(id)` | `GET /api/invoices/:id` | `data` |
| `getInvoicePdf(id)` | `GET /api/invoices/:id/pdf` | **`bytes`** |
| `createDownloadLink(id)` | `GET /api/invoices/:id/download-link` | `data` |
| `cancelInvoice(id)` | `POST /api/invoices/:id/cancel` | `data` — returns `stornoNumber`, §6 |
| `getHealth()` | `GET /healthz` | `raw` — **no `data` wrapper**, unauthenticated |

`getHealth` is one of the three documented envelope exceptions and answers an unwrapped
`{"status":"ok","db":"ok"}`. A shared unwrapper applied to it returns `undefined`, which is why
[core's `ReadMode`](phase-2-api-core.md#4-the-three-read-paths) is explicit per call.

The route always answers `200` while the process is alive, so an unreachable database arrives as
`{"status":"degraded","db":"unreachable","code":"…"}` — also at `200`. Read `db`; a check that
stops at `response.ok` reports a healthy service over a dead database.

---

## 3. Idempotency — the sharpest edge in this service

`POST /api/invoices` requires an `Idempotency-Key`. The SDK takes it as a required, branded
`IdempotencyKey` parameter — there is no overload without one.

What makes this service different from payment-service:

> **RULE — a key is consumed on first use, whatever the outcome.** Replaying a key returns
> the stored row as-is with HTTP 200 and does **not** call the provider again. If the first
> attempt ended `failed`, the replay returns that failed invoice **forever**. To actually
> retry a failed invoice, use a **new** `Idempotency-Key`.
> ([conventions §9](../invoice-service/conventions.md#9-idempotency))

And the CRITICAL from [client-api §1](../invoice-service/client-api.md#responses): on a
500/502 from the provider path, **the invoice row is still written, as `failed`.** So the
naive retry loop — same key, exponential backoff — is guaranteed to return the same failure
forever while looking like a transient problem.

This is the opposite of payment-service, where a same-key retry after an unreachable PSP is
the *only* safe move. Two services, two rules, one habit that breaks one of them.

The return type makes the distinction unavoidable:

```ts
type CreateInvoiceResult = {
  invoice: Invoice;
  /** false = 201, a new invoice was just issued. true = 200, this key was already used. */
  replayed: boolean;
};
```

> **RULE — branch on the status code, not the body.**
> ([client-api §1](../invoice-service/client-api.md#responses))

`replayed` is derived from the status inside the method, so a caller cannot get it wrong. And
because `invoice.status` can be `failed` on a `replayed: true` response, the doc comment on
`replayed` states the retry rule in one sentence: *a replay of a failed invoice needs a new
key, not another attempt.*

`derivedIdempotencyKey("invoice-<orderId>", attempt)` from core is the recommended shape, with
the attempt number explicit at the call site — see
[phase 2 §9](phase-2-api-core.md#9-idempotency-plumbing).

---

## 4. Outbound validation — the four things the service does not check

This is the one package where the SDK validates *before* sending, because the service
deliberately passes these through to the provider and the failure surfaces as an opaque
`502 provider_error` from szamlazz.hu or Billingo.

| Field | Service behaviour | SDK behaviour |
|---|---|---|
| `issueDate`, `fulfillmentDate`, `dueDate` | **Not format-validated.** Typed as plain strings and passed straight through. `"2026-13-45"` or `"25/07/2026"` is accepted here and rejected by the provider as a `502`. | A branded `IsoDate` type (`YYYY-MM-DD`) plus `isoDate(d: Date \| string)`. Rejects locally, with the field named. |
| `vatRate` | A typo is not caught. `"27%"` or `27` (number) fails downstream. | Validate against the documented accepted forms before sending. |
| `providerConfigId` | Must match `^[a-z0-9_]+$`, ≤64, **and start with `szamlazz_` or `billingo_`**. A mismatch is a `400 bad_request`. | Validated locally — it is a pure string rule, and a local failure names the rule instead of returning a generic 400. |
| `items` | Must contain ≥1 element. | Non-empty tuple type where practical, plus a runtime check. |

Hand-written predicates, no validation library — see
[phase 1 §2](phase-1-foundations.md#2-dependency-policy).

> **GOTCHA — `validation_error.details.fieldErrors` keys are top-level only.** A failure deep
> inside `partner.address.postalCode` surfaces under the key `partner`, not the full path. The
> error type reflects that (`Record<TopLevelField, string[]>`) rather than promising a path,
> and the README says to validate against the schema locally to find the real field. This is
> the other reason the outbound checks above are worth having.

---

## 5. Money and pagination — two places to get it backwards

### Money is a major-unit **number** here

`grossAmount` is a plain JSON number in major units — `38100` means 38 100 Ft.

> **RULE — this is the opposite of `@lazslov/payment`,** where every amount is a decimal
> **string** of **minor** units and HUF is zero-decimal. A value moved between the two
> packages without conversion is wrong by a factor of 100 in one direction or the other.

The SDK will not hide this behind a shared money type — a shared type would imply the two
services agree. Instead:

- `Invoice.grossAmount` is typed `number | null` and its doc comment says *major units, and
  points at payment's minor-unit string type by name*.
- `@lazslov/payment` exports **no** conversion to or from this type. If a site needs to invoice
  a payment, the conversion is written in that site, visibly, once.

`grossAmount` is `null` for `pending` and `failed` invoices — it is only meaningful once
`created`. The type says so, and the README warns against `?? 0`.

`currency` is free text, whatever the provider echoed back. Not an enum.

### `GET /api/invoices` returns no `total`

> **GOTCHA — no `total`.** Paginate until a page returns fewer than `limit` rows.
> ([client-api §2](../invoice-service/client-api.md#2-get-apiinvoices--list))

This is the case that forced branch 3 of core's paginator
([phase 2 §8](phase-2-api-core.md#8-the-paginator)). `listInvoices` returns the envelope with
`total?: undefined` in its type — not `total: number` — so a caller writing
`Math.ceil(total / limit)` gets a type error rather than `NaN` pages.

`listAllInvoices()` wraps `collectAll` for the common case.

---

## 6. PDFs and links

Three PDF paths, and each behaves differently:

| Method | Notes |
|---|---|
| `getInvoicePdf(id)` | Raw `application/pdf` bytes. Returns `{ bytes: ArrayBuffer; filename: string }`, parsing `Content-Disposition`. **Cancelled invoices are not downloadable here** — the SDK maps that documented failure to a named error rather than an opaque 4xx. |
| `createDownloadLink(id)` | Mints a public, signed URL valid 7 days. |
| the public URL itself | `GET /api/public/invoices/:id/pdf?token=…` — unauthenticated. **The SDK does not fetch it.** It is a URL to hand to a browser or paste into an email; fetching it server-side through an authenticated client is pointless. |

> **RULE — an individual download link cannot be revoked.** Anyone holding the URL can fetch
> the PDF until it expires; revoking all of them at once means changing the signing key. The
> return type of `createDownloadLink` includes `expiresAt` and its doc comment states the
> non-revocability, because a link handed to the wrong recipient has no undo.

PDFs are **not stored** — they are re-fetched from the provider on every request, so a
provider outage means no PDF even for an old invoice. Worth a README line: do not build a
"download all invoices" feature that assumes availability.

---

## 7. `stornoNumber` — the silent failure

> **RULE — `stornoNumber` is returned by `cancelInvoice` and nowhere else.** There is no
> column for it, so it is not on the invoice object from any other endpoint.
>
> **GOTCHA — this is a silent failure.** Rendering `invoice.stornoNumber` on a detail page
> shows `undefined`. ([client-api §6](../invoice-service/client-api.md#6-post-apiinvoicesidcancel--cancel-storno))

The type system can prevent this outright, and should:

```ts
/** The invoice object as every read endpoint returns it. Has no `stornoNumber`. */
export interface Invoice { /* … */ }

/** Only `cancelInvoice` returns this. Capture `stornoNumber` here or lose it. */
export interface CancelledInvoice extends Invoice { readonly stornoNumber: string }
```

`Invoice` does not declare the property at all, so `invoice.stornoNumber` on a value read from
`getInvoice` is a **compile error**, not `undefined` on a page. This is the single clearest
case in the whole SDK of a type turning a documented silent failure into a build failure.

---

## 8. Errors

```ts
export type InvoiceErrorCode =
  | "validation_error" | "bad_request" | "unauthorized" | "forbidden"
  | "not_found" | "conflict" | "provider_error" | "internal_error"
  | "not_configured";
```

`retryable`, from [conventions §5](../invoice-service/conventions.md#5-error-codes):

| Code | `retryable` | Note attached to the error |
|---|---|---|
| `provider_error` (502) | `true` | **but not with the same key on a create** — see §3. Carries the provider's own error text (`szamlazz error 54: …`). |
| `internal_error` (500) | `true` | with backoff. On a create, this often means the *credential could not be resolved* — a config problem, not a transient one. |
| everything else | `false` | |

The 500-vs-502 distinction on create is worth surfacing because the fixes differ: a 502 is the
provider refusing, a 500 is usually an unresolvable credential or a decryption failure. The
error message includes the pointer to the admin `…/test` endpoint an operator would run, in
words, without naming a host.

There are **no webhooks** in this service — *"the service never calls you"*. So this package
exports no verifier and no route handler, and its README says to poll `getInvoice` if
confirmation is needed. That absence is why phase 6 covers content and payment only.

Also absent: rate limiting (be polite; batch and back off yourself), bulk endpoints (one
invoice per request), invoice modification (cancel only, never edit), and partner persistence
(you cannot search invoices by customer name).

---

## Public API surface

```ts
// @lazslov/invoice
export { createInvoiceClient, tryCreateInvoiceClient }
export { InvoiceApiError, type InvoiceErrorCode }
export { isoDate, type IsoDate }
export type { Invoice, CancelledInvoice, CreateInvoiceResult, InvoiceStatus, InvoiceItem, Partner }
```

No `./next` subpath, no `./fields`. One entry point.

---

## Exit criteria

- [ ] All six client-tier endpoints plus `/healthz` are callable; no admin endpoint exists.
- [ ] `createInvoice` reports `replayed: true` on a 200 and `false` on a 201, and there is no overload that omits the idempotency key.
- [ ] `invoice.stornoNumber` from `getInvoice` is a **compile error**; from `cancelInvoice` it type-checks.
- [ ] `isoDate("2026-13-45")` and `isoDate("25/07/2026")` both throw locally, before any request.
- [ ] `listInvoices(...).total` is a type error; `listAllInvoices()` terminates on a short page with no `total` present.
- [ ] `getInvoicePdf` returns bytes and a filename; the cancelled-invoice case surfaces as a named error.
- [ ] `getHealth()` returns `{ status: "ok", db: "ok" }` and is not run through a `data` unwrapper.
- [ ] `grossAmount` is `number | null` and no exported helper converts it to or from payment's minor-unit string.
- [ ] No `mode` is set on any request. Grep-asserted.
- [ ] `provider_error` is `retryable: true`, and its doc comment states the new-key rule for creates.

## Out of scope here

The admin tier, webhooks (there are none), PDF caching or storage, and any invoice→payment
reconciliation. Reconciling an invoice against a payment is a site's business logic and needs
both packages plus the site's own order model; the SDK deliberately provides no bridge.
