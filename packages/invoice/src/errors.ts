/**
 * invoice-service's error envelope, translated once.
 *
 * @remarks
 * The codes and the `retryable` verdict come from conventions §5. Two of them carry a note this SDK
 * adds, because the naive reading of the status is wrong in a way that costs an idempotency key:
 *
 * - a **502** on a create means the invoice row was written as `failed` and the key is spent, so the
 *   correct retry uses a **new** key — the opposite of `@lazslov/payment`, where a same-key retry
 *   after an unreachable PSP is the only safe move;
 * - a **500** on a create is usually a credential that could not be resolved or decrypted, which is
 *   a configuration problem rather than a transient one, and backoff will never clear it.
 */

import { type ErrorContext, LamidoApiError } from "@lazslov/api-core";
import type { InvoiceStatus } from "./types.js";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "invoice-service";

/**
 * Every code invoice-service sends, plus the one it cannot.
 *
 * @remarks
 * Branch on this, never on `message` — a code is part of the contract and a message is written for a
 * human. `not_configured` is the SDK's own, carried on a `status: 0` error when the base URL or key
 * is missing, so a site can route a missing environment variable through the same translator as a
 * real `401`.
 */
export type InvoiceErrorCode =
  | "validation_error"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "provider_error"
  | "internal_error"
  | "not_configured";

/**
 * The `details` shape a `validation_error` carries: Zod's `flatten()`.
 *
 * @remarks
 * **`fieldErrors` keys are top-level only.** A failure deep inside `partner.address.postalCode`
 * surfaces under the key `partner`, not the full path, so this type promises a top-level field name
 * and nothing more. Finding the real field means validating the body against the schema locally —
 * which is the other reason this package checks dates, VAT rates and the config id before sending.
 */
export interface InvoiceValidationDetails {
  readonly formErrors?: string[];
  readonly fieldErrors?: Record<string, string[]>;
  /** Billingo's own explanation, first 500 characters, on some `provider_error` responses. */
  readonly body?: string;
}

