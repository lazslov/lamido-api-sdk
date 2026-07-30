/**
 * `@lamido/payment` — consumer SDK for payment-service.
 *
 * @remarks
 * Phase 1 ships the package shell only. The merchant tier, the money type — decimal strings
 * in minor units, with HUF zero-decimal — 502 triage and webhook verification arrive in
 * `docs/plans/phase-5-payment.md`. Request and response *shapes* are already generated into
 * `src/generated/schema.ts` from the pinned contract.
 *
 * This package must never reach a browser bundle: a `pmk_` key is full-merchant authority.
 */

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that
 * disagrees with the tarball it came from.
 */
export const VERSION = "0.1.0";
