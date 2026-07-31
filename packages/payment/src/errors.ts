/**
 * RFC 7807 Problem Details, translated once.
 *
 * @remarks
 * Nothing here resembles the other two packages' error parsers, because payment-service has no
 * `{ data }` / `{ error }` envelope at all: a success response is the resource itself, and a failure
 * is `application/problem+json`.
 *
 * The rule the parser exists to enforce is **branch on `type`, never on `title` or `detail`**.
 * `title` summarises the HTTP *status*, not the type, so a 422 whose type is `conflict` reads
 * "Unprocessable Entity"; `detail` is prose for a human reading a log. Both may be reworded. There
 * is exactly one exception, and it is a 502 — see {@link ./provider-outcome.js}.
 */

import { type ErrorContext, LamidoApiError } from "@lazslov/api-core";
import type { components } from "./generated/schema.js";
import {
  classifyProviderOutcome,
  isProviderOutcomeRetryable,
  type ProviderOutcome,
  providerOutcomeAdvice,
} from "./provider-outcome.js";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "payment-service";

/**
 * Every problem type the service sends.
 *
 * @remarks
 * A closed set; adding a member is an API change. Note what is *not* here: there is no `provider`
 * type. A PSP failure is `internal` carried by HTTP **502**, because from a caller's point of view
 * the distinction that matters is "their side, not mine", and the status already says whether
 * retrying can help.
 *
 * `conflict` carries both 409 and 422, which is why `retryable` cannot be derived from the type
 * alone.
 */
export type PaymentProblemType = components["schemas"]["Problem"]["type"];

/**
 * The `code` extension member on a 422 — the values a caller actually switches on.
 *
 * @remarks
 * Spelled `conflictCode` on the error rather than `code`, which core already uses for the
 * machine-readable value of the failure itself. Two fields called `code` on one error would be a
 * trap in exactly the place where money is involved.
 */
export type PaymentConflictCode =
  /** The payment has not succeeded, or its status moved while the refund was being reserved. */
  | "payment_not_refundable"
  /** `currency` is not the payment's. The field is an assertion, not an instruction. */
  | "currency_mismatch"
  /** The PSP-side transaction cannot yet be identified. Refresh the payment, then retry. */
  | "refund_target_unknown"
  /** The amount would take the payment past what is left. Re-read the refunds and recompute. */
  | "refund_exceeds_remaining"
  | "not_releasable"
  | "known_to_provider"
  | "already_attached"
  | "endpoint_disabled";

/** Everything {@link PaymentApiError} carries beyond core's fields. */
interface PaymentErrorInit {
  readonly type: PaymentProblemType;
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly requestPath: string;
  readonly retryable: boolean;
  readonly advice?: string;
  readonly conflictCode?: PaymentConflictCode;
  readonly providerOutcome?: ProviderOutcome;
  readonly providerError?: string;
  readonly retryAfterSeconds?: number;
  readonly supportedEvents?: string[];
}

/**
 * A failed call to payment-service.
 *
 * @remarks
 * Carries no credential, no host and no request body — and neither does the service's own `detail`,
 * which never contains a credential or anything echoed back from a PSP that could hold one.
 *
 * @example
 * ```ts
 * try {
 *   await payments.createPayment(body, key);
 * } catch (error) {
 *   if (!(error instanceof PaymentApiError)) throw error;
 *   if (error.providerOutcome === "unknown") return retryWith(key);  // the SAME key
 *   if (error.retryable) return scheduleRetry(error.retryAfterSeconds);
 *   throw error;
 * }
 * ```
 */
export class PaymentApiError extends LamidoApiError {
  /**
   * The problem type. **This is what to branch on.**
   *
   * @remarks
   * Also available as core's `code`, which carries the same URN so cross-service code can read one
   * field on any `@lazslov/*` error.
   */
  readonly type: PaymentProblemType;

  /** The service's summary of the **status**, not of the type. For a log; never for a branch. */
  readonly title: string;

  /** The service's own prose, verbatim. `message` is this plus {@link PaymentApiError.advice}. */
  readonly detail: string;

