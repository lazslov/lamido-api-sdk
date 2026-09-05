/**
 * The environment variables this package reads.
 *
 * @remarks
 * One name is the knowledge base's and three are the SDK's own proposals. The distinction matters:
 * a documented name is one a deployment may already set, so the SDK keeps it verbatim even where it
 * breaks the estate's `<SERVICE>_SERVICE_<ROLE>` pattern.
 */

/**
 * The base URL variable. **An SDK proposal** — the knowledge base documents the host itself, never a
 * variable name for it. There is no default host.
 */
export const baseUrlVar = "WEBSHOP_SERVICE_BASE_URL";

/**
 * The `wpk_` publishable key variable. **An SDK proposal.**
 *
 * @remarks
 * Public by design: it scopes a request to one shop's published catalog and lets an operator revoke
 * it. It ships in page source, and the service protects the tier with a per-IP throttle rather than
 * with the key. Prefix it for your bundler (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`) when a browser reads
 * it — this SDK reads the bare name on a server.
 */
export const publishableKeyVar = "WEBSHOP_PUBLISHABLE_KEY";

/**
 * The `wsk_` secret key variable.
 *
 * @remarks
 * **The knowledge base's own name**: the integration snippet in `workflows.md` §1 reads
 * `process.env.WEBSHOP_SECRET_KEY`. It breaks the other packages' `_SERVICE_` pattern, and the SDK
 * keeps it rather than harmonising it — a tidier variable name that nobody's `.env` contains is an
 * outage on the next deploy. Server-side only: a `wsk_` key can check out and read every order.
 */
export const secretKeyVar = "WEBSHOP_SECRET_KEY";

/** The webhook signing secret variable. **An SDK proposal.** Only needed if you receive events. */
export const webhookSecretVar = "WEBSHOP_WEBHOOK_SECRET";

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
