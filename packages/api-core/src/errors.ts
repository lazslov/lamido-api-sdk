/**
 * The error base every service package throws, and the shape of the parser each one supplies.
 *
 * @remarks
 * Core owns the class *and* the normalisation, which it did not used to. The three services
 * now answer with one RFC 9457 problem document over one closed type set, so the reader lives
 * once in `./problem.ts` and each package binds its own service name to it.
 */

import type { ProblemFieldError, ProblemType } from "./problem.js";

/** Everything {@link LamidoApiError} needs. Assembled by {@link readProblem}. */
export interface ApiErrorInit {
  /** Which service answered, e.g. `"content-service"`. */
  readonly service: string;
  /** HTTP status, or `0` when the request was never made. */
  readonly status: number;
  /**
   * The problem slug. **Branch on this**, paired with `status`.
   *
   * @remarks
   * `conflict` covers both `409` and `422`, and `internal` covers both `500` and `502`, so the
   * slug alone does not identify the failure. `unknown` means no problem document arrived.
   */
  readonly type: ProblemType;
  /**
   * The `409`/`422` sub-case, e.g. `idempotency_key_reused`.
   *
   * @remarks
   * Absent on most problems — it exists only where two failures share a `(type, status)` pair
   * and a caller has to tell them apart.
   */
  readonly code?: string;
  readonly message: string;
  /** Request path only — never a full URL, never a query string. */
  readonly requestPath: string;
  /**
   * Whether retrying the identical request can succeed, from the services' own error tables.
   *
   * @remarks
   * True does not mean "retry now". A `429` wants {@link LamidoApiError.retryAfter} seconds
   * first, and `@lazslov/invoice` documents statuses where the retry needs a **new**
   * idempotency key.
   */
  readonly retryable: boolean;
  /** Field-level errors, on a `400`. Every failure at once, not the first. */
  readonly errors?: readonly ProblemFieldError[];
  /** Seconds to wait, on a `429`. */
  readonly retryAfter?: number;
  /** The response's `X-Request-Id`. Quote it in a support request. */
  readonly requestId?: string;
  /** The service's own `details` diagnostics extension, passed through untouched. */
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
 *   await content.getPage("about");
 * } catch (error) {
 *   if (error instanceof LamidoApiError && error.status === 404) return renderNotFound();
 *   throw error;
 * }
 * ```
 */
export class LamidoApiError extends Error {
  readonly service: string;
  readonly status: number;
  readonly type: ProblemType;
  readonly requestPath: string;
  readonly retryable: boolean;
  /**
   * `declare`, so the field is not defined when there is nothing to put in it.
   *
   * @remarks
   * A class field declaration emits `details = undefined` under ES2022 semantics, which makes
   * `"details" in error` true on every error. Absence is the honest signal that the service
   * sent no detail — and it keeps a logged error object down to what it really carries.
   *
   * The same reasoning covers every optional field below.
   */
  declare readonly details?: unknown;
  declare readonly code?: string;
  declare readonly errors?: readonly ProblemFieldError[];
  declare readonly retryAfter?: number;
  declare readonly requestId?: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "LamidoApiError";
    this.service = init.service;
    this.status = init.status;
    this.type = init.type;
    this.requestPath = init.requestPath;
    this.retryable = init.retryable;
    if (init.details !== undefined) this.details = init.details;
    if (init.code !== undefined) this.code = init.code;
    if (init.errors !== undefined) this.errors = init.errors;
    if (init.retryAfter !== undefined) this.retryAfter = init.retryAfter;
    if (init.requestId !== undefined) this.requestId = init.requestId;
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
      // No request left the process, so no problem document exists to classify it. `unknown` is
      // the honest slug; `code` carries the one thing that is actually known.
      type: "unknown",
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
