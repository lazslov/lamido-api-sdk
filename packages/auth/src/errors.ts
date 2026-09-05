/**
 * RFC 9457 Problem Details, narrowed to what this package's callers branch on.
 *
 * @remarks
 * The parse is `@lazslov/api-core`'s: auth-service answers the estate's problem document over the
 * estate's closed slug set, so the reader lives once and this module binds the service name to it.
 *
 * The rule the parser exists to enforce is **branch on `type` and `code`, never on `title` or
 * `detail`**. `title` comes from a status→string map, so a 422 whose type is `conflict` reads
 * "Unprocessable Entity"; `detail` is a sentence that will be reworded. Nothing here reads either.
 *
 * What this module keeps that core cannot know: the closed `code` set, the two places auth-service's
 * retry table disagrees with core's default, and the advice attached to a 404.
 */

import { type ErrorContext, LamidoApiError, readProblem } from "@lazslov/api-core";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "auth-service";

/**
 * The `code` extension member — the values a caller actually switches on.
 *
 * @remarks
 * **Hand-written from conventions.md, not aliased from the contract.** The pinned OpenAPI declares
 * `Problem.code` as a bare `string`, so there is no generated union to alias; the thirty values below
 * are the `ProblemCode` union the knowledge base re-derived from the service's own source on
 * 2026-08-28. A code added upstream therefore has to be added here by hand — the runtime set beside
 * this type is what makes that omission visible in a test rather than silent in production.
 *
 * The set is not scoped to a tier. A browser-tier caller meets the token, OAuth, invitation and
 * `login_method_disabled` codes; a client-tier caller meets the idempotency, domain and
 * `no_active_organization` codes; the rest belong to the operator tier this package does not reach,
 * and are kept so `error.code` narrows the same way on every `@lazslov/auth` error.
 *
 * Two rows deserve a sentence each:
 *
 * - `token_invalid` carries **two meanings** the wire cannot separate: a token that matches nothing,
 *   and a login request nobody has approved yet. Branch on the route: on the exchange it means *not
 *   approved yet, keep polling*; on a callback it means *a bad link*.
 * - A `401` never carries a code, and every `401` body is byte-identical. Do not try to tell an
 *   unknown key from a revoked one.
 */
export type AuthProblemCode =
  | "rate_limited"
  | "token_invalid"
  | "token_expired"
  | "token_consumed"
  | "idempotency_body_mismatch"
  | "idempotency_in_flight"
  | "oauth_state_invalid"
  | "oauth_denied"
  | "oauth_email_unverified"
  | "provider_unavailable"
  | "domain_taken"
  | "domain_not_verified"
  | "login_method_disabled"
  | "oauth_not_configured"
  | "no_active_organization"
  | "invitation_consumed"
  | "invitation_revoked"
  | "invitation_expired"
  | "plan_retired"
  | "feature_unknown"
  | "permission_unknown"
  | "subscription_transition_invalid"
  | "system_role_immutable"
  | "role_organization_mismatch"
  | "role_in_use"
  | "assignment_exists"
  | "membership_exists"
  | "key_exists"
  | "override_exists"
  | "endpoint_limit_reached";

/**
 * Every code the service documents.
 *
 * @remarks
 * The runtime half of {@link AuthProblemCode}: a `code` the service does not document came from a
 * proxy, not from the service, and is dropped rather than widened onto the type. A test proves this
 * set and the union name the same thirty values.
 */
export const authProblemCodes: ReadonlySet<AuthProblemCode> = new Set<AuthProblemCode>([
  "rate_limited",
  "token_invalid",
  "token_expired",
  "token_consumed",
  "idempotency_body_mismatch",
  "idempotency_in_flight",
  "oauth_state_invalid",
  "oauth_denied",
  "oauth_email_unverified",
  "provider_unavailable",
  "domain_taken",
  "domain_not_verified",
  "login_method_disabled",
  "oauth_not_configured",
  "no_active_organization",
  "invitation_consumed",
  "invitation_revoked",
  "invitation_expired",
  "plan_retired",
  "feature_unknown",
  "permission_unknown",
  "subscription_transition_invalid",
  "system_role_immutable",
  "role_organization_mismatch",
  "role_in_use",
  "assignment_exists",
  "membership_exists",
  "key_exists",
  "override_exists",
  "endpoint_limit_reached",
]);

/** Everything {@link AuthApiError} carries beyond core's fields. */
type AuthErrorInit = ConstructorParameters<typeof LamidoApiError>[0] & {
  readonly title: string;
  readonly detail: string;
  readonly advice?: string;
  readonly providerError?: string;
};

