/**
 * `@lamido/invoice` — consumer SDK for invoice-service.
 *
 * @remarks
 * Phase 1 ships the package shell only. The client tier, the idempotency contract — where
 * a key is consumed even when the request fails — and the PDF paths arrive in
 * `docs/plans/phase-4-invoice.md`. Request and response *shapes* are already generated into
 * `src/generated/schema.ts` from the pinned contract.
 */

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that
 * disagrees with the tarball it came from.
 */
export const VERSION = "0.1.0";
