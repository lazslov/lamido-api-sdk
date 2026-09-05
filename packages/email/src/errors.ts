/**
 * email-service's problem document, narrowed to what this package's callers branch on.
 *
 * @remarks
 * The parse is `@lazslov/api-core`'s: every Lamido service answers one RFC 9457 document over
 * one closed slug set. What this module adds is what core cannot know — the service's `code`
 * union, and the retry verdicts where the service's own table disagrees with core's default:
 *
 * - a **`422`** is *never* fixed by a retry of the same request. Core reads `conflict` at `422`
 *   as "retryable later"; here the state that forbids the call is a provisioning fault an
 *   operator must clear, or a message that has already left `queued` and will never return.
 * - a **`409 idempotency_in_flight`** *is* retryable after a pause, with the **same** key. Every
 *   other `409` is not.
 *
 * The rule the parser exists to enforce is **branch on `code`, never on `title` or `detail`**.
 * `title` summarises the HTTP status, so a `422` reads "Unprocessable Entity" whatever went
 * wrong; `detail` is prose for a human reading a log. Nothing in this module reads either.
 */

import { type ErrorContext, LamidoApiError, readProblem } from "@lazslov/api-core";
import { apiKeyVar } from "./env.js";
import type { components } from "./generated/schema.js";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "email-service";

/**
 * The `code` extension member — **the only member safe to switch on.**
 *
 * @remarks
 * An alias of the generated contract rather than a hand-written union, so a code added upstream
 * breaks the build instead of drifting quietly past. Eighteen values today. Two of them —
 * `provider_rejected` and `provider_unavailable` — are recorded on a message and never returned
 * by a send: sending is asynchronous, and no provider call happens in the request path.
 */
export type EmailProblemCode = NonNullable<components["schemas"]["Problem"]["code"]>;

/** Everything {@link EmailApiError} carries beyond core's fields. */
type EmailErrorInit = ConstructorParameters<typeof LamidoApiError>[0] & {
  readonly title: string;
  readonly detail: string;
  readonly advice?: string;
};

/**
 * A failed call to email-service.
 *
 * @remarks
 * Carries no credential, no host and no request body. The service's own `detail` never carries a
 * recipient address on a list, and `instance` is a path with no query string — a problem gets
 * pasted into tickets, and a query string can hold an address.
 *
 * @example
 * ```ts
 * try {
 *   await email.sendMessage(body, key);
 * } catch (error) {
 *   if (!(error instanceof EmailApiError)) throw error;
 *   if (error.code === "recipient_suppressed") return markUnreachable(order);  // never work around it
 *   if (error.code === "idempotency_in_flight") return retryLater(key);       // the SAME key
 *   if (error.retryable) return scheduleRetry(error.retryAfter);
 *   throw error;
 * }
 * ```
 */
export class EmailApiError extends LamidoApiError {
  /** The service's summary of the **status**, not of the code. For a log; never for a branch. */
  readonly title: string;

  /** The service's own prose, verbatim. `message` is this plus {@link EmailApiError.advice}. */
  readonly detail: string;

  /**
   * What this SDK has to add about what to do next.
   *
   * @remarks
   * Present where the naive reading of a status is wrong: a `409` reads as "use a new key", which
   * for an in-flight lease sends a second email; a `404` reads as "gone", which is often a
   * deployment holding another tenant's key. Prose, for a human — the machine-readable form is
   * `retryable` and `code`.
   */
  declare readonly advice?: string;

  /**
   * The `code` extension member, narrowed from core's `string` to the documented set.
   *
   * @remarks
   * Absent on a plain `400 validation` (read `errors` instead), on a `401`, `403` and `404`, and
   * when the service sent a code this SDK does not document.
   */
  declare readonly code?: EmailProblemCode;

  constructor(init: EmailErrorInit) {
    super({
      ...init,
      message: init.advice ? `${init.detail} — ${init.advice}` : init.detail,
    });
    this.name = "EmailApiError";
    this.title = init.title;
    this.detail = init.detail;
    if (init.advice !== undefined) this.advice = init.advice;
  }
}

/**
 * Every problem code the service documents.
 *
 * @remarks
 * The runtime half of {@link EmailProblemCode}: a `code` the service does not document came from a
 * proxy, not from the service, and is dropped so a caller falls through to the status. Kept in
 * step with the generated union by a test.
 */
const problemCodes = new Set<EmailProblemCode>([
  "recipient_suppressed",
  "identity_not_verified",
  "identity_paused",
  "quota_exceeded",
  "rate_limited",
  "unknown_template",
  "template_variable_missing",
  "template_variable_invalid",
  "attachment_too_large",
  "attachment_count_exceeded",
  "idempotency_mismatch",
  "idempotency_in_flight",
  "credential_missing",
  "credential_invalid",
  "provider_rejected",
  "provider_unavailable",
  "stream_closed",
  "marketing_requires_consent",
]);

