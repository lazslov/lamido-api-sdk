/**
 * `@lamido/invoice` — consumer SDK for invoice-service's client tier.
 *
 * @remarks
 * A small surface with unusually sharp edges. Three things it makes hard on purpose:
 *
 * - **An idempotency key is consumed on first use, whatever the outcome.** A failed create returns that
 *   same failure forever under the same key, so {@link CreateInvoiceResult.replayed} is derived from the
 *   status code and the error carries the new-key rule in words. This is the **opposite** of
 *   `@lamido/payment`, where a same-key retry after an unreachable PSP is the only safe move.
 * - **`stornoNumber` cannot be read off an invoice.** Only `cancelInvoice` returns it, and only
 *   {@link CancelledInvoice} declares it — so the documented silent failure, a detail page rendering
 *   nothing forever, is a compile error instead.
 * - **Four things the service forwards rather than checks are checked here.** Dates are branded
 *   {@link IsoDate}, VAT rates and `providerConfigId` are validated locally, and `items` must be
 *   non-empty — because each of those otherwise comes back as a `502` with the key already spent.
 *
 * Money here is a **major-unit number**: `grossAmount: 38100` means 38 100 Ft, and it is `null` until
 * the invoice is `created`. `@lamido/payment` uses a decimal string of *minor* units. Neither package
 * converts between them; if a site needs to invoice a payment, that conversion is written in the site,
 * visibly, once.
 *
 * This package must never reach a browser bundle: an `isk_` key can read every invoice of its tenant and
 * issue real stornos, and no CORS headers are served on any route, so a browser call fails opaquely
 * *after* the key is public.
 *
 * There are **no webhooks** — the service never calls you — so there is no verifier and no route handler
 * here. Poll `getInvoice` if you need confirmation. Also absent, because the service has none: rate
 * limiting (be polite, batch and back off yourself), bulk endpoints (one invoice per request), invoice
 * modification (cancel only, never edit), and any search by customer name (partner data is not stored).
 *
 * The admin tier (`iad_`) is out of scope: it is operator-only, and it is the half that can read every
 * client, accept plaintext provider secrets and issue stornos across tenants.
 *
 * @example
 * ```ts
 * import "server-only";
 * import { createInvoiceClient, isoDate } from "@lamido/invoice";
 * import { derivedIdempotencyKey } from "@lamido/api-core";
 *
 * const invoices = createInvoiceClient();
 *
 * const { invoice, replayed } = await invoices.createInvoice(
 *   {
 *     provider: "billingo",
 *     providerConfigId: "billingo_acme",
 *     partner: {
 *       name: "Teszt Vevő Kft",
 *       taxNumber: "12345678-2-42",
 *       address: { postalCode: "1011", city: "Budapest", address: "Fő utca 1" },
 *     },
 *     items: [{ name: "Tanácsadás", quantity: 1, netUnitPrice: 15000, vatRate: "27" }],
 *     dueDate: isoDate("2026-08-02"),
 *     partnerRef: order.id,
 *   },
 *   derivedIdempotencyKey(`invoice-${order.id}`, 1),
 * );
 *
 * if (!replayed) await store(order.id, invoice.id);
 * ```
 */

export type { InvoiceRequest, RequestOptions } from "./call.js";
export type { CancelMethods } from "./cancel.js";
export { createInvoiceClient, type InvoiceClient, tryCreateInvoiceClient } from "./client.js";
export type { CreateMethods } from "./create.js";
export { type IsoDate, isoDate } from "./dates.js";
export type { DocumentMethods } from "./documents.js";
export {
  InvoiceApiError,
  type InvoiceErrorCode,
  InvoiceNotDownloadableError,
  type InvoiceValidationDetails,
} from "./errors.js";
export type { HealthMethods } from "./health.js";
export type { ListAllInvoicesOptions, ListInvoicesOptions, ReadMethods } from "./reads.js";
export type {
  CancelledInvoice,
  CreateInvoiceInput,
  CreateInvoiceResult,
  DownloadLink,
  Invoice,
  InvoiceHealth,
  InvoiceItem,
  InvoiceItems,
  InvoiceList,
  InvoicePdf,
  InvoiceSeller,
  InvoiceStatus,
  Partner,
  PartnerAddress,
  Provider,
} from "./types.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that disagrees with
 * the tarball it came from.
 */
export const VERSION = "0.1.0";