  /**
   * What this SDK has to add about what to do next.
   *
   * @remarks
   * Present where the naive reading of a status is dangerous: a 409 during an in-flight attempt
   * reads as "use a new key", which here is a second payment, and a 502's four meanings each carry
   * a different retry rule. Prose, for a human — the machine-readable form is `retryable` and
   * `providerOutcome`.
   */
  declare readonly advice?: string;

  /** The `code` extension member, on a 422. */
  declare readonly conflictCode?: PaymentConflictCode;

  /** Present only when `status === 502`. See {@link ./provider-outcome.js}. */
  declare readonly providerOutcome?: ProviderOutcome;

  /** A short, non-secret description of what the PSP said. On a 502. */
  declare readonly providerError?: string;

  /**
   * Seconds to wait, on a 429.
   *
   * @remarks
   * From `refresh`'s per-payment throttle: one call per payment per 5 seconds, and **no provider
   * call was made**. A failed refresh consumes the window too, which is what stops a retry loop
   * hammering a PSP that is timing out.
   */
  declare readonly retryAfterSeconds?: number;

  /** The valid webhook event types, when a 400 rejected an unknown one. */
  declare readonly supportedEvents?: string[];

  constructor(init: PaymentErrorInit) {
    super({
      service: serviceName,
      status: init.status,
      // core's `code` is the stable machine value; here that is the problem type.
      code: init.type,
      message: init.advice ? `${init.detail} — ${init.advice}` : init.detail,
      requestPath: init.requestPath,
      retryable: init.retryable,
    });
    this.name = "PaymentApiError";
    this.type = init.type;
    this.title = init.title;
    this.detail = init.detail;
    if (init.advice !== undefined) this.advice = init.advice;
    if (init.conflictCode !== undefined) this.conflictCode = init.conflictCode;
    if (init.providerOutcome !== undefined) this.providerOutcome = init.providerOutcome;
    if (init.providerError !== undefined) this.providerError = init.providerError;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
    if (init.supportedEvents !== undefined) this.supportedEvents = init.supportedEvents;
  }
}

/** Problem types the service documents. Anything else came from a proxy, not from the service. */
const documented = new Set<PaymentProblemType>([
  "urn:payment-service:problem:validation",
  "urn:payment-service:problem:unauthorized",
  "urn:payment-service:problem:forbidden",
  "urn:payment-service:problem:not-found",
  "urn:payment-service:problem:conflict",
  "urn:payment-service:problem:rate-limit",
  "urn:payment-service:problem:internal",
]);

/** How the service pairs a status with a type, for when no problem body arrived. */
const typeByStatus: Readonly<Record<number, PaymentProblemType>> = {
  400: "urn:payment-service:problem:validation",
  401: "urn:payment-service:problem:unauthorized",
  403: "urn:payment-service:problem:forbidden",
  404: "urn:payment-service:problem:not-found",
  409: "urn:payment-service:problem:conflict",
  422: "urn:payment-service:problem:conflict",
  429: "urn:payment-service:problem:rate-limit",
};

/** Every conflict code the service documents. */
const conflictCodes = new Set<PaymentConflictCode>([
  "payment_not_refundable",
  "currency_mismatch",
  "refund_target_unknown",
  "refund_exceeds_remaining",
  "not_releasable",
  "known_to_provider",
  "already_attached",
  "endpoint_disabled",
]);

/**
 * A 404 on this tier means one of two things, and the second is the expensive one to miss.
 *
 * @remarks
 * Every read is scoped to the key's merchant inside the same SQL predicate that fetches the row, so
 * another merchant's id is indistinguishable from one that does not exist. A `404` is therefore
 * **not** mapped to `null` anywhere in this package: a payment id you hold came from a payment you
 * created, so "not found" is a bug — and quite often the bug is a staging deployment holding a
 * production key, or the reverse.
 */
const notFoundAdvice =
  "A payment or refund id you hold should exist. A 404 here can also mean the key belongs to a different merchant, so check which PAYMENT_SERVICE_KEY this deployment is using before assuming the resource is gone.";

/** The in-flight lease, which is the one retryable 409. */
const inFlightAdvice =
  "An attempt under this Idempotency-Key is still in flight; the lease is 60 seconds. Pause and retry the SAME key — a new key would start a second operation. This is also what a clock-skew reclaim at the key's TTL boundary looks like, and it clears once both clocks agree.";

