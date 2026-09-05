/**
 * RFC 9457 Problem Details, narrowed to what this package's callers branch on.
 *
 * @remarks
 * The parse is `@lazslov/api-core`'s: booking-service shares the estate's problem document and
 * its closed `type` set, and differs only in the URN namespace `urn:booking-service:problem:…`.
 *
 * What this module adds is the service's own **`code`** table and its retry verdicts. The rule the
 * knowledge base states first is **branch on `code`, never on `detail`** — the `code` set is closed
 * and stable, `detail` is prose for a human and changes without notice. Nothing in this module
 * reads `detail` to decide anything.
 */

import { type ErrorContext, LamidoApiError, readProblem } from "@lazslov/api-core";
import type { components } from "./generated/schema.js";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "booking-service";

/**
 * The `code` extension member — the values a caller actually switches on.
 *
 * @remarks
 * An alias of the generated contract rather than a hand-written union, so a code added upstream
 * breaks the build instead of drifting quietly past. Seventeen members, on three statuses:
 *
 * - **`409`** — `slot_taken`, `hold_not_yours`, `idempotency_mismatch`, `idempotency_in_flight`,
 *   `endpoint_limit_reached`. Only `idempotency_in_flight` is retryable.
 * - **`422`** — `hold_expired`, `already_confirmed`, `pending_expired`, `public_create_disabled`,
 *   `outside_reschedule_window`, `outside_cancel_window`, `booking_terminal`,
 *   `employee_unavailable`, `service_inactive`, `lead_time_violated`, `horizon_exceeded`. None
 *   is retryable as-is: each names a rule, a window or a setting, not a passing state.
 * - **`403`** — `invalid_confirmation_token`. The booking provably exists; the caller presented
 *   the wrong capability. It is the one `code` that rides a 403.
 *
 * `hold_expired` and `already_confirmed` are **`422` on the wire**. The published `openapi.yaml`
 * says `409` for both and the knowledge base records that the spec is the bug.
 */
export type BookingProblemCode = NonNullable<components["schemas"]["Problem"]["code"]>;

/** Everything {@link BookingApiError} carries beyond core's fields. */
type BookingErrorInit = ConstructorParameters<typeof LamidoApiError>[0] & {
  readonly title: string;
  readonly detail: string;
  readonly advice?: string;
  readonly providerError?: string;
};

/**
 * A failed call to booking-service.
 *
 * @remarks
 * Carries no credential, no host and no request body — and no capability token: a token travels
 * in a header or a body, never in a path, so `requestPath` cannot hold one.
 *
 * @example
 * ```ts
 * try {
 *   await booking.createBooking(body, key);
 * } catch (error) {
 *   if (!(error instanceof BookingApiError)) throw error;
 *   if (error.code === "slot_taken") return offerAnotherSlot();
 *   if (error.retryable) return scheduleRetry(error.retryAfter);   // the SAME key
 *   throw error;
 * }
 * ```
 */
export class BookingApiError extends LamidoApiError {
  /** The service's summary of the **status**, not of the type. For a log; never for a branch. */
  readonly title: string;

  /** The service's own prose, verbatim. `message` is this plus {@link BookingApiError.advice}. */
  readonly detail: string;

  /**
   * What this SDK has to add about what to do next.
   *
   * @remarks
   * Present where the naive reading of a status is wrong: a `409` during an in-flight attempt reads
   * as "use a new key", which here is a second appointment; a `422 already_confirmed` reads as a
   * failure and is a success. Prose, for a human — the machine-readable form is `retryable` and
   * `code`.
   */
  declare readonly advice?: string;

  /**
   * The `code` extension member, on a `409`, a `422` or the one `403`.
   *
   * @remarks
   * Narrowed from core's `string` to the closed set the service documents. A `code` outside the
   * set came from a proxy, not from the service, and is dropped.
   */
  declare readonly code?: BookingProblemCode;