/** Everything {@link InvoiceApiError} needs beyond core's fields. */ interface InvoiceErrorInit {
  readonly status: number;
  readonly code: InvoiceErrorCode;
  readonly message: string;
  readonly requestPath: string;
  readonly retryable: boolean;
  readonly advice?: string;
  readonly details?: InvoiceValidationDetails;
}

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
 *   await store(invoice.id);
 * } catch (error) {
 *   if (!(error instanceof InvoiceApiError)) throw error;
 *   // retryable, but never under the same key — see `advice`.
 *   if (error.retryable) return retryWith(derivedIdempotencyKey(orderId, attempt + 1));
 *   throw error;
 * }
 * ```
 */
export class InvoiceApiError extends LamidoApiError {
  declare readonly code: InvoiceErrorCode;
  declare readonly details?: InvoiceValidationDetails;

  /**
   * What this SDK has to add about what to do next.
   *
   * @remarks
   * Present on a create's `500` and `502`, where the retry that looks obvious is the one that cannot
   * work. Prose, for a human; the machine-readable part is `retryable`. Also folded into `message`,
   * so an error that is only ever logged still says it.
   */
  declare readonly advice?: string;

  constructor(init: InvoiceErrorInit) {
    super({
      service: serviceName,
      status: init.status,
      code: init.code,
      message: init.advice ? `${init.message} — ${init.advice}` : init.message,
      requestPath: init.requestPath,
      retryable: init.retryable,
      ...(init.details === undefined ? {} : { details: init.details }),
    });
    this.name = "InvoiceApiError";
    if (init.advice !== undefined) this.advice = init.advice;
  }
}

/**
 * The invoice is not in a state this document can be produced from.
 *
 * @remarks
 * A `400 bad_request` on `GET …/pdf` or `GET …/download-link`, which the service raises when the
 * status is not `created`. Named rather than left as an opaque 4xx because the common case is not a
 * bug in the request at all: **a cancelled invoice is no longer downloadable here**, even though the
 * document still exists at the provider. Mint the link *before* cancelling.
 *
 * A `pending` or `failed` invoice reaches the same error, and there the answer is different — wait,
 * or reissue under a new key.
 *
 * @example
 * ```ts
 * try {
 *   const pdf = await invoices.getInvoicePdf(id);
 *   return send(pdf.bytes, pdf.filename);
 * } catch (error) {
 *   if (error instanceof InvoiceNotDownloadableError) return renderNoPdfNotice(error.invoiceStatus);
 *   throw error;
 * }
 * ```
 */
export class InvoiceNotDownloadableError extends InvoiceApiError {
  /**
   * The status the service named, when it named one.
   *
   * @remarks
   * A convenience hint, not the authority: it is read out of the service's message, which is prose
   * and may be reworded, so a miss is `null` rather than a guess. `getInvoice` is what actually says
   * what state an invoice is in.
   */
  readonly invoiceStatus: InvoiceStatus | null;

  constructor(init: InvoiceErrorInit & { readonly invoiceStatus: InvoiceStatus | null }) {
    super(init);
    this.name = "InvoiceNotDownloadableError";
    this.invoiceStatus = init.invoiceStatus;
  }
}

/** Codes the service documents. Anything else is a proxy or a bug, not the service. */
const documented = new Set<InvoiceErrorCode>([
  "validation_error",
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "provider_error",
  "internal_error",
]);

/**
 * How the service pairs a status with a code, used only when no usable body arrived.
 *
 * @remarks
 * An HTML error page from an edge proxy has no `error.code`, and inventing one from the message would
 * be branching on prose. The status is the only thing left, and this table is the service's own
 * pairing rather than a guess.
 */
const codeByStatus: Readonly<Record<number, InvoiceErrorCode>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  502: "provider_error",
};

/** The create path, and the only place the key-consumption rule applies. */
const createPath = "/api/invoices";

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
  "On a create this usually means the provider credential could not be resolved or decrypted rather than a transient fault, and backoff will not clear it: ask an operator to run the admin credential test for this providerConfigId. The key is consumed either way, so retry under a NEW key once it passes.";

/** A 502 outside a create reached the provider and was refused; nothing here changed. */
const providerRefusedAdvice =
  "The provider was reached and refused. The message carries their own text — read it before retrying, because nothing on this side changed.";

/**
 * Read the service's error envelope.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status. Typed
 * as returning the narrow error rather than as core's `ErrorParser`, which it still satisfies: a
 * caller reading `details.fieldErrors` should not have to cast at the one place the shape is known.
 */
export const parseInvoiceError = (context: ErrorContext): InvoiceApiError => {
  const envelope = (
    context.body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null
  )?.error;

  const code = codeFor(context.status, envelope?.code);
  const message =
    typeof envelope?.message === "string" && envelope.message !== ""
      ? envelope.message
      : `${serviceName} answered ${context.status}`;

  // Passed through exactly as it arrived: `details` is where the actionable part lives, and
  // re-shaping it here would be a second contract for a caller to learn.
  const details = envelope?.details as InvoiceValidationDetails | undefined;

  const init: InvoiceErrorInit = {
    status: context.status,
    code,
    message,
    requestPath: context.requestPath,
    retryable: code === "provider_error" || code === "internal_error",
    ...advice(context.status, context.requestPath),
    ...(details === undefined ? {} : { details }),
  };

  return isNotDownloadable(code, context.requestPath)
    ? new InvoiceNotDownloadableError({ ...init, invoiceStatus: statusFromMessage(message) })
    : new InvoiceApiError(init);
};

/** The code the service sent, or the one its status implies. */
function codeFor(status: number, raw: unknown): InvoiceErrorCode {
  if (typeof raw === "string" && documented.has(raw as InvoiceErrorCode)) {
    return raw as InvoiceErrorCode;
  }
  return codeByStatus[status] ?? "internal_error";
}

/** The note this SDK attaches, where the obvious retry is the one that cannot work. */
function advice(status: number, requestPath: string): { advice?: string } {
  const creating = requestPath === createPath;
  if (status === 502) return { advice: creating ? newKeyAdvice : providerRefusedAdvice };
  if (status === 500 && creating) return { advice: credentialAdvice };
  return {};
}

/**
 * Whether a `400` is the documented not-in-a-downloadable-state failure.
 *
 * @remarks
 * Decided from the **request path**, not from the message: `/pdf` and `/download-link` are the only
 * two endpoints with that state requirement, and they are the only two this package calls where a
 * `bad_request` can mean it. Every other `400 bad_request` is a request to fix.
 */
function isNotDownloadable(code: InvoiceErrorCode, requestPath: string): boolean {
  if (code !== "bad_request") return false;
  return requestPath.endsWith("/pdf") || requestPath.endsWith("/download-link");
}

/** The statuses the service can name in that message. */
const statuses: readonly InvoiceStatus[] = ["pending", "created", "failed", "cancelled"];

/**
 * Lift the status out of `"Invoice is not in a downloadable state (status: failed)"`.
 *
 * @returns The status, or `null` when the message does not carry one.
 * @remarks
 * The one place this package reads prose, and it fails **closed**: the value is exposed as a hint on
 * a named error, never branched on here, and `null` is the honest answer when the wording changes.
 */
function statusFromMessage(message: string): InvoiceStatus | null {
  const named = /\(status:\s*([a-z]+)\)/.exec(message)?.[1];
  return statuses.find((status) => status === named) ?? null;
}
