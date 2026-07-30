/**
 * The error base every service package throws, and the shape of the parser each one supplies.
 *
 * @remarks
 * Core owns the class; it does not own **normalisation**. content-service and invoice-service
 * branch on `error.code`, payment-service on an RFC 7807 `problem.type`, so each package reads
 * its own envelope and fills these fields in.
 */

/** Everything {@link LamidoApiError} needs. Assembled by a service package's error parser. */
export interface ApiErrorInit {
  /** Which service answered, e.g. `"content-service"`. */
  readonly service: string;
  /** HTTP status, or `0` when the request was never made. */
  readonly status: number;
  /** The service's stable machine-readable value, widened per package to its own union. */
  readonly code: string;
  readonly message: string;
  /** Request path only — never a full URL, never a query string. */
  readonly requestPath: string;
  /**
   * Whether retrying can succeed, decided from the service's own documented error table
   * rather than inferred from the status.
   */
  readonly retryable: boolean;
  /** The service's own `details` or problem extension members, and nothing else. */
  readonly details?: unknown;
}

/**
 * A failed call to one of the Lamido services.
 *
 * @remarks
 * Carries no credential, no host and no request body. A caught error is the object most
 * likely to be logged with its full context, so it holds only what a caller can act on.
 *
 * @example
 * ```ts
 * try {
 *   await content.pages.get("about");
 * } catch (error) {
 *   if (error instanceof LamidoApiError && error.status === 404) return renderNotFound();
 *   throw error;
 * }
 * ```
 */
export class LamidoApiError extends Error {
  readonly service: string;
  readonly status: number;
  readonly code: string;
  readonly requestPath: string;
  readonly retryable: boolean;
  /**
   * `declare`, so the field is not defined when there is nothing to put in it.
   *
   * @remarks
   * A class field declaration emits `details = undefined` under ES2022 semantics, which makes
   * `"details" in error` true on every error. Absence is the honest signal that the service
   * sent no detail — and it keeps a logged error object down to what it really carries.
   */
  declare readonly details?: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "LamidoApiError";
    this.service = init.service;
    this.status = init.status;
    this.code = init.code;
    this.requestPath = init.requestPath;
    this.retryable = init.retryable;
    if (init.details !== undefined) this.details = init.details;
  }
}

/**
 * The base URL or key is missing, so no request was attempted.
 *
 * @remarks
 * Deliberately a subclass with `status: 0` rather than a separate error type. A site can then
 * route a missing environment variable through the same translator as a real 401 — one branch
 * for one user-visible outcome — which is what lets a checkout render placeholders instead of
 * crashing when nothing is configured.
 */
export class NotConfiguredError extends LamidoApiError {
  constructor(init: { service: string; message: string; requestPath?: string }) {
    super({
      service: init.service,
      status: 0,
      code: "not_configured",
      message: init.message,
      requestPath: init.requestPath ?? "",
      retryable: false,
    });
    this.name = "NotConfiguredError";
  }
}

/** What an {@link ErrorParser} is given about a non-2xx response. */
export interface ErrorContext {
  readonly status: number;
  /** The parsed body, or `null` when it was absent or not JSON. Never a re-serialised object. */
  readonly body: unknown;
  readonly headers: Headers;
  /** Request path only, as it will appear on the error. */
  readonly requestPath: string;
}

/**
 * Turns a non-2xx response into an error.
 *
 * @remarks
 * Supplied by each service package, because only the package that read its service's error
 * table can say what a code means or whether a retry is safe.
 */
export type ErrorParser = (context: ErrorContext) => LamidoApiError;
