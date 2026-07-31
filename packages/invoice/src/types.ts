/**
 * Named aliases over the generated contract, and the request shapes the SDK narrows.
 *
 * @remarks
 * Response shapes are aliases of `src/generated/schema.ts`, never hand-copied, so a contract change
 * breaks the build rather than drifting quietly past it.
 *
 * The **request** shapes are hand-written, for one reason: the service defaults `paymentMethod`,
 * `currency`, `language`, `eInvoice`, `items[].unit` and `partner.address.country`, and the
 * generated type marks a defaulted property *required*. Aliasing it would force every caller to
 * supply six values the service is happy to choose. `test/type-safety.test.ts` asserts a populated
 * {@link CreateInvoiceInput} still satisfies the generated request type, so a renamed or retyped
 * field on the wire fails the type-check the same way an alias would.
 */

import type { IsoDate } from "./dates.js";
import type { components, operations } from "./generated/schema.js";

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
 * the replay path keeps returning it, so that key cannot be retried. `failed` is terminal *for that
 * idempotency key*, and `cancelled` is terminal outright. There is no `paid`: this service does not
 * track payment.
 */
export type InvoiceStatus = Schemas["InvoiceStatus"];

/**
 * An invoice, as **every read endpoint** returns it.
 *
 * @remarks
 * Note what is not here: `stornoNumber`. There is no column for it, so no read returns it — see
 * {@link CancelledInvoice}. Reading `invoice.stornoNumber` off this type is a compile error, which
 * is the whole point: on the wire it is simply absent, and a detail page renders nothing forever.
 *
 * `grossAmount` is a **major-unit number** (`38100` means 38 100 Ft) and is `null` until the status
 * is `created`. That is the opposite of `@lamido/payment`, where every amount is a decimal string of
 * *minor* units and HUF is zero-decimal. A value carried between the two packages without an
 * explicit conversion is wrong by a factor of 100, and neither package offers one.
 */
export type Invoice = Schemas["Invoice"];

/**
 * The result of a cancel, and the only place `stornoNumber` exists.
 *
 * @remarks
 * client-api §6 states the rule and then names the failure it causes: *"Rendering
 * `invoice.stornoNumber` on a detail page compiles, type-checks, and simply shows nothing forever."*
 * That is only true of an `Invoice` that declares the field. This one does, and {@link Invoice} does
 * not, so the mistake cannot compile.
 *
 * **Persist it when you receive it.** Recovering it afterwards means asking an operator to read
 * `metadata.stornoNumber` off the audit entry for the cancel.
 */
export interface CancelledInvoice extends Invoice {
  /**
   * The storno document's number, e.g. `"2026/0043"`.
   *
   * @remarks
   * Optional because the wire says so: the provider may not return one, and **the cancel still
   * succeeded**. An absent `stornoNumber` is not a failed storno — `status` is what says whether the
   * invoice was cancelled.
   */
  readonly stornoNumber?: string;
}

/** The buyer's postal address. */
export interface PartnerAddress {
  readonly postalCode: string;
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
 * name. The only buyer-side value stored is {@link CreateInvoiceInput.partnerRef}.
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
  readonly taxNumber?: string;
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
  /** **Net**, per unit. Negative is allowed, for a discount line. */
  readonly netUnitPrice: number;
  /**
   * A percentage as a **string** (`"27"`, `"5"`, `"0"`) or a code (`"AAM"`, `"TAM"`, `"EU"`).
   *
   * @remarks
   * Never a number and never with a `%`. The service does not check this — `"27%"` reaches the
   * provider and comes back as a `502` with the key already consumed — so the SDK validates it
   * before sending. A non-numeric code makes szamlazz's computed line VAT `0`.
   */
  readonly vatRate: string;
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
  readonly bankName?: string;
  readonly bankAccount?: string;
}

/**
 * What to issue an invoice with.
 *
 * @remarks
 * Four fields are required — `provider`, `providerConfigId`, `partner`, `items` — and everything else
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
  readonly providerConfigId: string;
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
  readonly paymentMethod?: string;
  /** Defaults to `"HUF"`. Passed through; the provider must support it. There is no conversion. */
  readonly currency?: string;
  /** The invoice's language, e.g. `"hu"`, `"en"`, `"de"`. Defaults to `"hu"`. */
  readonly language?: string;
  /** Defaults to today, UTC. */
  readonly issueDate?: IsoDate;
  /** Defaults to `issueDate`. */
  readonly fulfillmentDate?: IsoDate;
  /** Defaults to **today + 8 days** — relative to today, not to `issueDate`. */
  readonly dueDate?: IsoDate;
  /** `true` issues an electronic invoice and no paper. Defaults to `true`. */
  readonly eInvoice?: boolean;
  /** An invoice-level note. */
  readonly comment?: string;
  /**
   * Your own reference, stored verbatim — **the only buyer-side value this service keeps**.
   *
   * @remarks
   * Use an order id. Never a name, an email or a tax number: it is the one field that survives the
   * request, it is searchable by operators, and it lands in the audit trail. It is also the only way
   * to find an invoice again if the returned `id` is lost.
   */
  readonly partnerRef?: string;
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
 * There is deliberately **no `total`** on this type, because `GET /api/invoices` does not return
 * one. Reading `.total` is a compile error rather than `NaN` pages out of
 * `Math.ceil(total / limit)`. Paginate until a page returns fewer than `limit` rows, or use
 * `listAllInvoices`.
 */
export interface InvoiceList {
  readonly items: Invoice[];
  readonly limit: number;
  readonly offset: number;
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
 * Not wrapped in `data`, which is one of the service's three documented envelope exceptions: a
 * shared `unwrap(body.data)` applied here returns `undefined`. The degraded variant arrives with a
 * `503`, and is returned rather than thrown — see `getHealth`.
 */
export type InvoiceHealth =
  | operations["getHealth"]["responses"][200]["content"]["application/json"]
  | operations["getHealth"]["responses"][503]["content"]["application/json"];
