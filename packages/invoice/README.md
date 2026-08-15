# @lazslov/invoice

Consumer SDK for invoice-service — Hungarian invoices through szamlazz.hu and Billingo, with the
provider chosen per request.

**What ships in it:** all six client-tier endpoints plus `/healthz`. There is no `./next`
subpath and there never will be: this service has no webhooks, so there is nothing for a route
handler to receive.

## Install

```sh
pnpm add @lazslov/invoice
```

Zero runtime dependencies except `@lazslov/api-core`, which is the shared transport.

## Configuration comes from your environment

```ini
INVOICE_SERVICE_BASE_URL=https://invoice.example.com
INVOICE_SERVICE_CLIENT_KEY=isk_YOUR_CLIENT_KEY
```

There is **no fallback host**. A missing base URL is a configuration error the SDK reports, never
a silent default, and no host, key or tenant identifier is baked into this package. Explicit
config always wins over the environment, so one process can hold clients for two tenants.

`tryCreateInvoiceClient()` returns `null` instead of throwing when nothing is configured, so an
order route renders with invoicing disabled rather than crashing.

## Never import this into a browser bundle

This service has **no browser-safe key tier**. An `isk_` key can read every invoice of its tenant
and issue real stornos.

No CORS headers are served on **any** route, so a browser `fetch` fails regardless — but it fails
opaquely, as a CORS error that reads like a deployment problem, and by then the key has shipped to
every visitor. `createInvoiceClient` throws at construction instead, and its message says to
**rotate** the key: hiding it afterwards changes nothing.

Keep `import "server-only"` at the top of the module that constructs the client. A build error
beats a runtime throw.

## Issuing an invoice

```ts
import "server-only";
import { createInvoiceClient, isoDate } from "@lazslov/invoice";
import { derivedIdempotencyKey } from "@lazslov/api-core";

const invoices = createInvoiceClient();

const { invoice, replayed } = await invoices.createInvoice(
  {
    provider: "billingo",
    provider_config_id: "billingo_acme",
    partner: {
      name: "Teszt Vevő Kft",
      tax_number: "12345678-2-42",
      address: { postal_code: "1011", city: "Budapest", address: "Fő utca 1" },
    },
    items: [
      // Minor units, as a decimal string. HUF is zero-decimal here, so this is 15 000 Ft.
      { name: "Tanácsadás", quantity: 2, unit: "óra", net_unit_price_minor: "15000", vat_rate: "27" },
    ],
    due_date: isoDate("2026-08-02"),
    partner_ref: order.id, // an order id — never a name or a tax number
  },
  derivedIdempotencyKey(`invoice-${order.id}`, 1),
);

if (!replayed) await store(order.id, invoice.public_id);
```

**Persist the returned `public_id` immediately.** It is the only handle for the PDF, the cancel
and a support lookup — the internal primary key never appears. If it is lost, only an operator can
find the invoice again, by `partner_ref`.

## The idempotency rule that is the opposite of payment-service

> **A key is consumed on first use, whatever the outcome.** Replaying it returns the stored row
> unchanged with HTTP `200` and does not call the provider. If the first attempt ended `failed`,
> the replay returns that failed invoice **forever**.

`replayed` comes from the status code — `201` issued something, `200` did not — so a caller cannot
get it wrong by reading the body. And a replay can be in any status:

| Outcome | Key consumed | What to do |
| --- | --- | --- |
| `201` | yes | Done. Store `invoice.public_id`. |
| `200`, `status: "created"` | already was | Done — you already issued this. |
| `200`, `status: "failed"` | already was | **A new key.** Retrying this one is pointless. |
| `200`, `status: "pending"` | already was | Stuck mid-call. An operator must reconcile it. |
| `400` / `401` / `403` | **no** | Fix the request or the credential, resend the **same** key. |
| `500` / `502` | **yes** | Row stored as `failed`. Fix the cause, then a **new** key. |
| timeout, no response | unknown | Do **not** blind-retry. Read the invoice back first. |

