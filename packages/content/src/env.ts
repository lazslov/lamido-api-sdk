/**
 * The environment variables content-service documents, in one place.
 *
 * @remarks
 * Named here rather than in `@lamido/api-core`, which knows no variable name for any service: the
 * three do not even agree on a pattern, and core is the module that must stay service-agnostic.
 */

/** The base URL variable. Read it — never hardcode the host; there is no default. */
export const baseUrlVar = "CONTENT_SERVICE_BASE_URL";

/** The `csk_` secret key: read, write, publish, drafts. A **server** variable only. */
export const secretKeyVar = "CONTENT_SERVICE_SECRET_KEY";

/**
 * The `cpk_` publishable key, for a website that reads from a browser.
 *
 * @remarks
 * Public by design: it scopes a request to one site and lets staff revoke it, and it keeps nothing
 * secret. Anyone who can view the site can read it out of the bundle.
 */
export const publishableKeyVar = "CONTENT_SERVICE_PUBLISHABLE_KEY";

/**
 * The revalidation webhook's shared secret.
 *
 * @remarks
 * Not an API key: it is the string staff passed as `revalidateSecret` when the site was created, and
 * it signs deliveries in **one** direction — the service to you. It is per site, which is why a
 * receiver does not need to check the payload's `site` field.
 *
 * Rotating it on the service without updating it here rejects every delivery, silently, until both
 * agree.
 */
export const revalidateSecretVar = "CONTENT_REVALIDATE_SECRET";

/**
 * Read an environment variable on a runtime that may not have `process`.
 *
 * @param name - The variable.
 * @returns Its value, or `undefined` — including where there is no environment at all.
 * @remarks
 * Edge runtimes and browsers have no `process`, and reading it unguarded is a `ReferenceError`
 * rather than the configuration error we want to report.
 */
export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}
