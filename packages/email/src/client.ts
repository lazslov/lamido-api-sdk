/**
 * Constructing a tenant client.
 *
 * @remarks
 * One client, because there is one consumer credential — and there is deliberately no publishable
 * tier to build a second one for. The admin tier (`ead_`), the provider callbacks
 * (`/v1/providers/*`), the house-event receivers (`/v1/hooks/*`) and the cron are unreachable from
 * here.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lazslov/api-core";
import { apiKeyVar, baseUrlVar } from "./env.js";
import { serviceName } from "./errors.js";
import { bindMessageMethods, type MessageMethods } from "./messages.js";
import { bindOauthMethods, type OauthMethods } from "./oauth.js";

/**
 * The tenant tier: five endpoints.
 *
 * @remarks
 * No path here takes a tenant id, because the key *is* the scope — one tenant can never see
 * another's messages. There is no template management, no batch send, no raw HTML and no way to
 * remove a suppression: each is absent from the service on purpose, so it is absent here too.
 */
export interface EmailClient extends MessageMethods, OauthMethods {}

/**
 * A client for the tenant tier.
 *
 * @param config - Explicit configuration; anything omitted comes from the environment, and anything
 * given wins over it — which is what lets one process hold clients for two tenants.
 * @returns The five tenant endpoints.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreateEmailClient} where a missing configuration should degrade instead.
 * @throws `Error` when constructed in a **browser**, naming rotation rather than hiding.
 * @remarks
 * Reads `EMAIL_SERVICE_BASE_URL` and `EMAIL_SERVICE_API_KEY` — both names the knowledge base
 * documents.
 *
 * The browser guard matters more here than on a payment key. The service's own tripwire refuses
 * any `/v1/*` request carrying `Origin` or `Sec-Fetch-Dest` with a `403` **before authentication
 * runs**, but by the time that `403` arrives an `esk_` key has shipped to every visitor — and a
 * leaked payment key yields a link a victim must still choose to pay, where a leaked `esk_` yields
 * *the email that convinces them to*, DKIM-signed from a domain they already trust. This guard
 * fires earlier, at construction. It is a tripwire and not a boundary: keep `import "server-only"`
 * at the top of the module that calls this.
 *
 * @example
 * ```ts
 * import "server-only";
 * const email = createEmailClient();
 * ```
 */
export function createEmailClient(config: ServiceConfig = {}): EmailClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: apiKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["esk_"],
    serviceName,
    envVar: apiKeyVar,
  });

  return {
    ...bindMessageMethods(resolved),
    ...bindOauthMethods(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createEmailClient}.
 * @returns The client, or `null`.
 * @remarks
 * So an order flow completes — with the confirmation email skipped, or queued for later — in a
 * deployment that has no credentials, rather than crashing the whole app. A leaked key still
 * throws: that is not a missing configuration.
 */
export function tryCreateEmailClient(config: ServiceConfig = {}): EmailClient | null {
  try {
    return createEmailClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
