/**
 * RFC 9457 Problem Details, narrowed to what this package's callers branch on.
 *
 * @remarks
 * The parse is `@lazslov/api-core`'s: every estate service answers one problem document over one
 * closed slug set. What this module adds is what core cannot know — the service's own `code` table,
 * the two `502`s and their `provider_error`, and the one rule that makes a checkout retry safe:
 *
 * **A `429` or a `502` from checkout still committed a `pending` order, and the recovery is the
 * identical request under the same `Idempotency-Key`.** The payment call runs after the checkout
 * transaction commits, so neither status means "start again". `retryable` and `advice` encode that.
 *
 * The rule the parser exists to enforce is **branch on `status` and `code`, never on `type` alone
 * and never on `title` or `detail`**. One `type` covers two statuses: `conflict` is `409` for the two
 * idempotency codes and `422` for every state refusal, and `internal` is `500` and `502` alike.
 */

import { type ErrorContext, LamidoApiError, readProblem } from "@lazslov/api-core";
import type { components } from "./generated/schema.js";

/** The service this package talks to, named on every error it throws. */
export const serviceName = "webshop-service";

/**
 * The `code` extension member — the values a caller actually switches on.
 *
 * @remarks
 * An alias of the generated contract rather than a hand-written union, so a code added upstream
 * breaks the build instead of drifting quietly past. Every value is `type: conflict`; the status
 * says which kind:
 *
 * - **`422`** is a state refusal. `variant_unavailable`, `insufficient_stock`, `cart_expired`,
 *   `cart_converted`, `invalid_transition`, `order_terminal`, `coupon_invalid`, `coupon_expired`,
 *   `coupon_exhausted`, `coupon_minimum_not_met`, `shipping_method_inactive`.
 * - **`409`** is idempotency. `idempotency_key_reused` is a client bug; `idempotency_in_flight`
 *   clears when the 60-second lease does.
 *
 * Four members can never reach a consumer: `key_revoked` is in the enum and **never raised** — a
 * revoked key is an ordinary `401` — and `endpoint_limit_reached`, `key_self_revoke` and
 * `last_managing_key` are admin-tier refusals. They stay in the union because the contract declares
 * them; do not write a branch for them.
 */
export type WebshopProblemCode = NonNullable<components["schemas"]["Problem"]["code"]>;

/**
 * The `provider_error` member, on a `502` from checkout's payment step.
 *
 * @remarks
 * Neither carries a `code`, and both leave a real `pending` order holding stock:
 *
 * - `payment_create_rejected` — payment-service answered a definitive `4xx`. The identical request
 *   cannot succeed until the shop's configuration changes.
 * - `payment_create_unknown` — a timeout, a `5xx`, a `408`, a `429`, or a body that was not a
 *   payment. **A payment may or may not exist.** Retry the same key: the derived key at
 *   payment-service guarantees one payment rather than two.
 */
export type WebshopProviderError = NonNullable<components["schemas"]["Problem"]["provider_error"]>;

/** Everything {@link WebshopApiError} carries beyond core's fields. */
type WebshopErrorInit = ConstructorParameters<typeof LamidoApiError>[0] & {
  readonly title: string;
  readonly detail: string;
  readonly advice?: string;
  readonly providerError?: WebshopProviderError;
};

/**
 * A failed call to webshop-service.
 *
 * @remarks
 * Carries no credential, no host and no request body.
 *
 * @example
 * ```ts
 * try {
 *   await shop.checkout(cartId, body, key);
 * } catch (error) {
 *   if (!(error instanceof WebshopApiError)) throw error;
 *   // A 429 or a 502 committed the order. Retry the SAME key — never a new cart, never a new key.
 *   if (error.retryable) return retryWith(key, error.retryAfter);
 *   if (error.code === "insufficient_stock") return askToReduceQuantity();
 *   throw error;
 * }
 * ```
 */
export class WebshopApiError extends LamidoApiError {
  /** The service's summary of the **status**, not of the type. For a log; never for a branch. */
  readonly title: string;