/**
 * A failed call to auth-service.
 *
 * @remarks
 * Carries no credential, no host and no request body — and neither does the service's own `detail`,
 * whose `instance` is the path without its query string precisely because a query string here can
 * carry a token or an email address.
 *
 * @example
 * ```ts
 * try {
 *   await auth.exchangeMagicLink(body);
 * } catch (error) {
 *   if (!(error instanceof AuthApiError)) throw error;
 *   if (error.code === "token_invalid") return keepPolling();   // on the exchange: not approved yet
 *   if (error.code === "token_consumed") return alreadySignedIn();
 *   throw error;
 * }
 * ```
 */
export class AuthApiError extends LamidoApiError {
  /** The service's summary of the **status**, not of the type. For a log; never for a branch. */
  readonly title: string;

  /** The service's own prose, verbatim. `message` is this plus {@link AuthApiError.advice}. */
  readonly detail: string;

  /**
   * What this SDK has to add about what to do next.
   *
   * @remarks
   * Present on a `404` only, where the naive reading — *this does not exist* — hides three other
   * documented causes. Prose, for a human; the machine-readable form is `status` and `code`.
   */
  declare readonly advice?: string;

  /**
   * The `code` extension member.
   *
   * @remarks
   * Narrowed from core's `string` to the closed set the service documents. Absent on every `401`.
   */
  declare readonly code?: AuthProblemCode;

  /** A short, non-secret summary of what Google or the mail provider said. On a `502` only. */
  declare readonly providerError?: string;

  constructor(init: AuthErrorInit) {
    super({
      ...init,
      message: init.advice ? `${init.detail} — ${init.advice}` : init.detail,
    });
    this.name = "AuthApiError";
    this.title = init.title;
    this.detail = init.detail;
    if (init.advice !== undefined) this.advice = init.advice;
    if (init.providerError !== undefined) this.providerError = init.providerError;
  }
}

/**
 * A 404 on this service has four documented meanings, and only one of them is "does not exist".
 *
 * @remarks
 * A resource another tenant owns, an organization that is not the key's own, a customer read or list
 * without its required `?website=`, and a login handle minted on one website and polled with another
 * website's key all answer `404` — deliberately, because a `403` or a `400` would confirm that an id
 * exists. So a `404` is **never** mapped to `null` in this package: mapping it would turn "you
 * configured the wrong tenant" into "this does not exist yet", which is the harder bug to find.
 */
const notFoundAdvice =
  "A 404 from auth-service also means: the resource belongs to another tenant, the organization is not this key's own, a customer call omitted its required `website`, or a login handle was polled with a different website's key. Check which AUTH_SERVICE_APPLICATION_KEY or AUTH_SERVICE_PUBLISHABLE_KEY this deployment holds before assuming the resource is gone.";

/**
 * Read the service's problem document.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status.
 */
export const parseAuthError = (context: ErrorContext): AuthApiError => {
  const problem = (
    typeof context.body === "object" && context.body !== null ? context.body : {}
  ) as Record<string, unknown>;
  const init = readProblem(serviceName, context);

  // Narrowed to the documented set: a code the service does not document came from a proxy.
  const code =
    init.code !== undefined && authProblemCodes.has(init.code as AuthProblemCode)
      ? (init.code as AuthProblemCode)
      : undefined;

  return new AuthApiError({
    ...init,
    ...(code === undefined ? { code: undefined } : { code }),
    title: typeof problem.title === "string" ? problem.title : "",
    detail: init.message,
    retryable: isRetryable(context.status, code),
    ...(context.status === 404 ? { advice: notFoundAdvice } : {}),
    ...(typeof problem.provider_error === "string"
      ? { providerError: problem.provider_error }
      : {}),
  });
};

/**
 * Whether retrying the identical request can succeed, from conventions.md's own code table.
 *
 * @remarks
 * Overrides core's default in two places, and both are documented by the service:
 *
 * - **A 422 is not retryable here.** Core treats `conflict` at `422` as retryable-later, which is
 *   payment-service's rule. Every `422` code auth-service documents — `login_method_disabled`,
 *   `oauth_not_configured`, `no_active_organization`, `plan_retired`, the `*_unknown` pair,
 *   `subscription_transition_invalid`, `system_role_immutable` — says *No*: each needs a different
 *   request or a configuration change, never the same request again.
 * - **A 409 is retryable for `idempotency_in_flight` only.** The first request under the key has not
 *   answered yet; the table says *Yes, after a short wait*. Every other `409` says *No*.
 *
 * Core's `429`, `500` and `502` verdicts stand. Note that `502` from a magic-link request is the one
 * `502` the workflows file says not to retry blindly: the per-address mail budget is charged before
 * the provider is called, so a retry loop exhausts it having sent nothing. `retryable: true` there
 * means *once*, then surface the failure to the person.
 */
function isRetryable(status: number, code: AuthProblemCode | undefined): boolean {
  if (status === 409) return code === "idempotency_in_flight";
  if (status === 422) return false;
  return status === 429 || status === 500 || status === 502;
}