`@lazslov/payment` teaches the opposite habit — there, a same-key retry after an unanswered request
is the *only* safe move, because a new key starts a second payment. Two services, two rules, and
one habit that breaks one of them. The `advice` on a thrown `InvoiceApiError` says which applies.

Derive keys from the business event, never from the clock: `invoice-<orderId>` for the first
attempt, `attempt: 2` for a deliberate retry. A random UUID per attempt removes the protection
entirely and will double-invoice.

## Five things the service does not check, so this package does

Each of these is forwarded to the provider verbatim and comes back as an opaque `502` — with the
key already spent. All five fail locally, before any request, with a `TypeError` naming the rule.

```ts
isoDate("2026-13-45"); // throws — no such month
isoDate("25/07/2026"); // throws — the service would forward this
```

| Field | The rule |
| --- | --- |
| `issue_date`, `fulfillment_date`, `due_date` | A real day in `YYYY-MM-DD`. The branded `IsoDate` type means a bare string does not even compile. |
| `items[].vat_rate` | A bare percentage **as a string** (`"27"`, `"5"`, `"0"`) or an upper-case code (`"AAM"`, `"TAM"`, `"EU"`). Never `"27%"`, never the number `27`. |
| `items[].net_unit_price_minor` | Canonical minor units as a string: digits only, no sign, no decimal point, no leading zero, and **never `"0"`**. Never the number `15000`. |
| `provider_config_id` | `^[a-z0-9_]+$`, ≤ 64 characters, and starting with `szamlazz_` or `billingo_`. |
| `items` | At least one line — a tuple type, plus a runtime check. |

> **A `400` carries `errors[]` with exact JSON Pointers.** `error.errors` is the machine-readable
> half — `{ pointer: "/items/0/vat_rate", code, detail }` — and every problem in the request is
> reported at once, so one round trip is enough to fix all of them. This replaced Zod's
> `fieldErrors`, whose keys were top-level only: a failure deep inside `partner.address.postal_code`
> used to surface as just `partner`.

## Money is a minor-unit string here

`gross_amount_minor: "38100"` means **38 100 Ft**, because HUF is zero-decimal in this API — a
deliberate estate-wide deviation from ISO 4217. For EUR or USD it is cents. It is `string | null`
and `null` until the status is `created`, so do not write `gross_amount_minor ?? "0"`, which
reports a pending invoice as a zero-forint one.

A string rather than a number because **a JSON number loses precision above 2^53**, which a yearly
HUF total reaches.

> **This changed, and the old value is wrong rather than merely renamed.** `grossAmount` was a
> major-unit `number` and `netUnitPrice` was one too. Passing an old major-unit value into
> `net_unit_price_minor` under-charges by a factor of 100 on every two-decimal currency, and the
> SDK rejects the shapes it can see — a number, a decimal point, a sign, a leading zero, `"0"` —
> before the request leaves.

The upside: this now **agrees** with `@lazslov/payment`, which has always used minor-unit strings.
The two packages used to contradict each other by a factor of 100, and a value moved between them
needed a conversion neither offered. It no longer does, for the same currency.

## `GET /v1/invoices` is keyset-paged and returns no `total`

Counting a filtered, unbounded table on every page is not cheap, so the list reports no `total` —
and the list type declares none, making `Math.ceil(list.total / limit)` a compile error rather than
`NaN` pages.

> **Follow `nextCursor`, never a short page.** A filtered keyset page can come back under `limit`
> with more behind it, so "fewer rows than I asked for" is not the end of the list. This replaced
> `limit`/`offset`, where a short page *was* the terminator — the same loop written against the new
> list silently drops everything after the first gap.

```ts
const page = await invoices.listInvoices({ status: "failed", limit: 50 });
const done = page.nextCursor === null;
const next = await invoices.listInvoices({ status: "failed", limit: 50, cursor: page.nextCursor });

const all = await invoices.listAllInvoices({ status: "created" });
```

