/**
 * How this package reaches the service.
 *
 * @remarks
 * One door out, through `@lamido/api-core`'s `request`, with this package's error parser bound to it.
 * Two shapes: the plain one, and the one that keeps the status because an idempotent create's *status
 * is* its contract.
 */

import { type RequestSpec, type ResolvedConfig, request } from "@lamido/api-core";
import { parseInvoiceError } from "./errors.js";

/** A request minus the error parser, which is always this package's. */
export type InvoiceRequest = Omit<RequestSpec, "onError">;

/** Options every endpoint accepts. */
export interface RequestOptions {
  /**
   * Passed through to `fetch` intact — `{ signal }` for a deadline, and nothing else in practice.
   *
   * @remarks
   * The SDK sets no timeout of its own. Be careful what a deadline means on `createInvoice`: aborting
   * the request does not stop the provider call it may already have started, so the outcome is
   * unknown — and unlike payment-service, the right move here is **not** to retry the same key. Read
   * the invoice back (or search by `partnerRef`) before deciding.
   *
   * **`mode` is never set here.** invoice-service's *admin* tier rejects a request carrying
   * `Sec-Fetch-Mode: cors`, and the documented workaround is `mode: "same-origin"` — but v1 does not
   * cover the admin tier, the client tier has no such tripwire, and content-service's own docs warn
   * integrators not to copy that workaround across. So this package sets none.
   */
  readonly init?: RequestInit;
}

/**
 * Make a request, throwing an {@link ./errors.js | InvoiceApiError} for any non-2xx.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 */
export function call<T>(cfg: ResolvedConfig, spec: InvoiceRequest): Promise<T> {
  return request<T>(cfg, { ...spec, onError: parseInvoiceError });
}

/**
 * Make a request and keep the status and headers.
 *
 * @remarks
 * Used by the create, whose `201`-versus-`200` is the whole idempotency contract, and by the PDF read,
 * whose filename lives in a response header.
 */
export function callWithMeta<T>(cfg: ResolvedConfig, spec: InvoiceRequest) {
  return request<T>(cfg, {
    ...spec,
    read: { ...spec.read, withMeta: true },
    onError: parseInvoiceError,
  });
}

/** Forward a caller's `init` without introducing an `init: undefined` key. */
export function passInit(options: RequestOptions): { init?: RequestInit } {
  return options.init ? { init: options.init } : {};
}

/** One invoice's path, with the id encoded. */
export function invoicePath(id: string): string {
  return `/api/invoices/${encodeURIComponent(id)}`;
}
