/**
 * Constructing a website-tier client.
 *
 * @remarks
 * Two constructors per tier, not one client with a tier parameter. The credentials have different
 * blast radii and different browser rules, and a single object holding a `csk_` that *can* serve
 * public reads is a `csk_` that ends up in a client component. Separate constructors mean the
 * import graph shows which tier a module touches.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lazslov/api-core";
import { baseUrlVar, publishableKeyVar, readEnv, secretKeyVar } from "../env.js";
import { serviceName } from "../errors.js";
import { bindWebsiteReads, type WebsiteClient } from "./reads.js";

/**
 * A client for the published read tier.
 *
 * @param config - Explicit configuration. Every field is optional; anything omitted comes from the
 * environment, and anything given wins over it — which is what lets one process hold clients for
 * two tenants.
 * @returns The six published reads plus health.
 * @throws {@link NotConfiguredError} when neither the argument nor the environment supplies a base
 * URL and a key. Use {@link tryCreateWebsiteClient} where a missing configuration should degrade
 * instead.
 * @throws `Error` when a `csk_` key is used in a browser. A `cpk_` is fine there — that is the
 * whole point of the tier — so the guard is applied per key rather than per client.
 * @remarks
 * Reads `CONTENT_SERVICE_BASE_URL`, then `CONTENT_SERVICE_PUBLISHABLE_KEY`, falling back to
 * `CONTENT_SERVICE_SECRET_KEY`. The fallback is deliberate: this tier accepts a secret key, so a
 * server-rendered site does not need a second credential just to read.
 *
 * @example
 * ```ts
 * import "server-only";               // a build error, not a code review
 * const content = createWebsiteClient();
 * const page = await content.getPage("home");
 * ```
 */
export function createWebsiteClient(config: ServiceConfig = {}): WebsiteClient {
  const apiKey = config.apiKey ?? readEnv(publishableKeyVar) ?? readEnv(secretKeyVar);

  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: publishableKeyVar },
    config: { ...config, ...(apiKey === undefined ? {} : { apiKey }) },
  });

  // Only a secret key is server-only here. Named with the variable it most likely came from, so
  // the message says which one to move.
  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["csk_"],
    serviceName,
    envVar: secretKeyVar,
  });

  return bindWebsiteReads(resolved);
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createWebsiteClient}.
 * @returns The client, or `null`.
 * @remarks
 * This is what lets a site **boot, render and be clickable with no `CONTENT_SERVICE_*` variables
 * set at all** — how a new contributor runs the project, and how a flow stays playable without
 * handing out a production credential. Reads then degrade to empty collections and placeholder
 * images rather than crashing.
 *
 * A browser holding a `csk_` still throws: that is a leak, not a missing configuration.
 *
 * @example
 * ```ts
 * const content = tryCreateWebsiteClient();
 * const page = (await content?.getPage("home")) ?? null;   // renders placeholders when unset
 * ```
 */
export function tryCreateWebsiteClient(config: ServiceConfig = {}): WebsiteClient | null {
  try {
    return createWebsiteClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
