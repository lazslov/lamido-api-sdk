/**
 * Named aliases over the generated contract, and the request shapes the SDK narrows.
 *
 * @remarks
 * Response shapes are aliases of `src/generated/schema.ts`, never hand-copied, so a contract change
 * breaks the build rather than drifting quietly past it.
 *
 * The **request** shapes are hand-written, for one reason: the service defaults `payment_method`,
 * `currency`, `language`, `e_invoice`, `items[].unit` and `partner.address.country`, and the
 * generated type marks a defaulted property *required*. Aliasing it would force every caller to
 * supply six values the service is happy to choose. `test/type-safety.test.ts` asserts a populated
 * {@link CreateInvoiceInput} still satisfies the generated request type, so a renamed or retyped
 * field on the wire fails the type-check the same way an alias would.
 */

import type { IsoDate } from "./dates.js";
import type { components } from "./generated/schema.js";

/** @internal Shorthand for the generated component schemas. */
type Schemas = components["schemas"];

/** Which provider issued, or is to issue, the invoice. */
export type Provider = Schemas["Provider"];

/**
 * Where an invoice is in its lifecycle.
 *
 * @remarks
 * `pending` is normally invisible — it exists only for the second the provider call takes. A row
 * still `pending` minutes later means the process died mid-call and an operator must reconcile it;
 * the replay path keeps returning it, so that key cannot be retried.  `failed` is terminal *for that
 * idempotency key*, and `canceled` is terminal outright. There is no `paid`: this service does not
 * track payment.
 */
export type InvoiceStatus = Schemas["InvoiceStatus"];

/**
 * An invoice, as **every read endpoint** returns it.
 *
 * @remarks
 * Note what is not here: `storno_number`. There is no column for it, so no read returns it — see
 * {@link CancelledInvoice}. Reading `invoice.storno_number` off this type is a compile error, which
 * is the whole point: on the wire it is simply absent, and a detail page renders nothing forever.
 *
 * Identity is `public_id`, a UUIDv7. The internal primary key never appears.
 *
 * **`gross_amount_minor` is a decimal string of minor units**, and it is `null` until the status is
 * `created`. It replaces the old major-unit `grossAmount` number, so a value read into an existing
 * total is now wrong by a factor of 100 *for every currency but HUF* — and HUF is zero-decimal in
 * this API by deliberate estate-wide choice, so `"1000"` HUF is 1000 Ft. This finally agrees with
 * `@lazslov/payment`, which has always used minor units; the two packages no longer disagree.
 */
export type Invoice = Schemas["Invoice"];

/**
 * The result of a cancel, and the only place `storno_number` exists.
 *
 * @remarks
 * client-api §6 states the rule and then names the failure it causes: *"Rendering
 * `invoice.storno_number` on a detail page compiles, type-checks, and simply shows nothing
 * forever."* That is only true of an `Invoice` that declares the field. This one does, and
 * {@link Invoice} does not, so the mistake cannot compile.
 *
 * **Persist it when you receive it.** Recovering it afterwards means asking an operator to read
 * `metadata.storno_number` off the audit entry for the cancel.
 *
 * The wire schema spells this `CanceledInvoice`, with the status `canceled`; the SDK keeps the
 * British spelling on its own export because renaming a caught type buys nothing.
 */
export type CancelledInvoice = Schemas["CanceledInvoice"];

/** The buyer's postal address. */
export interface PartnerAddress {
  readonly postal_code: string;
  readonly city: string;
  /** Street and number, on one line. */
  readonly address: string;
  /**
   * Defaults to `"Magyarország"`, and is then **ignored**.
   *
   * @remarks
   * Both provider adapters hardcode Hungary — Billingo sends `country_code: "HU"`, szamlazz sends no
   * country at all — so a foreign address cannot be invoiced through this API whatever is put here.
   * The field exists because the service accepts it; setting it changes nothing.
   */
  readonly country?: string;
}

