/**
 * The environment variables this package reads, in one place.
 *
 * @remarks
 * Named here rather than in `@lazslov/api-core`, which knows no variable name for any service.
 * Two of the three names come from the knowledge base itself; the third is this SDK's proposal,
 * and the doc comment on each says which.
 */

/**
 * The base URL variable.
 *
 * @remarks
 * Documented by the knowledge base: conventions §1 states *never hardcode the base URL* and names
 * this variable, so a staging deployment can be targeted without a code change. There is no
 * default host here, in this package or in core.
 */
export const baseUrlVar = "EMAIL_SERVICE_BASE_URL";

/**
 * The `esk_` tenant key variable.
 *
 * @remarks
 * Documented by the knowledge base: the Node integration snippet in workflows.md reads exactly
 * this name. Server-side only, with no `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` prefix — an `esk_`
 * key authorises every send for the tenant, DKIM-signed from a domain the recipient trusts.
 */
export const apiKeyVar = "EMAIL_SERVICE_API_KEY";

/**
 * The webhook signing secret variable. Only needed if you receive webhooks.
 *
 * @remarks
 * This name is the SDK's proposal, not the knowledge base's: the service documents no variable
 * for the receiver's copy of a `whsec_` secret. It follows the two names above. An explicit
 * `secret` on the route handler always wins over it.
 */
export const webhookSecretVar = "EMAIL_SERVICE_WEBHOOK_SECRET";

/**
 * Read an environment variable on a runtime that may not have `process`.
 *
 * @param name - The variable.
 * @returns Its value, or `undefined` — including where there is no environment at all.
 * @remarks
 * Edge runtimes and browsers have no `process`, and reading it unguarded is a `ReferenceError`
 * rather than the configuration error we want to report. `resolveConfig` does this for the two
 * client variables; the webhook secret is read outside a client, in a route handler.
 */
export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}