The cursor is opaque: pass it back verbatim, and never construct, parse or store one. A malformed
cursor is a `400`, never a quiet restart from page one.

`listAllInvoices` throws rather than truncating if it runs past its loop breaker; raise `maxPages`
deliberately. This tier has no date filter and no free-text search — both are admin-only — and
because partner data is never stored, **invoices cannot be found by customer name**.

## PDFs and links

```ts
const pdf = await invoices.getInvoicePdf(id); // { bytes, filename }
const link = await invoices.createDownloadLink(id); // { url, expiresAt }
```

PDFs are **not stored**. Every call re-fetches from the provider, so a provider outage means no
PDF even for an old invoice — do not build a "download all invoices" feature that assumes
availability. And do not poll `getInvoicePdf` to check status; poll `getInvoice`.

A browser cannot link to `getInvoicePdf`: it needs the `isk_` key. Serving a PDF to a signed-in
user means a route of your own that authenticates the session, calls this, and streams the bytes
back. For someone with no session, mint a link instead.

> **An individual download link cannot be revoked.** The TTL is exactly 7 days and is not
> configurable, there is no way to kill one link, and no way to shorten or extend one already
> minted. Revoking them all at once means an operator changing the service's signing key. Treat
> the URL as a bearer capability: send it to the customer, don't post it publicly, don't log it.

Mint on demand rather than storing the URL — a stored one stops working after a week.

A cancelled invoice is **not downloadable** through either path, even though the document still
exists at the provider. That surfaces as a named error rather than an opaque 4xx:

```ts
try {
  const pdf = await invoices.getInvoicePdf(id);
} catch (error) {
  if (error instanceof InvoiceNotDownloadableError) {
    return renderNoPdfNotice(error.invoiceStatus); // "cancelled", "failed", "pending" or null
  }
  throw error;
}
```

Mint the link *before* cancelling if the customer will still need it.

## `stornoNumber` exists on exactly one response

```ts
const cancelled = await invoices.cancelInvoice(id);
await store(id, { stornoNumber: cancelled.stornoNumber ?? null }); // now, or never
```

There is no column for it, so no read endpoint returns it — `Invoice` does not declare the
property at all, which makes `invoice.stornoNumber` on a value from `getInvoice` a **compile
error** rather than a detail page that renders nothing forever. Only `CancelledInvoice` has it.

An absent `stornoNumber` means the provider returned none; the cancel still succeeded. `status` is
what says whether the invoice was cancelled.

A cancel issues a real storno at the provider and is reported to NAV. It cannot be undone, and an
issued invoice can only be cancelled — never edited.

## Errors

`InvoiceApiError` carries `code`, `status`, `retryable`, the service's `details` and, where the
obvious retry is the one that cannot work, an `advice` sentence. Branch on `code`, never on
`message`.

Only `provider_error` (502) and `internal_error` (500) are retryable — and on a create, **not with
the same key**. A `500` there usually means the provider credential could not be resolved or
decrypted, which is a configuration problem backoff will not clear; a `502` means the provider was
reached and refused, and its own error text is in the message.

`code: "not_configured"` is the SDK's own, on a `status: 0` error, so a missing environment
variable can be translated through the same branch as a real `401`.

## What this service does not do

Assume none of these exist. The SDK exposes nothing for them.

- **No webhooks.** The service never calls you. Poll `getInvoice` if you need confirmation.
- **No rate limiting.** Be polite; batch and back off yourself.
- **No bulk endpoints.** One invoice per request.
- **No invoice modification.** Cancel only.
- **No partner persistence.** Names, addresses and tax numbers pass through to the provider and are
  never stored — which is also why `partnerRef` must stay non-identifying.
- **No admin tier here.** Client management, credentials, reconciliation, stats and the audit trail
  need an `iad_` key, which is a full-tenant credential and belongs to a back office.

## Licence

MIT.
