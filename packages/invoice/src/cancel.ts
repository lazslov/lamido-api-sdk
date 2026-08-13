/**
 * `POST /v1/invoices/:id/cancel` — the storno, and the one response that carries `stornoNumber`.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, invoicePath, passInit, type RequestOptions } from "./call.js";
import type { CancelledInvoice } from "./types.js";

/** The cancel half of a client. */
export interface CancelMethods {
  /**
   * Cancel an invoice, issuing a real storno document at the provider.
   *
   * @param id - The invoice's `id`. Only a `created` invoice can be cancelled.
   * @param options - `init` only. This endpoint takes no body.
   * @returns The invoice as `cancelled`, **plus `stornoNumber`**.
   * @throws {@link ./errors.js | InvoiceApiError}. A `400` means the invoice was not `created` —
   * already cancelled, failed, or still pending — and the state check runs *before* any provider call,
   * so nothing was contacted and nothing changed. A `502` always means the provider was reached and
   * refused, e.g. because it was already stornoed on their side.
   * @remarks
   * **This is a financial action reported to NAV and it cannot be undone.** `cancelled` is terminal.
   *
   * `stornoNumber` is returned **here and nowhere else** — there is no column for it, so a later
   * `getInvoice` never includes it however the invoice was cancelled. Persist it now. If it is lost, an
   * operator can recover it from the audit trail, which records this call with your client as the
   * actor and your caller IP alongside it.
   *
   * The property is declared on {@link ./types.js | CancelledInvoice} and **not** on `Invoice`, so
   * reading it off a value from any other endpoint does not compile. That is the point: the documented
   * failure is a detail page rendering nothing forever, and it type-checks perfectly.
   *
   * An absent `stornoNumber` means the provider returned none; the cancel still succeeded.
   *
   * @example
   * ```ts
   * const cancelled = await invoices.cancelInvoice(invoiceId);
   * await store(invoiceId, { stornoNumber: cancelled.stornoNumber ?? null });   // now, or never
   * ```
   */
  cancelInvoice(id: string, options?: RequestOptions): Promise<CancelledInvoice>;
}

/**
 * Bind the cancel method to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCancelMethod(cfg: ResolvedConfig): CancelMethods {
  return {
    cancelInvoice: (id, options = {}) =>
      call<CancelledInvoice>(cfg, {
        method: "POST",
        path: `${invoicePath(id)}/cancel`,
        // No body: the service neither requires nor reads one, and sending `{}` would add a
        // Content-Type header to a request that has nothing to declare.
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