  /** The service's own prose, verbatim. `message` is this plus {@link WebshopApiError.advice}. */
  readonly detail: string;

  /**
   * What this SDK has to add about what to do next.
   *
   * @remarks
   * Present where the naive reading of a status strands an order: a `429` or `502` from checkout
   * reads as "the checkout failed", and here it means "the order exists, retry the same key". Prose,
   * for a human — the machine-readable form is `retryable`, `code` and `providerError`.
   */
  declare readonly advice?: string;

  /**
   * The `code` extension member, on a `409` or `422`.
   *
   * @remarks
   * Narrowed from core's `string` to the closed set the contract declares. A code the service does
   * not declare came from a proxy, not from the service, and is dropped.
   */
  declare readonly code?: WebshopProblemCode;

  /** Present only when `status === 502`. See {@link WebshopProviderError}. */
  declare readonly providerError?: WebshopProviderError;

  constructor(init: WebshopErrorInit) {
    super({
      ...init,
      message: init.advice ? `${init.detail} — ${init.advice}` : init.detail,
    });
    this.name = "WebshopApiError";
    this.title = init.title;
    this.detail = init.detail;
    if (init.advice !== undefined) this.advice = init.advice;
    if (init.providerError !== undefined) this.providerError = init.providerError;
  }
}

/**
 * Every code the contract declares.
 *
 * @remarks
 * The runtime half of {@link WebshopProblemCode}: kept in step with the generated union by a test.
 * Includes the four members a consumer never sees, so a code the contract declares is never dropped
 * by the parser that widened its type.
 */
const problemCodes = new Set<WebshopProblemCode>([
  "key_revoked",
  "invalid_transition",
  "variant_unavailable",
  "insufficient_stock",
  "cart_expired",
  "cart_converted",
  "order_terminal",
  "coupon_invalid",
  "coupon_expired",
  "coupon_exhausted",
  "coupon_minimum_not_met",
  "shipping_method_inactive",
  "idempotency_key_reused",
  "idempotency_in_flight",
  "endpoint_limit_reached",
  "key_self_revoke",
  "last_managing_key",
]);

/** The two `provider_error` values. Anything else came from a proxy. */
const providerErrors = new Set<WebshopProviderError>([
  "payment_create_rejected",
  "payment_create_unknown",
]);

/**
 * The `422` codes whose identical request can never succeed.
 *
 * @remarks
 * Core answers `retryable: true` for every `422`, because a resource's state can change. These are
 * the ones the service's own table marks **no**: the cart is gone (`cart_expired`,
 * `cart_converted`), the order will never move (`order_terminal`), the campaign is over
 * (`coupon_invalid`, `coupon_expired`, `coupon_exhausted`), or the carriage is withdrawn
 * (`shipping_method_inactive`). The other `422`s stay retryable: stock arrives, a line is removed,
 * goods are added, a status moves.
 */
const hopelessStateCodes = new Set<WebshopProblemCode>([
  "cart_expired",
  "cart_converted",
  "order_terminal",
  "coupon_invalid",
  "coupon_expired",
  "coupon_exhausted",
  "shipping_method_inactive",
]);

/**
 * The resume rule, attached to every failure that struck once an order existed.
 *
 * @remarks
 * Shared by the `429` and both `502`s, because the mechanics are the same: the key is *lapsed*,
 * not released, so the retry reloads the committed order and retries only the payment.
 */
const resumeRule =
  "The order was committed before this failure and is holding stock. Re-POST the identical checkout with the SAME Idempotency-Key and a byte-identical body — it resumes at the payment and returns that same order. Do not start a new cart and do not mint a new key: either one is a second order.";

const paymentRejectedAdvice = `payment-service refused this shop's credential definitively, so the retry will refuse the same way until an operator fixes the shop's payment credential. ${resumeRule}`;

const paymentUnknownAdvice = `A payment may or may not exist. ${resumeRule}`;

const paymentThrottledAdvice = `The payment throttle fired AFTER the checkout transaction committed, so no payment exists yet. Wait out retryAfter, then: ${resumeRule}`;

