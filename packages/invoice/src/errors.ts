/**
 * invoice-service's problem document, narrowed to what this package's callers branch on.
 *
 * @remarks
 * The parse is `@lazslov/api-core`'s: the three services share one RFC 9457 document over one
 * closed slug set. What this module adds is the advice a caller cannot derive from the status,
 * because the naive reading of it is wrong in a way that costs an idempotency key:
 *
 * - a **502** on a create means the invoice row was written as `failed` and the key is spent, so
 *   the correct retry uses a **new** key — the opposite of `@lazslov/payment`, where a same-key
 *   retry after an unreachable PSP is the only safe move;
 * - a **500** on a create is usually a credential that could not be resolved or decrypted, which
 *   is a configuration problem rather than a transient one, and backoff will never clear it.
 */

import { type ErrorContext, LamidoApiError, readProblem } from "@lazslov/api-core";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "invoice-service";

/**
 * The semantic sub-cases invoice-service names in the problem's `code` member.
 *
 * @remarks
 * Present where a `(type, status)` pair alone cannot identify the failure — every `422` is
 * `conflict`, so only `code` says whether an invoice was un-downloadable or un-cancellable.
 * **Branch on this rather than on the message.**
 */
export type InvoiceProblemCode =
  | "idempotency_key_required"
  | "idempotency_key_reused"
  | "idempotency_key_in_flight"
  | "provider_config_mismatch"
  | "client_has_invoices"
  | "self_deactivation"
  | "self_revocation"
  | "not_downloadable"
  | "not_cancellable"
  | "not_reconcilable"
  | "invoice_state_changed"
  | "missing_path_param";

/**
 * A non-2xx answer from invoice-service.
 *
 * @remarks
 * Carries no credential, no host and no request body — see `@lazslov/api-core`'s `LamidoApiError`.
 *
 * @example
 * ```ts
 * try {
 *   const { invoice } = await invoices.createInvoice(body, derivedIdempotencyKey(orderId, attempt));
 *   await store(invoice.public_id);
 * } catch (error) {
 *   if (!(error instanceof InvoiceApiError)) throw error;
 *   // retryable, but never under the same key — see `advice`.
 *   if (error.retryable) return retryWith(derivedIdempotencyKey(orderId, attempt + 1));
 *   throw error;
 * }
 * ```
 */
export class InvoiceApiError extends LamidoApiError {
  declare readonly code?: InvoiceProblemCode;

  /**
   * The provider's own error text, when one reached us.
   *
   * @remarks
   * Present on a `502`, where the failure is szamlazz's or Billingo's rather than ours. Read it
   * before retrying: nothing on this side changed.
   */
  declare readonly providerError?: string;

  /**
   * What this SDK has to add about what to do next.
   *
   * @remarks
   * Present on a create's `500` and `502`, where the retry that looks obvious is the one that
   * cannot work. Prose, for a human; the machine-readable part is `retryable`. Also folded into
   * `message`, so an error that is only ever logged still says it.
   */
  declare readonly advice?: string;

  constructor(
    init: ConstructorParameters<typeof LamidoApiError>[0] & {
      readonly advice?: string;
      readonly providerError?: string;
    },
  ) {
    super({
      ...init,
      message: init.advice ? `${init.message} — ${init.advice}` : init.message,
    });
    this.name = "InvoiceApiError";
    if (init.advice !== undefined) this.advice = init.advice;
    if (init.providerError !== undefined) this.providerError = init.providerError;
  }
}

/**
 * The invoice is not in a state this document can be produced from.
 *
 * @remarks
 * A `422 conflict` with `code: "not_downloadable"` on `GET …/pdf` or `GET …/download-link`. Named
 * rather than left as an opaque 4xx because the common case is not a bug in the request at all:
 * **a cancelled invoice is no longer downloadable here**, even though the document still exists at
 * the provider. Mint the link *before* cancelling.
 *
 * A `pending` or `failed` invoice reaches the same error, and there the answer is different —
 * wait, or reissue under a new key. It is `retryable` for exactly that reason: `422` means the
 * state forbids it *for now*, and a state can change.
 *
 * @example
 * ```ts
 * try {
 *   const pdf = await invoices.getInvoicePdf(id);
 *   return send(pdf.bytes, pdf.filename);
 * } catch (error) {
 *   if (error instanceof InvoiceNotDownloadableError) return renderNoPdfNotice();
 *   throw error;
 * }
 * ```
 */
export class InvoiceNotDownloadableError extends InvoiceApiError {
  constructor(init: ConstructorParameters<typeof InvoiceApiError>[0]) {
    super(init);
    this.name = "InvoiceNotDownloadableError";
  }
}

/** The create path, and the only place the key-consumption rule applies. */
const createPath = "/v1/invoices";

/**
 * The rule that separates this service from payment-service, in one sentence.
 *
 * @remarks
 * conventions §9 and the CRITICAL in client-api §1: on the provider path the row is written as
 * `failed` before the failure is reported, so the key is consumed. A same-key retry then returns
 * that failed invoice forever while looking like a transient problem.
 */
const newKeyAdvice =
  "The Idempotency-Key is now consumed and the invoice was stored as failed. Retrying with the same key returns that failed invoice forever — derive a NEW key (attempt + 1) and send again.";

/** A 500 on a create is a configuration problem far more often than a transient one. */
const credentialAdvice =
  "On a create this usually means the provider credential could not be resolved or decrypted rather than a transient fault, and backoff will not clear it: ask an operator to run the admin credential test for this provider_config_id. The key is consumed either way, so retry under a NEW key once it passes.";

/** A 502 outside a create reached the provider and was refused; nothing here changed. */
const providerRefusedAdvice =
  "The provider was reached and refused. `providerError` carries their own text — read it before retrying, because nothing on this side changed.";

/**
 * Read the service's problem document.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status.
 * Typed as returning the narrow error rather than as core's `ErrorParser`, which it still
 * satisfies.
 */
export const parseInvoiceError = (context: ErrorContext): InvoiceApiError => {
  const init = readProblem(serviceName, context);
  const providerError = providerErrorOf(context.body);

  const full = {
    ...init,
    ...advice(context.status, context.requestPath),
    ...(providerError === undefined ? {} : { providerError }),
  };

  // Decided from the service's own `code`, not from the message. The old parser read the status
  // out of prose with a regex — the service now names the sub-case machine-readably, so it does
  // not have to.
  return init.code === "not_downloadable"
    ? new InvoiceNotDownloadableError(full)
    : new InvoiceApiError(full);
};

/** The `provider_error` extension, when the service sent one. */
function providerErrorOf(body: unknown): string | undefined {
  const value = (body as { provider_error?: unknown } | null)?.provider_error;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The note this SDK attaches, where the obvious retry is the one that cannot work. */
function advice(status: number, requestPath: string): { advice?: string } {
  const creating = requestPath === createPath;
  if (status === 502) return { advice: creating ? newKeyAdvice : providerRefusedAdvice };
  if (status === 500 && creating) return { advice: credentialAdvice };
  return {};
}
