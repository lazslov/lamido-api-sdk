# @lamido/api-core

Transport, error base, configuration, HMAC signature verification and pagination shared by
the `@lamido/*` service SDKs.

**Status: phase 1.** The package builds and publishes, and exports nothing but `VERSION`.
The pieces above arrive in phase 2 — see `docs/plans/phase-2-api-core.md` in the repository.

You do not install this directly. Install `@lamido/content`, `@lamido/invoice` or
`@lamido/payment`; each depends on this package and nothing else.

## Why it is a separate package

The HMAC signature verifier is security-sensitive and must exist in exactly one place, so
that fixing it is `pnpm update @lamido/api-core` rather than three coordinated releases.

## Zero runtime dependencies

Everything is a platform API: `fetch`, `AbortController`, `URL` and
`globalThis.crypto.subtle`. Node 18.17+, or any modern edge runtime.

## No host, no key, ever

Nothing about a deployment ships in this package — no base URL, no key, no tenant
identifier, not even as a default. The consuming project supplies its base URL from its own
environment, and a missing one is a configuration error rather than a silent fallback.

## Licence

MIT.