const inFlightAdvice =
  "Another attempt under this Idempotency-Key still holds its 60-second lease. Wait a moment and retry the SAME key — a new key would start a second order.";

const keyReusedAdvice =
  "This Idempotency-Key was first used with a different body. Send the original body under this key, or choose a new key deliberately for a genuinely different order.";

/**
 * A 404 on this service means one of three things, and two of them are not "gone".
 *
 * @remarks
 * Another shop's row is a `404`, never a `403` — a `403` would confirm the row exists — and so is a
 * malformed id: a segment that cannot be a UUID never reaches the database. So a `404` on a cart or
 * an order you created is a bug, and quite often the bug is a deployment holding another shop's key.
 */
const notFoundAdvice =
  "A cart or order id you hold should exist. A 404 here also means another shop's row or a malformed id, so check which WEBSHOP_SECRET_KEY this deployment is using before assuming the resource is gone.";

/**
 * Read the service's problem document.
 *
 * @remarks
 * Bound into every request this package makes, so a caller never sees an untranslated status.
 */
export const parseWebshopError = (context: ErrorContext): WebshopApiError => {
  const problem = (
    typeof context.body === "object" && context.body !== null ? context.body : {}
  ) as Record<string, unknown>;
  const init = readProblem(serviceName, context);
  const status = context.status;

  const code =
    init.code !== undefined && problemCodes.has(init.code as WebshopProblemCode)
      ? (init.code as WebshopProblemCode)
      : undefined;
  const providerError =
    status === 502 && providerErrors.has(problem.provider_error as WebshopProviderError)
      ? (problem.provider_error as WebshopProviderError)
      : undefined;
  const onCheckout = context.requestPath.endsWith("/checkout");

  return new WebshopApiError({
    ...init,
    // Narrowed to the documented set: a code the service does not declare came from a proxy.
    code,
    title: typeof problem.title === "string" ? problem.title : "",
    detail: init.message,
    retryable: isRetryable(status, code, providerError, init.retryable),
    ...advice(status, code, providerError, onCheckout),
    ...(providerError === undefined ? {} : { providerError }),
  });
};

/**
 * Whether retrying the identical request can succeed.
 *
 * @remarks
 * Core's verdict is overridden in exactly three places, each from the service's own retry table:
 *
 * - **`502 payment_create_rejected` is not retryable** — the identical request refuses the same way
 *   until the shop's configuration changes. Every other `502` keeps core's `true`: retrying the same
 *   key is always safe here, because the resume path is idempotent by design.
 * - **`409 idempotency_in_flight` is retryable** — the lease is 60 seconds. Core's flat `false` for a
 *   `409` stands for `idempotency_key_reused`.
 * - **Seven `422` codes are not retryable** — see {@link hopelessStateCodes}. Core's `true` stands
 *   for the rest.
 */
function isRetryable(
  status: number,
  code: WebshopProblemCode | undefined,
  providerError: WebshopProviderError | undefined,
  coreVerdict: boolean,
): boolean {
  if (status === 502) return providerError !== "payment_create_rejected";
  if (status === 409) return code === "idempotency_in_flight";
  if (status === 422 && code !== undefined && hopelessStateCodes.has(code)) return false;
  return coreVerdict;
}

/** The note this SDK attaches, where the naive reading of a status strands an order. */
function advice(
  status: number,
  code: WebshopProblemCode | undefined,
  providerError: WebshopProviderError | undefined,
  onCheckout: boolean,
): { advice?: string } {
  if (status === 502 && providerError === "payment_create_rejected") {
    return { advice: paymentRejectedAdvice };
  }
  // An unrecognised `provider_error` still came from the payment step — it is the only 502 source.
  if (status === 502 && onCheckout) return { advice: paymentUnknownAdvice };
  if (status === 429 && onCheckout) return { advice: paymentThrottledAdvice };
  if (code === "idempotency_in_flight") return { advice: inFlightAdvice };
  if (code === "idempotency_key_reused") return { advice: keyReusedAdvice };
  if (status === 404) return { advice: notFoundAdvice };
  return {};
}
