/**
 * The environment variables this package reads, in one place.
 *
 * @remarks
 * The knowledge base documents the two credentials and the webhook secret, but not a variable name
 * for any of them: the service folder is written for the service's own deployment, whose variables
 * (`SERVICE_BASE_URL`, `OAUTH_STATE_SECRET`) belong to auth-service and never to a consumer. The four
 * names below are therefore the SDK's proposal, on the `<SERVICE>_SERVICE_<THING>` pattern that
 * content-service and invoice-service already document for theirs.
 */

/** The base URL variable. Proposed by the SDK. Read it — never hardcode the host; there is no default. */
export const baseUrlVar = "AUTH_SERVICE_BASE_URL";

/**
 * The `apk_` publishable website key, for a browser signing people or customers in.
 *
 * @remarks
 * Proposed by the SDK. Publishable by design: it ships in front-end JavaScript, it identifies **which
 * website** a browser is signing into, and it grants nothing beyond that website's own public surface.
 * Anyone who can view the site can read it out of the bundle.
 */
export const publishableKeyVar = "AUTH_SERVICE_PUBLISHABLE_KEY";

/**
 * The `ask_` secret application key, for a backend calling the client tier.
 *
 * @remarks
 * Proposed by the SDK. A **server** variable only, with no `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_`
 * prefix: it is bound to one organization and it answers the authorization decision for every
 * principal in it.
 */
export const applicationKeyVar = "AUTH_SERVICE_APPLICATION_KEY";

/** The webhook signing secret variable. Proposed by the SDK. Only needed if you receive events. */
export const webhookSecretVar = "AUTH_SERVICE_WEBHOOK_SECRET";

/**
 * Read an environment variable on a runtime that may not have `process`.
 *
 * @param name - The variable.
 * @returns Its value, or `undefined` — including where there is no environment at all.
 * @remarks
 * Edge runtimes and browsers have no `process`, and reading it unguarded is a `ReferenceError` rather
 * than the configuration error we want to report. `resolveConfig` does this for the client variables;
 * the webhook secret is read outside a client, in a route handler.
 */
export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}
