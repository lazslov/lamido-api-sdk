/**
 * Constructing a public catalog client — the `wpk_` tier.
 *
 * @remarks
 * The browser-safe half. A `wpk_` key is public by design: it scopes a request to one shop's
 * published catalog, read only, and the service protects the tier with a per-IP throttle rather than
 * with the key. There is no cart, checkout or order on this tier — an order carries a postal address
 * and an email address, and a key that ships in page source must never reach either.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lazslov/api-core";
import { baseUrlVar, publishableKeyVar, secretKeyVar } from "./env.js";
import { serviceName } from "./errors.js";
import { bindPublicCatalogMethods, type PublicCatalogMethods } from "./public-catalog.js";

/**
 * The public tier: two `GET`s, with their caching contract.
 *
 * @remarks
 * Constructed with a `wpk_` publishable key, which may ship in a browser bundle. A cross-origin
 * browser read works: both halves of the CORS exchange carry `Access-Control-Allow-Origin`, and
 * `Access-Control-Expose-Headers: ETag, X-Request-Id` makes the validator readable. Note there is
 * **no origin restriction of any kind** — every origin that asks is answered.
 */
export interface WebshopPublicClient extends PublicCatalogMethods {}

/**
 * A client for the public catalog.
 *
 * @param config - Explicit configuration; anything omitted comes from the environment.
 * @returns The two public reads.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreateWebshopPublicClient} where a missing configuration should degrade instead.
 * @throws `Error` when a `wsk_` key is used in a browser. A `wpk_` is fine there — that is the whole
 * point of the tier — so the guard is applied per key rather than per client.
 * @remarks
 * Reads `WEBSHOP_SERVICE_BASE_URL` and `WEBSHOP_PUBLISHABLE_KEY`. There is deliberately **no
 * fallback to the secret key**: the path names the credential, and a `wsk_` on `/v1/public` is a
 * `403` from the service. A server-rendered storefront that already holds a `wsk_` reads the same
 * catalog shapes through `createWebshopClient` instead — without cache headers.
 *
 * @example
 * ```ts
 * const catalog = createWebshopPublicClient({ apiKey: process.env.NEXT_PUBLIC_WEBSHOP_PUBLISHABLE_KEY });
 * const first = await catalog.listProducts({ limit: 24 });
 * // …a minute later:
 * const again = await catalog.listProducts({ limit: 24, ifNoneMatch: first.etag ?? "" });
 * if (!again.notModified) render(again.value.items);
 * ```
 */
export function createWebshopPublicClient(config: ServiceConfig = {}): WebshopPublicClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: publishableKeyVar },
    config,
  });

  // Only a secret key is server-only here. Named with the variable it most likely came from, so the
  // message says which one to move.
  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["wsk_"],
    serviceName,
    envVar: secretKeyVar,
  });

  return bindPublicCatalogMethods(resolved);
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createWebshopPublicClient}.
 * @returns The client, or `null`.
 * @remarks
 * This is what lets a storefront boot with no `WEBSHOP_*` variables set at all: the catalog degrades
 * to an empty list rather than a crash. A browser holding a `wsk_` still throws — that is a leak, not
 * a missing configuration.
 */
export function tryCreateWebshopPublicClient(
  config: ServiceConfig = {},
): WebshopPublicClient | null {
  try {
    return createWebshopPublicClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
