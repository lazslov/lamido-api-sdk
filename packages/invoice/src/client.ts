/**
 * Constructing a client-tier client.
 *
 * @remarks
 * One client, because there is one consumer credential. The admin tier (`iad_`) is the larger half of
 * this service and is operator-only, so it is deliberately unreachable from here.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lazslov/api-core";
import { bindCancelMethod, type CancelMethods } from "./cancel.js";
import { bindCreateMethod, type CreateMethods } from "./create.js";
import { bindDocumentMethods, type DocumentMethods } from "./documents.js";
import { baseUrlVar, clientKeyVar } from "./env.js";
import { serviceName } from "./errors.js";
import { bindHealthMethod, type HealthMethods } from "./health.js";
import { bindReadMethods, type ReadMethods } from "./reads.js";

/**
 * The client tier: six endpoints plus the public health check.
 *
 * @remarks
 * No path here takes a client id, because the key *is* the scope — one tenant can never see another's
 * invoices. There is no admin endpoint, no reconciliation and no credential management: those need an
 * `iad_` key, which is a full-tenant credential and belongs to a back office.
 */
export interface InvoiceClient
  extends CreateMethods,
    ReadMethods,
    DocumentMethods,
    CancelMethods,
    HealthMethods {}

/**
 * A client for the client tier.
 *
 * @param config - Explicit configuration; anything omitted comes from the environment, and anything
 * given wins over it — which is what lets one process hold clients for two tenants.
 * @returns Every consumer-facing client-tier endpoint.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreateInvoiceClient} where a missing configuration should degrade instead.
 * @throws `Error` when constructed in a **browser**.
 * @remarks
 * Reads `INVOICE_SERVICE_BASE_URL` and `INVOICE_SERVICE_CLIENT_KEY`.
 *
 * The browser guard is worth more here than it looks. **No CORS headers are served on any route**, so a
 * browser `fetch` fails regardless — but it fails opaquely, as a CORS error that reads like a
 * deployment problem, and by then the `isk_` key has shipped to every visitor. The guard turns that
 * into a legible error at construction, and its message says to rotate rather than to hide: a key that
 * reached a bundle is already published.
 *
 * It is a tripwire and not a boundary. Keep `import "server-only"` at the top of the module that calls
 * this — a build error beats a runtime throw.
 *
 * @example
 * ```ts
 * import "server-only";
 * const invoices = createInvoiceClient();
 * const invoice = await invoices.getInvoice(id);
 * ```
 */
export function createInvoiceClient(config: ServiceConfig = {}): InvoiceClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: clientKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["isk_"],
    serviceName,
    envVar: clientKeyVar,
  });

  return {
    ...bindCreateMethod(resolved),
    ...bindReadMethods(resolved),
    ...bindDocumentMethods(resolved),
    ...bindCancelMethod(resolved),
    ...bindHealthMethod(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createInvoiceClient}.
 * @returns The client, or `null`.
 * @remarks
 * So an order route renders — with invoicing disabled, or behind a "not configured" notice — in a
 * deployment that has no credentials, rather than crashing the whole app. A leaked key still throws:
 * that is not a missing configuration.
 */
export function tryCreateInvoiceClient(config: ServiceConfig = {}): InvoiceClient | null {
  try {
    return createInvoiceClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
