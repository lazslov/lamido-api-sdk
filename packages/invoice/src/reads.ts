/**
 * `GET /api/invoices` and `GET /api/invoices/:id` — the two reads.
 *
 * @remarks
 * The list is the endpoint that forced `@lazslov/api-core`'s paginator to handle a list with **no
 * `total`**, and the get is the polling endpoint, because this service has no webhooks.
 */

import { type CollectAllOptions, collectAll, type ResolvedConfig } from "@lazslov/api-core";
import { call, invoicePath, passInit, type RequestOptions } from "./call.js";
import type { Invoice, InvoiceList, InvoiceStatus, Provider } from "./types.js";

/** Which invoices to list, and how many. */
export interface ListInvoicesOptions extends RequestOptions {
  readonly status?: InvoiceStatus;
  readonly provider?: Provider;
  /** 1–100, default 20. Out of range is a `400 validation_error`, never a clamp. */
  readonly limit?: number;
  /** ≥ 0, default 0. */
  readonly offset?: number;
}

/**
 * Which invoices to collect.
 *
 * @remarks
 * The filters, minus `limit` and `offset` — those are the paginator's. `pageSize` and `maxPages` come
 * from core's {@link CollectAllOptions}; raising `maxPages` is how a tenant with more than
 * `pageSize × maxPages` invoices gets past the loop breaker, which throws rather than truncating.
 */
export interface ListAllInvoicesOptions
  extends Omit<ListInvoicesOptions, "limit" | "offset">,
    CollectAllOptions {}

/** The read half of a client. */
export interface ReadMethods {
  /**
   * List this client's invoices, newest first.
   *
   * @param options - Filters, page window and `init`.
   * @returns One page: the rows, and the `limit` and `offset` the service echoed.
   * @throws {@link ./errors.js | InvoiceApiError}.
   * @remarks
   * **There is no `total`,** and the returned type does not declare one — so
   * `Math.ceil(list.total / limit)` is a compile error rather than `NaN` pages. Paginate until a page
   * returns fewer than `limit` rows, or use {@link ReadMethods.listAllInvoices}.
   *
   * This tier has no date filter and no free-text search; both exist only on the admin tier. And
   * because partner data is never stored, there is no way to find an invoice by customer name —
   * `partnerRef` is the handle.
   *
   * @example
   * ```ts
   * const page = await invoices.listInvoices({ status: "failed", limit: 50 });
   * const done = page.items.length < 50;   // the only end-of-list signal there is
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
   * Wraps core's `collectAll`, which stops on a short page because there is no `total` to follow. The
   * service does no rate limiting of its own, so this is polite by page size rather than by delay: be
   * conservative about calling it on a hot path.
   */
  listAllInvoices(options?: ListAllInvoicesOptions): Promise<Invoice[]>;

  /**
   * Read one invoice.
   *
   * @param id - The `id` this service returned from the create. Not the invoice number.
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
   * `stornoNumber` is not on the result and cannot be: {@link ./types.js | Invoice} does not declare
   * it, so the silent-blank-field mistake does not compile.
   */
  getInvoice(id: string, options?: RequestOptions): Promise<Invoice>;
}

/** The envelope the list answers with: `data` plus the two pagination siblings, and no `total`. */
interface ListEnvelope {
  readonly data: Invoice[];
  readonly limit: number;
  readonly offset: number;
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
      path: "/api/invoices",
      query: {
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.offset === undefined ? {} : { offset: options.offset }),
      },
      // The envelope, not `data`: `limit` and `offset` are the only pagination signal there is.
      read: { kind: "envelope" },
      ...passInit(options),
    });

    // Renamed to `items` so the shape satisfies core's `collectAll` with no adapter — and `total` is
    // absent rather than `undefined`, which is what makes reading it a type error.
    return { items: envelope.data, limit: envelope.limit, offset: envelope.offset };
  }

  return {
    listInvoices,

    listAllInvoices: ({ pageSize, maxPages, ...filters }: ListAllInvoicesOptions = {}) =>
      collectAll(({ limit, offset }) => listInvoices({ ...filters, limit, offset }), {
        ...(pageSize === undefined ? {} : { pageSize }),
        ...(maxPages === undefined ? {} : { maxPages }),
      }),

    getInvoice: (id, options = {}) =>
      call<Invoice>(cfg, {
        method: "GET",
        path: invoicePath(id),
        read: { kind: "data" },
        ...passInit(options),
      }),
  };
}
