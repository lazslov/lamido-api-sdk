/**
 * The environment variables payment-service documents.
 *
 * @remarks
 * Note `PAYMENT_SERVICE_URL`, **not** `_BASE_URL`. The other two services use `_BASE_URL`, and the
 * SDK does not harmonise a name a deployment already sets — a "tidier" variable name that nobody's
 * `.env` contains is an outage on the next deploy.
 */

/** The base URL variable. One host serves sandbox and live alike; mode is a property of the key. */
export const baseUrlVar = "PAYMENT_SERVICE_URL";

/**
 * The merchant key variable.
 *
 * @remarks
 * Server-side only, with no `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` prefix. A `pmk_` key is a
 * full-tenant credential: it can take payments and move money back out.
 */
export const apiKeyVar = "PAYMENT_SERVICE_KEY";

/** The webhook signing secret variable. Only needed if you receive webhooks. */
export const webhookSecretVar = "PAYMENT_SERVICE_WEBHOOK_SECRET";

/**
 * Read an environment variable on a runtime that may not have `process`.
 *
 * @param name - The variable.
 * @returns Its value, or `undefined` — including where there is no environment at all.
 * @remarks
 * Edge runtimes and browsers have no `process`, and reading it unguarded is a `ReferenceError` rather
 * than the configuration error we want to report. `resolveConfig` does this for the two client
 * variables; the webhook secret is read outside a client, in a route handler.
 */
export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}