/**
 * Read the service's problem document.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status.
 */
export const parsePaymentError = (context: ErrorContext): PaymentApiError => {
  const problem = (context.body ?? {}) as Record<string, unknown>;

  const type = typeFor(context.status, problem.type);
  const status = context.status;
  const detail =
    typeof problem.detail === "string" && problem.detail !== ""
      ? problem.detail
      : `${serviceName} answered ${status}`;

  const conflictCode =
    typeof problem.code === "string" && conflictCodes.has(problem.code as PaymentConflictCode)
      ? (problem.code as PaymentConflictCode)
      : undefined;

  const providerOutcome = status === 502 ? classifyProviderOutcome(problem.detail) : undefined;
  const retryAfterSeconds = readRetryAfter(problem.retry_after, context.headers);

  return new PaymentApiError({
    type,
    status,
    title: typeof problem.title === "string" ? problem.title : "",
    detail,
    // The service's `instance` is the request path and nothing else, which is what core records
    // anyway — so the path comes from the request rather than from a field a proxy could rewrite.
    requestPath: context.requestPath,
    retryable: isRetryable(status, providerOutcome, detail),
    ...advice(status, providerOutcome, detail),
    ...(conflictCode === undefined ? {} : { conflictCode }),
    ...(providerOutcome === undefined ? {} : { providerOutcome }),
    ...(typeof problem.provider_error === "string"
      ? { providerError: problem.provider_error }
      : {}),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    ...(Array.isArray(problem.supported_events)
      ? {
          supportedEvents: problem.supported_events.filter(
            (event): event is string => typeof event === "string",
          ),
        }
      : {}),
  });
};

/** The type the service sent, or the one its status implies. */
function typeFor(status: number, raw: unknown): PaymentProblemType {
  if (typeof raw === "string" && documented.has(raw as PaymentProblemType)) {
    return raw as PaymentProblemType;
  }
  return typeByStatus[status] ?? "urn:payment-service:problem:internal";
}

/**
 * Whether retrying the identical request can succeed.
 *
 * @remarks
 * Decided from `status` **and** — for a 502 only — the classified provider outcome. The type alone
 * cannot answer it, because `conflict` carries both 409 and 422:
 *
 * - **422 is retryable later.** The request was understood; the answer is about the *resource's
 *   state*, and state changes. An amount that exceeds the remaining balance today may be refundable
 *   after another refund is canceled.
 * - **409 is not** — except an attempt still in flight, which clears when its 60-second lease does.
 * - **429 is retryable** after `retry_after`.
 * - **500 is retryable**; a **502 depends** on what happened at the PSP.
 * - Everything else is a `false` that needs a human or a configuration change.
 */
function isRetryable(
  status: number,
  outcome: ProviderOutcome | undefined,
  detail: string,
): boolean {
  if (status === 502) return outcome !== undefined && isProviderOutcomeRetryable(outcome);
  if (status === 409) return isInFlight(detail);
  return status === 422 || status === 429 || status === 500;
}

/** The note this SDK attaches, where the naive reading of a status costs money. */
function advice(
  status: number,
  outcome: ProviderOutcome | undefined,
  detail: string,
): { advice?: string } {
  if (status === 502 && outcome !== undefined) return { advice: providerOutcomeAdvice[outcome] };
  if (status === 409 && isInFlight(detail)) return { advice: inFlightAdvice };
  if (status === 404) return { advice: notFoundAdvice };
  return {};
}

/**
 * Whether a 409 is the in-flight lease rather than a key reused with a different body.
 *
 * @remarks
 * The second read of prose in this package, and the same discipline as the 502 triage: a short
 * stable substring, and a miss falls back to the **cautious** answer — not retryable, which for a
 * key-reuse conflict is correct, because retrying that identical request can never succeed.
 */
function isInFlight(detail: string): boolean {
  return detail.toLowerCase().includes("in flight");
}

/** `retry_after` is a problem member on the refresh throttle; `Retry-After` is the HTTP header. */
function readRetryAfter(member: unknown, headers: Headers): number | undefined {
  if (typeof member === "number" && Number.isFinite(member)) return member;
  const header = Number(headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? header : undefined;
}
