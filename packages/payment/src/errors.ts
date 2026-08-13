/**
 * RFC 9457 Problem Details, narrowed to what this package's callers branch on.
 *
 * @remarks
 * The parse is `@lazslov/api-core`'s now: the three services share one problem document over one
 * closed slug set, so payment-service is no longer the odd one out. It never had a
 * `{ data }` / `{ error }` envelope, and the other two have now dropped theirs too.
 *
 * The rule the parser exists to enforce is **branch on `type`, never on `title` or `detail`**.
 * `title` summarises the HTTP *status*, not the type, so a 422 whose type is `conflict` reads
 * "Unprocessable Entity"; `detail` is prose for a human reading a log. Both may be reworded. There
 * is exactly one exception, and it is a 502 — see {@link ./provider-outcome.js}.
 *
 * What this module keeps that core cannot know: the 502 provider-outcome triage, the in-flight
 * 409, and the advice attached to each.
 */

import { type ErrorContext, LamidoApiError, readProblem } from "@lazslov/api-core";
import {
  classifyProviderOutcome,
  isProviderOutcomeRetryable,
  type ProviderOutcome,
  providerOutcomeAdvice,
} from "./provider-outcome.js";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "payment-service";

/**
 * The `code` extension member on a 422 — the values a caller actually switches on.
 *
 * @remarks
 * Carried on core's `code`, which now holds exactly this: the machine-branchable sub-case where a
 * `(type, status)` pair alone cannot identify the failure. It used to be spelled `conflictCode`
 * here to avoid colliding with core's `code`, which then held the problem type; core holds the
 * slug in `type` now, so the two have merged and the alias is gone.
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
type PaymentErrorInit = ConstructorParameters<typeof LamidoApiError>[0] & {
  readonly title: string;
  readonly detail: string;
  readonly advice?: string;
  readonly providerOutcome?: ProviderOutcome;
  readonly providerError?: string;
  readonly supportedEvents?: string[];
};

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
 *   if (error.retryable) return scheduleRetry(error.retryAfter);
 *   throw error;
 * }
 * ```
 */
export class PaymentApiError extends LamidoApiError {
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

  /**
   * The `code` extension member, on a 422.
   *
   * @remarks
   * Narrowed from core's `string` to the closed set the service documents.
   */
  declare readonly code?: PaymentConflictCode;

  /** Present only when `status === 502`. See {@link ./provider-outcome.js}. */
  declare readonly providerOutcome?: ProviderOutcome;

  /** A short, non-secret description of what the PSP said. On a 502. */
  declare readonly providerError?: string;

  /** The valid webhook event types, when a 400 rejected an unknown one. */
  declare readonly supportedEvents?: string[];

  constructor(init: PaymentErrorInit) {
    super({
      ...init,
      message: init.advice ? `${init.detail} — ${init.advice}` : init.detail,
    });
    this.name = "PaymentApiError";
    this.title = init.title;
    this.detail = init.detail;
    if (init.advice !== undefined) this.advice = init.advice;
    if (init.providerOutcome !== undefined) this.providerOutcome = init.providerOutcome;
    if (init.providerError !== undefined) this.providerError = init.providerError;
    if (init.supportedEvents !== undefined) this.supportedEvents = init.supportedEvents;
  }
}

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
  const problem = (
    typeof context.body === "object" && context.body !== null ? context.body : {}
  ) as Record<string, unknown>;
  const init = readProblem(serviceName, context);
  const status = context.status;

  const detail = init.message;
  const providerOutcome = status === 502 ? classifyProviderOutcome(problem.detail) : undefined;

  return new PaymentApiError({
    ...init,
    // Narrowed to the documented set: a code the service does not document came from a proxy.
    ...(init.code !== undefined && conflictCodes.has(init.code as PaymentConflictCode)
      ? { code: init.code as PaymentConflictCode }
      : { code: undefined }),
    title: typeof problem.title === "string" ? problem.title : "",
    detail,
    // Overrides core's flat verdict: a 502 here depends on what happened at the PSP, and a 409
    // is retryable only while an attempt's lease is still in flight.
    retryable: isRetryable(status, providerOutcome, detail),
    ...advice(status, providerOutcome, detail),
    ...(providerOutcome === undefined ? {} : { providerOutcome }),
    ...(typeof problem.provider_error === "string"
      ? { providerError: problem.provider_error }
      : {}),
    ...(Array.isArray(problem.supported_events)
      ? {
          supportedEvents: problem.supported_events.filter(
            (event): event is string => typeof event === "string",
          ),
        }
      : {}),
  });
};

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
