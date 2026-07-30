# @lamido/content

Consumer SDK for content-service — pages, sections and collections for content, datasets for
the application data a client site would otherwise need a database for, and images on the
CDN.

**Status: phase 1.** The package builds and publishes, and exports nothing but `VERSION`.
The website and client tiers arrive in phase 3 and the Next.js cache modes in phase 6 — see
`docs/plans/` in the repository.

## Install

```sh
pnpm add @lamido/content
```

## Configuration comes from your environment

```ini
CONTENT_SERVICE_BASE_URL=https://content.example.com
CONTENT_SERVICE_SECRET_KEY=csk_YOUR_SECRET_KEY
```

There is **no fallback host**. A missing base URL is a configuration error the SDK reports,
never a silent default, and no host, key or tenant identifier is baked into this package.

`csk_` is a server-only key. The browser-safe tier is `cpk_`
(`CONTENT_SERVICE_PUBLISHABLE_KEY`) — the only one of the three services that has one.

## Licence

MIT.
