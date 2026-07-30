/**
 * `@lamido/content` — consumer SDK for content-service.
 *
 * @remarks
 * Phase 1 ships the package shell only. The website and client tiers, the field-descriptor
 * layer and asset handling arrive in `docs/plans/phase-3-content.md`; the Next.js cache
 * modes in phase 6. Request and response *shapes* are already generated into
 * `src/generated/schema.ts` from the pinned contract, and phase 3 curates them into named
 * aliases carrying the behaviour the OpenAPI document cannot express.
 */

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that
 * disagrees with the tarball it came from.
 */
export const VERSION = "0.1.0";
