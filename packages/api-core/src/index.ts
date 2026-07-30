/**
 * `@lamido/api-core` — the pieces every `@lamido/*` service SDK shares.
 *
 * @remarks
 * Phase 1 ships this package empty on purpose: a factory that can safely build and
 * publish nothing, so phase 2 can only add correct things to it. The transport, error
 * base, configuration resolver, HMAC verifier and paginator arrive in
 * `docs/plans/phase-2-api-core.md`.
 */

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that
 * disagrees with the tarball it came from. Useful in a `User-Agent` once phase 2 has a
 * transport to set one on.
 */
export const VERSION = "0.1.0";
