/**
 * Constructing a client-tier client: the tier that writes.
 *
 * @remarks
 * A `csk_` key can write and publish every word on the site and read every unpublished draft. It
 * belongs in a server environment variable and nowhere else, which is what {@link createContentClient}
 * refuses to let a browser do.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lamido/api-core";
import { baseUrlVar, secretKeyVar } from "../env.js";
import { serviceName } from "../errors.js";
import { type AssetMethods, bindAssetMethods } from "./assets.js";
import { bindCollectionMethods, type CollectionMethods } from "./collections.js";
import { bindDatasetMethods, type DatasetMethods } from "./datasets.js";
import { bindIdentityMethods, type IdentityMethods } from "./identity.js";
import { bindPageMethods, type PageMethods } from "./pages.js";

/**
 * The editor-facing write tier.
 *
 * @remarks
 * Composed from four concerns — pages, collections, assets and datasets — plus the identity check. It
 * carries no admin endpoint: structure is defined by Lamido staff on a tier this package does not
 * reach, and no path here takes a site id, because the key *is* the scope.
 */
export interface ContentClient
  extends IdentityMethods,
    PageMethods,
    CollectionMethods,
    AssetMethods,
    DatasetMethods {}

/**
 * A client for the write tier.
 *
 * @param config - Explicit configuration; anything omitted comes from the environment.
 * @returns Every consumer-facing client-tier endpoint.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreateContentClient} where a missing configuration should degrade instead.
 * @throws `Error` when constructed in a **browser**. The message says to rotate the key, not to hide
 * it: a key that reached a bundle has been published to every visitor already.
 * @remarks
 * Reads `CONTENT_SERVICE_BASE_URL` and `CONTENT_SERVICE_SECRET_KEY`. The browser guard runs at
 * construction rather than per request, so the accident — a gateway module imported into a client
 * component — surfaces at the earliest possible moment. It is a tripwire and not a boundary: keep
 * `import "server-only"` at the top of the module that calls this, because a build error beats a
 * runtime throw.
 *
 * @example
 * ```ts
 * import "server-only";
 * const content = createContentClient();
 *
 * const prepared = prepareValues(ABOUT, submitted, page.section("about").fields);
 * if (!prepared.ok) return { ok: false, errors: prepared.errors };
 * if (Object.keys(prepared.values).length > 0) {
 *   await content.patchValues("home", prepared.values);
 * }
 * ```
 */
export function createContentClient(config: ServiceConfig = {}): ContentClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: secretKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["csk_"],
    serviceName,
    envVar: secretKeyVar,
  });

  return {
    ...bindIdentityMethods(resolved),
    ...bindPageMethods(resolved),
    ...bindCollectionMethods(resolved),
    ...bindAssetMethods(resolved),
    ...bindDatasetMethods(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createContentClient}.
 * @returns The client, or `null`.
 * @remarks
 * What lets an editor route render — disabled, or behind a "not configured" notice — in a checkout
 * with no credentials, rather than crashing the whole app. A browser still throws: that is a leak,
 * not a missing configuration.
 */
export function tryCreateContentClient(config: ServiceConfig = {}): ContentClient | null {
  try {
    return createContentClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
