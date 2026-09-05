/**
 * Constructing a storefront client — the `wsk_` tier.
 *
 * @remarks
 * Two constructors per tier, not one client with a tier parameter — see `./public-client.js` for the
 * other. The credentials have different blast radii and different browser rules, and a single object
 * holding a `wsk_` that *can* serve public reads is a `wsk_` that ends up in a client component.
 * Separate constructors mean the import graph shows which tier a module touches.
 *
 * The admin tier (`wad_`), the cron routes and the inbound receiver `/v1/hooks/payment-service` are
 * deliberately unreachable from here.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lazslov/api-core";
import { bindCartMethods, type CartMethods } from "./carts.js";
import { bindCatalogMethods, type CatalogMethods } from "./catalog.js";
import { bindCheckoutMethods, type CheckoutMethods } from "./checkout.js";
import { baseUrlVar, secretKeyVar } from "./env.js";
import { serviceName } from "./errors.js";
import { bindIdentityMethods, type IdentityMethods } from "./identity.js";
import { bindOrderMethods, type OrderMethods } from "./orders.js";

/**
 * The storefront tier: sixteen endpoints.
 *
 * @remarks
 * Catalog reads, the cart and its two checkout choices, the checkout, and order reads and
 * cancellation. Everything a storefront's **backend** calls; a browser belongs on the public tier.
 */
export interface WebshopClient
  extends IdentityMethods,
    CatalogMethods,
    CartMethods,
    CheckoutMethods,
    OrderMethods {}

/**
 * A client for the storefront tier.
 *
 * @param config - Explicit configuration; anything omitted comes from the environment, and anything
 * given wins over it — which is what lets one process hold clients for two shops.
 * @returns The sixteen storefront endpoints.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreateWebshopClient} where a missing configuration should degrade instead.
 * @throws `Error` when constructed in a **browser**, naming rotation rather than hiding.
 * @remarks
 * Reads `WEBSHOP_SERVICE_BASE_URL` and `WEBSHOP_SECRET_KEY` — the second is the knowledge base's
 * own name, kept verbatim.
 *
 * The service has its own tripwire: any `/v1/*` request carrying `Origin` or `Sec-Fetch-Dest` is
 * refused with a `403` **before the key is looked up**. This guard fires earlier still, at
 * construction — by the time that `403` arrives, a `wsk_` key has already shipped to every visitor,
 * and the only remedy left is rotating it.
 *
 * @example
 * ```ts
 * import "server-only";
 * const shop = createWebshopClient();
 * ```
 */
export function createWebshopClient(config: ServiceConfig = {}): WebshopClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: secretKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["wsk_"],
    serviceName,
    envVar: secretKeyVar,
  });

  return {
    ...bindIdentityMethods(resolved),
    ...bindCatalogMethods(resolved),
    ...bindCartMethods(resolved),
    ...bindCheckoutMethods(resolved),
    ...bindOrderMethods(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createWebshopClient}.
 * @returns The client, or `null`.
 * @remarks
 * So a storefront boots and renders — with buying disabled — in an environment that has no
 * credentials, rather than crashing the whole app. A leaked key still throws: that is not a missing
 * configuration.
 */
export function tryCreateWebshopClient(config: ServiceConfig = {}): WebshopClient | null {
  try {
    return createWebshopClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
