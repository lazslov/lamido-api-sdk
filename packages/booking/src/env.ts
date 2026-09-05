/**
 * The environment variables this package reads.
 *
 * @remarks
 * booking-service documents no variable names of its own — its knowledge base names the key
 * prefixes and the base URL, not what a deployment calls them. The SDK therefore **proposes**
 * these three, in the `<SERVICE>_SERVICE_<THING>` shape the other packages use, and the live
 * suite and the docs are written to them.
 */

/** The base URL variable. Proposed by the SDK; there is no default host. */
export const baseUrlVar = "BOOKING_SERVICE_BASE_URL";

/**
 * The `bpk_` publishable key, for a booking widget that runs in a browser.
 *
 * @remarks
 * Public by design: it ships in page source, reads the catalogue and availability, takes holds,
 * and creates a booking only where the tenant opted in. Proposed by the SDK.
 */
export const publishableKeyVar = "BOOKING_SERVICE_PUBLISHABLE_KEY";

/**
 * The `bsk_` secret key: everything a tenant can do to its own data. A **server** variable only.
 *
 * @remarks
 * No `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` prefix, ever. The service refuses a browser-shaped
 * request on this tier before authentication and treats the key as burned. Proposed by the SDK.
 */
export const secretKeyVar = "BOOKING_SERVICE_SECRET_KEY";

/** The webhook signing secret variable. Only needed if you receive webhooks. Proposed by the SDK. */
export const webhookSecretVar = "BOOKING_SERVICE_WEBHOOK_SECRET";

/**
 * Read an environment variable on a runtime that may not have `process`.
 *
 * @param name - The variable.
 * @returns Its value, or `undefined` — including where there is no environment at all.
 * @remarks
 * Edge runtimes and browsers have no `process`, and reading it unguarded is a `ReferenceError`
 * rather than the configuration error we want to report. The public constructor runs in a
 * browser on purpose, so this guard is load-bearing here rather than defensive.
 */
export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}
