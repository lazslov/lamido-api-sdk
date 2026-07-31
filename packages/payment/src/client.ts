/**
 * Constructing a merchant client.
 *
 * @remarks
 * One client, because there is one consumer credential. The admin tier (`pad_`) and the provider
 * callback routes (`/v1/providers/*`, inbound PSP traffic) are deliberately unreachable from here.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lamido/api-core";
import { bindDeliveryMethods, type DeliveryMethods } from "./deliveries.js";
import { apiKeyVar, baseUrlVar } from "./env.js";
import { serviceName } from "./errors.js";
import { bindPaymentMethods, type PaymentMethods } from "./payments.js";
import { bindRefundMethods, type RefundMethods } from "./refunds.js";

/**
 * The merchant tier: seven endpoints.
 *
 * @remarks
 * There is no `sandbox` or `live` option, no test hostname and no `test: true` flag, because **mode is
 * a property of the credential**. The client exposes no way to ask for one, since asking would imply
 * it exists — and a preview deployment cannot reach live money at all: the service refuses to
 * construct a live PSP adapter outside production.
 */
export interface PaymentClient extends PaymentMethods, RefundMethods, DeliveryMethods {}

/**
 * A client for the merchant tier.
 *
 * @param config - Explicit configuration; anything omitted comes from the environment, and anything
 * given wins over it.
 * @returns The seven merchant endpoints.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreatePaymentClient} where a missing configuration should degrade instead.
 * @throws `Error` when constructed in a **browser**, naming rotation rather than hiding.
 * @remarks
 * Reads `PAYMENT_SERVICE_URL` — note `_URL`, not `_BASE_URL` — and `PAYMENT_SERVICE_KEY`.
 *
 * The browser guard is the strictest of the three packages, because the service has its own tripwire:
 * any request to `/v1/*` carrying an `Origin` header or `Sec-Fetch-Mode: cors` is rejected with a
 * `403` **before authentication runs**. This guard fires earlier still, at construction — by the time
 * that 403 arrives, a `pmk_` key has already shipped to every visitor, and the only remedy left is
 * rotating it.
 *
 * @example
 * ```ts
 * import "server-only";
 * const payments = createPaymentClient();
 * ```
 */
export function createPaymentClient(config: ServiceConfig = {}): PaymentClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: apiKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["pmk_"],
    serviceName,
    envVar: apiKeyVar,
  });

  return {
    ...bindPaymentMethods(resolved),
    ...bindRefundMethods(resolved),
    ...bindDeliveryMethods(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createPaymentClient}.
 * @returns The client, or `null`.
 * @remarks
 * So a checkout page renders — with payment disabled — in a checkout that has no credentials, rather
 * than crashing the whole app. A leaked key still throws: that is not a missing configuration.
 */
export function tryCreatePaymentClient(config: ServiceConfig = {}): PaymentClient | null {
  try {
    return createPaymentClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