/**
 * The buyer.
 *
 * @remarks
 * **Not persisted.** Names, tax numbers, emails and addresses pass through to the provider and are
 * never written to the service's database, which is also why invoices cannot be searched by customer
 * name. The only buyer-side value stored is {@link CreateInvoiceInput.partner_ref}.
 */
export interface Partner {
  readonly name: string;
  /**
   * Hungarian format, e.g. `"12345678-2-42"`.
   *
   * @remarks
   * Optional to the service and effectively required in practice for a company buyer — the provider
   * enforces it, not this service. Send it: Billingo reuses a partner record matching on name and
   * tax code, so **two buyers with the same name and no tax number collapse onto one partner**.
   */
  readonly tax_number?: string;
  /** Where the provider sends the e-invoice. Must be a valid address if present. */
  readonly email?: string;
  readonly address: PartnerAddress;
}

/** One invoice line. */
export interface InvoiceItem {
  readonly name: string;
  /** Greater than zero. Fractions are allowed. */
  readonly quantity: number;
  /** Free text — `"óra"`, `"db"`, `"hó"`. Defaults to `"db"`. */
  readonly unit?: string;
  /**
   * **Net**, per unit, as a decimal string of **minor units**: `^[1-9][0-9]*$`.
   *
   * @remarks
   * `"38100"` is 38 100 Ft, because HUF is zero-decimal in this API. For EUR or USD it is cents,
   * so `"1250"` is €12.50.
   *
   * A string rather than a number because **a JSON number loses precision above 2^53**, which a
   * yearly HUF total reaches. Digits only: no sign, no decimal point, no exponent, no leading
   * zero.
   *
   * **`"0"` and negatives are rejected**, so a discount line can no longer be a negative amount —
   * that changed with the money model. This replaced a major-unit `netUnitPrice` number, so
   * passing the old value unchanged under-charges by a factor of 100 on every two-decimal
   * currency. The SDK checks the shape before sending.
   */
  readonly net_unit_price_minor: string;
  /**
   * A percentage as a **string** (`"27"`, `"5"`, `"0"`) or a code (`"AAM"`, `"TAM"`, `"EU"`).
   *
   * @remarks
   * Never a number and never with a `%`. The service does not check this — `"27%"` reaches the
   * provider and comes back as a `502` with the key already consumed — so the SDK validates it
   * before sending. A non-numeric code makes szamlazz's computed line VAT `0`.
   */
  readonly vat_rate: string;
  /** A note on this line. */
  readonly comment?: string;
}

/**
 * At least one line, enforced by the type.
 *
 * @remarks
 * `items` must be non-empty, and the service says so with
 * `fieldErrors.items: ["Array must contain at least 1 element(s)"]` after a round trip. A tuple says
 * it at the call site instead. There is a runtime check too, for a JavaScript caller.
 */
export type InvoiceItems = readonly [InvoiceItem, ...InvoiceItem[]];

/** Bank details for the invoice. szamlazz only — Billingo uses its own configured account. */
export interface InvoiceSeller {
  readonly bank_name?: string;
  readonly bank_account?: string;
}

/**
 * What to issue an invoice with.
 *
 * @remarks
 * Four fields are required — `provider`, `provider_config_id`, `partner`, `items` — and everything else
 * has a service-side default, documented per field.
 *
 * The date fields are {@link IsoDate} rather than `string`, so a mistyped date is a compile error
 * instead of a `502` that has already consumed the idempotency key.
 */
