# @lazslov/content

## 0.1.0

Verified against knowledge base `0bca8b0`: content-service `d7b5c46`, invoice-service `f5af0dc`,
payment-service `586eede`.

### Minor Changes

First release. Both consumer tiers of content-service, and nothing from the admin tier.

- **Website tier** (`cpk_`, browser-safe) and **client tier** (`csk_`, server only), as two
  client constructors rather than one client with a mode flag.
- `getPage` and the other documented reads answer `null` on a `404` and throw on everything
  else — a `401` is a configuration problem, not absent content.
- `page.section(key)` returns an empty section rather than `null`, so a template renders through
  a missing section instead of crashing on one.
- `./fields` — the field-descriptor layer: `prepareValues` diffs a submission against what is
  stored and returns only what changed, with a per-field error for anything malformed. Types and
  validation only; rendering stays in each site.
- `./next` — the three cache modes, the revalidation route handler, and `asSaveResult` for
  server actions. `next` is an optional peer; the main entry imports nothing from it.
- `verifyRevalidationWebhook`, covering the documented `slug: null` and `version: null` payloads.

No exported method writes a whole document or a whole list, and `getHealth` returns the degraded
body on a `503` rather than throwing.
