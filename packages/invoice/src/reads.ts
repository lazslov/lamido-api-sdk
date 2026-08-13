/**
 * `GET /v1/invoices` and `GET /v1/invoices/:id` — the two reads.
 *
 * @remarks
 * The list is the endpoint that forced `@lazslov/api-core`'s paginator to handle a list with **no
 * `total`**, and the get is the polling endpoint, because this service has no webhooks.
 */

import { type CollectAllOptions, collectAllCursor, type ResolvedConfig } from "@lazslov/api-core";
import { call, invoicePath, passInit, type RequestOptions } from "./call.js";
import type { Invoice, InvoiceList, InvoiceStatus, Provider } from "./types.js";

/** Which invoices to list, and how many. */
export interface ListInvoicesOptions extends RequestOptions {
  readonly status?: InvoiceStatus;
  readonly provider?: Provider;
  /** 1–200, default 50. Out of range is a `400 validation`, never a clamp. */
  readonly limit?: number;
  /** An opaque cursor from a previous page's `nextCursor`. Never construct one. */
  readonly cursor?: string;
}

/**
 * Which invoices to collect.
 *
 * @remarks
 * The filters, minus `limit` and `cursor` — those are the paginator's. `pageSize` and `maxPages` come
 * from core's {@link CollectAllOptions}; raising `maxPages` is how a tenant with more than
 * `pageSize × maxPages` invoices gets past the loop breaker, which throws rather than truncating.
 */
export interface ListAllInvoicesOptions
  extends Omit<ListInvoicesOptions, "limit" | "cursor">,
    CollectAllOptions {}

/** The read half of a client. */
export interface ReadMethods {
  /**
   * List this client's invoices, newest first.
   *
   * @param options - Filters, page window and `init`.
   * @returns One page: the rows, and the cursor for the next one.
   * @throws {@link ./errors.js | InvoiceApiError}.
   * @remarks
   * **There is no `total`,** and the returned type does not declare one — so
   * `Math.ceil(list.total / limit)` is a compile error rather than `NaN` pages.
   *
   * **Follow `nextCursor`, never a short page.** A filtered keyset page can come back under
   * `limit` with more behind it, so "fewer rows than I asked for" is not the end of the list. Use
   * {@link ReadMethods.listAllInvoices} to walk it.
   *
   * This tier has no date filter and no free-text search; both exist only on the admin tier. And
   * because partner data is never stored, there is no way to find an invoice by customer name —
   * `partner_ref` is the handle.
   *
   * @example
   * ```ts
   * const page = await invoices.listInvoices({ status: "failed", limit: 50 });
   * const done = page.nextCursor === null;   // the only end-of-list signal there is
   * ```
   */
  listInvoices(options?: ListInvoicesOptions): Promise<InvoiceList>;

  /**
   * Follow the list to the end.
   *
   * @param options - Filters, page size, loop breaker and `init`.
   * @returns Every matching invoice, newest first.
   * @throws `Error` when `maxPages` is reached — deliberately, rather than returning a short list.
   * @remarks
   * Wraps core's `collectAllCursor`, which stops when the cursor comes back `null`. The
   * service does no rate limiting of its own, so this is polite by page size rather than by delay: be
   * conservative about calling it on a hot path.
   */
  listAllInvoices(options?: ListAllInvoicesOptions): Promise<Invoice[]>;

  /**
   * Read one invoice.
   *
   * @param id - The `public_id` this service returned from the create. Not the invoice number.
   * @param options - `init` only.
   * @throws {@link ./errors.js | InvoiceApiError} on a `404` — **never `null`**. An invoice belonging
   * to another client answers `404` too: non-existence and no-access are deliberately
   * indistinguishable, so a `404` on an id you hold is a bug, and quite often the bug is a deployment
   * holding the wrong `INVOICE_SERVICE_CLIENT_KEY`.
   * @remarks
   * **This is the polling endpoint.** The service never calls you — there are no webhooks — so
   * confirming that a `pending` invoice became `created` means asking. Do not poll `getInvoicePdf` for
   * that: it hits the provider on every call.
   *
   * `storno_number` is not on the result and cannot be: {@link ./types.js | Invoice} does not declare
   * it, so the silent-blank-field mistake does not compile.
   */
  getInvoice(id: string, options?: RequestOptions): Promise<Invoice>;
}

/** The envelope the list answers with: `data` plus the keyset cursor, and no `total`. */
interface ListEnvelope {
  readonly data: Invoice[];
  readonly next_cursor: string | null;
}

/**
 * Bind the read methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindReadMethods(cfg: ResolvedConfig): ReadMethods {
  async function listInvoices(options: ListInvoicesOptions = {}): Promise<InvoiceList> {
    const envelope = await call<ListEnvelope>(cfg, {
      method: "GET",
      path: "/v1/invoices",
      query: {
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      // The envelope, not `data`: `next_cursor` is the only end-of-list signal there is.
      read: { kind: "envelope" },
      ...passInit(options),
    });

    // Renamed to `items` so the shape satisfies core's `collectAllCursor` with no adapter — and
    // `total` is absent rather than `undefined`, which is what makes reading it a type error.
    return { items: envelope.data, nextCursor: envelope.next_cursor };
  }

  return {
    listInvoices,

    listAllInvoices: ({ pageSize, maxPages, ...filters }: ListAllInvoicesOptions = {}) =>
      collectAllCursor(({ limit, cursor }) => listInvoices({ ...filters, limit, cursor }), {
        ...(pageSize === undefined ? {} : { pageSize }),
        ...(maxPages === undefined ? {} : { maxPages }),
      }),

    getInvoice: (id, options = {}) =>
      call<Invoice>(cfg, {
        method: "GET",
        path: invoicePath(id),
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