export interface CreateInvoiceInput {
  /** Which provider issues it. */
  readonly provider: Provider;
  /**
   * Which stored credential issues it, e.g. `"billingo_acme"`.
   *
   * @remarks
   * Must match `^[a-z0-9_]+$`, be at most 64 characters, **and start with `<provider>_`**. It must
   * also be in the client's allow-list, which only an operator can change — that half cannot be
   * checked locally and is a `403`. The rest is a pure string rule, so the SDK checks it and names
   * the rule rather than letting the service answer `400 bad_request`.
   */
  readonly provider_config_id: string;
  readonly partner: Partner;
  readonly items: InvoiceItems;
  readonly seller?: InvoiceSeller;
  /**
   * Defaults to `"átutalás"`.
   *
   * @remarks
   * szamlazz receives it verbatim. Billingo needs its own enum and the service translates
   * case-insensitively — `átutalás`/`transfer`/`wire_transfer`, `készpénz`/`cash`,
   * `bankkártya`/`card`/`bankcard`. **Anything else passes through unchanged** and is likely a `502`
   * from Billingo, so this is not a free-text field when the provider is Billingo.
   */
  readonly payment_method?: string;
  /** Defaults to `"HUF"`. Passed through; the provider must support it. There is no conversion. */
  readonly currency?: string;
  /** The invoice's language, e.g. `"hu"`, `"en"`, `"de"`. Defaults to `"hu"`. */
  readonly language?: string;
  /** Defaults to today, UTC. */
  readonly issue_date?: IsoDate;
  /** Defaults to `issue_date`. */
  readonly fulfillment_date?: IsoDate;
  /** Defaults to **today + 8 days** — relative to today, not to `issue_date`. */
  readonly due_date?: IsoDate;
  /** `true` issues an electronic invoice and no paper. Defaults to `true`. */
  readonly e_invoice?: boolean;
  /** An invoice-level note. */
  readonly comment?: string;
  /**
   * Your own reference, stored verbatim — **the only buyer-side value this service keeps**.
   *
   * @remarks
   * Use an order id. Never a name, an email or a tax number: it is the one field that survives the
   * request, it is searchable by operators, and it lands in the audit trail. It is also the only way
   * to find an invoice again if the returned `public_id` is lost.
   */
  readonly partner_ref?: string;
}

/**
 * A created invoice, and whether this call created it.
 *
 * @remarks
 * Derived from the **status code**, which is what client-api §1 says to branch on: `201` issued
 * something, `200` did not.
 */
export interface CreateInvoiceResult {
  readonly invoice: Invoice;
  /**
   * `false` = `201`, an invoice was just issued. `true` = `200`, this key was already used.
   *
   * @remarks
   * A replay returns the stored row **as it is**, including a `failed` or `pending` one, and does not
   * call the provider. So `replayed: true` with `invoice.status === "failed"` is not a transient
   * problem that backoff will fix: that key is spent and will answer with the same failure forever.
   * **A replay of a failed invoice needs a new key, not another attempt.**
   */
  readonly replayed: boolean;
}

/**
 * One page of invoices.
 *
 * @remarks
 * Keyset-paged. There is deliberately **no `total`**, because `GET /v1/invoices` does not return
 * one — counting a filtered, unbounded table on every page is not cheap. Reading `.total` is a
 * compile error rather than `NaN` pages out of `Math.ceil(total / limit)`.
 *
 * **`nextCursor` is the only terminator.** A short page is not the last one: a filtered keyset
 * page can come back under `limit` with more behind it. Follow the cursor, or use
 * `listAllInvoices`.
 */
export interface InvoiceList {
  readonly items: Invoice[];
  /** The next cursor, or `null` on the last page. Opaque — pass it back verbatim. */
  readonly nextCursor: string | null;
}

/** A minted public download link. */
export type DownloadLink = Schemas["DownloadLink"];

/** A PDF, as the service streamed it. */
export interface InvoicePdf {
  readonly bytes: ArrayBuffer;
  /**
   * From the response's `Content-Disposition` — the invoice number for szamlazz, the document id for
   * Billingo — reduced to a bare filename, or `invoice-<id>.pdf` when the header carried none.
   */
  readonly filename: string;
}

/**
 * The public health body.
 *
 * @remarks
 * Not wrapped in `data` — one of the service's documented envelope exceptions, so a shared
 * `unwrap(body.data)` applied here returns `undefined`.
 *
 * **Both the healthy and the degraded body arrive at `200`.** The route no longer answers `503`
 * for an unreachable database, so `status` is the only thing that reports it.
 */
export type InvoiceHealth = Schemas["Healthz"];
