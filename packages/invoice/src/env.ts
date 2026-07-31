/**
 * The environment variables invoice-service documents, in one place.
 *
 * @remarks
 * Named here rather than in `@lamido/api-core`, which knows no variable name for any service: the
 * three do not agree on a pattern, and core is the module that must stay service-agnostic.
 */

/**
 * The base URL variable.
 *
 * @remarks
 * conventions §1 states the rule as an instruction to consumers — *never hardcode the base URL* —
 * and names this variable so a staging deployment can be pointed at without a code change. There
 * is no default host here, in this package or in core.
 */
export const baseUrlVar = "INVOICE_SERVICE_BASE_URL";

/**
 * The `isk_` client key variable.
 *
 * @remarks
 * Server-side only, with no `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` prefix: an `isk_` key can read
 * every invoice of its tenant and issue real stornos. The name is the SDK's proposal — the
 * knowledge base documents the base URL variable and leaves the key's name to the integrator — and
 * an explicit `apiKey` in the config always wins over it.
 */
export const clientKeyVar = "INVOICE_SERVICE_CLIENT_KEY";