  /**
   * An upstream provider's own message, verbatim. Present only on a `502`.
   *
   * @remarks
   * Google's, today, from the freebusy pre-check. For an operator reading a log — its wording is
   * not the service's and not stable. Never parse it, never match on it, never show it to a
   * customer.
   */
  declare readonly providerError?: string;

  constructor(init: BookingErrorInit) {
    super({
      ...init,
      message: init.advice ? `${init.detail} — ${init.advice}` : init.detail,
    });
    this.name = "BookingApiError";
    this.title = init.title;
    this.detail = init.detail;
    if (init.advice !== undefined) this.advice = init.advice;
    if (init.providerError !== undefined) this.providerError = init.providerError;
  }
}

/**
 * Every code the service documents.
 *
 * @remarks
 * The runtime half of {@link BookingProblemCode}. Kept in step with the generated union by a test.
 */
const problemCodes = new Set<BookingProblemCode>([
  "slot_taken",
  "hold_expired",
  "hold_not_yours",
  "already_confirmed",
  "pending_expired",
  "invalid_confirmation_token",
  "public_create_disabled",
  "outside_reschedule_window",
  "outside_cancel_window",
  "booking_terminal",
  "idempotency_mismatch",
  "idempotency_in_flight",
  "employee_unavailable",
  "service_inactive",
  "lead_time_violated",
  "horizon_exceeded",
  "endpoint_limit_reached",
]);

/** The one retryable `409`. */
const inFlightAdvice =
  "An identical request under this Idempotency-Key is still running. Pause briefly and retry the SAME key — a new key would create a second booking.";

/** The one `422` that is a success wearing an error's status. */
const alreadyConfirmedAdvice =
  "The booking is already confirmed. Treat this as success and do not re-mint or re-send the confirmation token.";

/**
 * Read the service's problem document.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status.
 */
export const parseBookingError = (context: ErrorContext): BookingApiError => {
  const problem = (
    typeof context.body === "object" && context.body !== null ? context.body : {}
  ) as Record<string, unknown>;
  const init = readProblem(serviceName, context);

  // Narrowed to the documented set: a code the service does not document came from a proxy.
  const code =
    init.code !== undefined && problemCodes.has(init.code as BookingProblemCode)
      ? (init.code as BookingProblemCode)
      : undefined;

  return new BookingApiError({
    ...init,
    code,
    title: typeof problem.title === "string" ? problem.title : "",
    detail: init.message,
    // Overrides core's flat verdict — see isRetryable for the two places the tables disagree.
    retryable: isRetryable(context.status, code),
    ...advice(code),
    ...(typeof problem.provider_error === "string"
      ? { providerError: problem.provider_error }
      : {}),
  });
};

/**
 * Whether retrying the identical request can succeed.
 *
 * @remarks
 * Read off the service's own `code` table, which disagrees with core's estate-wide default in
 * two places, both narrowing:
 *
 * - **A `422` is not retryable here.** Core says a `422 conflict` is a state that can change.
 *   On this service every `422` code names a rule — a closed window, a terminal booking, a lead
 *   time, a tenant setting — and the table marks each one **No**. `already_confirmed` is a
 *   success, not a retry.
 * - **A `409` is not retryable except `idempotency_in_flight`**, which clears when the original
 *   request finishes. `slot_taken` needs a different slot; `idempotency_mismatch` and
 *   `hold_not_yours` are bugs in the caller.
 *
 * `429`, `500` and `502` keep core's verdict: a `500` releases the idempotency reservation so the
 * same key is reusable, and the `502` freebusy pre-check runs before anything is written.
 */
function isRetryable(status: number, code: BookingProblemCode | undefined): boolean {
  if (status === 409) return code === "idempotency_in_flight";
  if (status === 422) return false;
  return status === 429 || status === 500 || status === 502;
}

/** The note this SDK attaches, where the naive reading of a status costs an appointment. */
function advice(code: BookingProblemCode | undefined): { advice?: string } {
  if (code === "idempotency_in_flight") return { advice: inFlightAdvice };
  if (code === "already_confirmed") return { advice: alreadyConfirmedAdvice };
  return {};
}