/**
 * A 404 on this tier means one of two things, and the second is the expensive one to miss.
 *
 * @remarks
 * A message that belongs to another tenant is a `404`, never a `403`, so an id cannot be probed
 * for existence. A `404` is therefore **not** mapped to `null` anywhere in this package: a
 * `public_id` you hold came from a `202` you received, so "not found" is a bug — and quite often
 * the bug is a deployment holding a different tenant's key.
 */
const notFoundAdvice = `A message id you hold should exist. A 404 here can also mean the key belongs to a different tenant, so check which ${apiKeyVar} this deployment is using before assuming the message is gone.`;

/** The in-flight lease, which is the one retryable 409. */
const inFlightAdvice =
  "Another request holds this Idempotency-Key right now; the lease is 60 seconds. Pause and retry the SAME key — a new key would send a second email, and there is no unsend.";

/** The key was used with a different body, so the identical request can never succeed. */
const mismatchAdvice =
  "This Idempotency-Key was already used with a different body, and the first message stands. Resend the original body under this key, or derive a new key for a genuinely new message.";

/** The one refusal that creates a row and consumes the key. */
const suppressedAdvice =
  "This address bounced permanently or the person marked your mail as spam. A `suppressed` message row was created and the key is consumed. Do not retry under a new key and do not route around it with a second address — ask an operator, who will ask why.";

/** The two 429s want different reactions, and only `code` tells them apart. */
const quotaAdvice =
  "This is your daily or monthly send cap, not the request throttle. retryAfter is the end of the BINDING period — for a monthly cap that is measured in days, and you need an operator rather than a sleep.";

/** A 422 on a send is a provisioning fault, and nothing was attempted. */
const provisioningAdvice =
  "Your sending identity, its domain or its credential is not ready. Nothing was attempted and the key is not consumed. An operator fixes it; then retry the SAME key.";

/** A 422 on a cancel means the message has already left `queued`. */
const notQueuedAdvice =
  "Only a queued message can be cancelled. detail carries the message's current status, so you can tell 'already sent' from 'already canceled'. A retry cannot change it.";

/**
 * Read the service's problem document.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status.
 */
export const parseEmailError = (context: ErrorContext): EmailApiError => {
  const problem = (
    typeof context.body === "object" && context.body !== null ? context.body : {}
  ) as Record<string, unknown>;
  const init = readProblem(serviceName, context);
  const status = context.status;

  // Narrowed to the documented set: a code the service does not document came from a proxy.
  const code =
    init.code !== undefined && problemCodes.has(init.code as EmailProblemCode)
      ? (init.code as EmailProblemCode)
      : undefined;

  return new EmailApiError({
    ...init,
    code,
    title: typeof problem.title === "string" ? problem.title : "",
    detail: init.message,
    retryable: isRetryable(status, code, init.retryable),
    ...advice(status, code, context.requestPath),
  });
};

/**
 * Whether retrying the identical request can succeed.
 *
 * @remarks
 * Core's verdict, with two overrides the service's own retry table demands:
 *
 * - **`409` is not retryable** — except `idempotency_in_flight`, which clears when its 60-second
 *   lease does. `recipient_suppressed`, `stream_closed` and `idempotency_mismatch` never clear.
 * - **`422` is not retryable.** Core reads `conflict` at `422` as "the state can change", and
 *   on this service it changes only when an operator acts (a send) or never (a cancel). The
 *   anti-pattern table says it in five words: *retry a 422 unchanged — a retry cannot fix it.*
 *
 * Everything else is core's: `429` after `retryAfter`, `500` once, and a `400`/`401`/`403`/`404`/
 * `413` needs a change first. Note that a `400` and a `413` do **not** consume the idempotency
 * key — the guard order reserves it only after validation — so once the body is fixed the same
 * key is the right one to resend with.
 */
function isRetryable(
  status: number,
  code: EmailProblemCode | undefined,
  fromCore: boolean,
): boolean {
  if (status === 409) return code === "idempotency_in_flight";
  if (status === 422) return false;
  return fromCore;
}

/** The note this SDK attaches, where the naive reading of a status sends a second email. */
function advice(
  status: number,
  code: EmailProblemCode | undefined,
  requestPath: string,
): { advice?: string } {
  if (status === 404) return { advice: notFoundAdvice };
  if (code === "idempotency_in_flight") return { advice: inFlightAdvice };
  if (code === "idempotency_mismatch") return { advice: mismatchAdvice };
  if (code === "recipient_suppressed") return { advice: suppressedAdvice };
  if (code === "quota_exceeded") return { advice: quotaAdvice };
  if (status === 422) {
    return { advice: requestPath.endsWith("/cancel") ? notQueuedAdvice : provisioningAdvice };
  }
  return {};
}
