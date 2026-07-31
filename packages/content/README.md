# @lamido/content

Consumer SDK for content-service — pages, sections and collections for content, datasets for
the application data a client site would otherwise need a database for, and images on the
CDN.

**Status: phase 3.** Both consumer tiers and the field-descriptor layer are here. The Next.js
cache modes and the revalidation route handler arrive in phase 6 — see `docs/plans/` in the
repository.

## Install

```sh
pnpm add @lamido/content
```

Zero runtime dependencies except `@lamido/api-core`, which is the shared transport.

## Configuration comes from your environment

```ini
CONTENT_SERVICE_BASE_URL=https://content.example.com
CONTENT_SERVICE_SECRET_KEY=csk_YOUR_SECRET_KEY
CONTENT_SERVICE_PUBLISHABLE_KEY=cpk_YOUR_PUBLISHABLE_KEY   # optional; browser-safe reads
```

There is **no fallback host**. A missing base URL is a configuration error the SDK reports,
never a silent default, and no host, key or tenant identifier is baked into this package.

`csk_` is a server-only key: it can write and publish every word on the site and read every
unpublished draft. A `csk_` that reached a browser bundle must be **rotated**, not hidden.

## Two clients, because there are two credentials

```ts
import "server-only"; // a build error, not a code review, if a client component imports this
import { createWebsiteClient, createContentClient } from "@lamido/content";

const site = createWebsiteClient(); // /api/content/* — published reads, cpk_ or csk_
const editor = createContentClient(); // /api/client/* — drafts and writes, csk_ only
```

Not one client with a tier parameter: a single object holding a `csk_` that *can* serve public
reads is a `csk_` that ends up in a client component. Separate constructors mean the import
graph shows which tier a module touches.

`tryCreateWebsiteClient()` and `tryCreateContentClient()` return `null` instead of throwing
when nothing is configured, so a fresh checkout with no `.env` still boots, renders and is
clickable. A leaked key still throws — that is not a missing configuration.

## Reading degrades one section at a time

```ts
const page = await site.getPage("home"); // null when unpublished — a 404 is not an error
const hero = page?.section("hero"); // never null, even for a section that is absent
```

| Behaviour | Why |
| --- | --- |
| `getPage`, `getCollection`, `getCollectionItem`, `getRecord` return `T \| null` | a `404` is what an unpublished page and an undefined collection answer — the normal state of a freshly provisioned site |
| every other status throws | a `401` must not render as an empty page |
| `page.section(key)` is never `null` | one unpublished section cannot take a route down |
| `getDatasetAggregate` returns `null` when the aggregate is not public | **`null` means unknown and must hide the UI.** A progress bar at 0% is a lie about money |
| `getHealth()` returns the body of a `503` | that is where the reason is; a monitor checking `response.ok` first never sees it |

## The field-descriptor layer

`@lamido/content/fields` imports nothing — no transport, no credential handling — so a client
component and a server action can share it.

```ts
import { asImage, asRows, asText, prepareValues } from "@lamido/content/fields";

const title = asText(hero.fields, "title"); // "" for both absent and stored ""
const photo = asImage(hero.fields, "photo"); // null for a deleted asset, never a broken src
const stats = asRows(hero.fields, "stats", ABOUT_ENTRY); // columns picked one by one
```

You own the descriptor tables — labels and help text are product copy. The SDK owns the types,
the coercions and the write preparer:

```ts
const prepared = prepareValues(ABOUT, submitted, page.section("about").fields);
if (!prepared.ok) return { ok: false, errors: prepared.errors }; // per field, for the editor
if (Object.keys(prepared.values).length === 0) return { ok: true }; // no request at all
await editor.patchValues("home", prepared.values);
```

`prepareValues` iterates the **descriptor**, never the submission: a server action is a public
endpoint, and the service answers `400` for one unknown value key rather than dropping it
silently, so a single stray field would fail the whole save.

`isValidContentUrl` mirrors the service's own `url` rule exactly — `https://`, `http://`,
`mailto:`, `tel:`, `/path`, `#anchor` — so a browser form and a server action can block the
same values from one predicate. It is mirrored deliberately; do not "improve" it out of sync.

## Writing: the save unit is the row, not the document

There is no method here that writes a whole document or a whole list. A whole-list save is
last-write-wins by construction, and in the integration this package is distilled from it wrote
a stale counter over a payment recorded *after* the form loaded. Each field is its own key in a
values `PATCH`; each row is its own create, patch or archive; each image is its own save.

> **Publish is per PAGE, not per section.** Every section of a page shares one document, so
> `publishPage` publishes every unpublished draft on that page. Call `diffDrafts(slug)` first
> and warn the editor what else is about to go live.

`restoreVersion` writes the **draft** and returns `skipped` — fields the snapshot has that the
structure no longer does. Show it: silently dropping it means an editor believes a restore was
complete when it was not. A restore still needs a publish.

`reorderItems` requires the complete ordered set, so it takes `expectedItemIds` and fails
locally — before any request — when the two do not match.

## Images: three steps, and the bytes never touch your server

```
server ──1──▶ editor.createUploadToken({ filename, contentType })
browser ─2──▶ @vercel/blob/client's upload(), with that token     ← not this SDK's job
server ──3──▶ editor.registerAsset({ blobPathname, url, contentType, size, width, height })
```

Step 2 is deliberately absent: it needs `@vercel/blob` in the browser, and proxying the file
through your own server is not a shortcut — a serverless request-body cap (4.5 MB on Vercel) is
well under the 15 MB the service allows, so proxying makes large photos fail for a reason that
has nothing to do with images.

Register the pathname **Blob returned** (hence the parameter name `blobPathname`): Blob appends
a random suffix, and re-registering a pathname is a `409`.

`alt` is required by the type — and required text that nothing renders is theatre, so `asImage`
carries `{ url, alt }` together. Use `""` for a decorative image, so "forgot" and "decorative"
stay distinguishable. `getAssetIdByUrl(url)` exists because a read gives you the resolved image
and never its `assetId`, while writing alt text back needs one; it answers `null` rather than
failing a form.

## Datasets

The only tier that creates records, and no tier accepts a write from a browser.

```ts
const { record, created } = await editor.createRecord("donations", {
  externalId: payment.providerId, // THE PROVIDER'S id — a fresh uuid defeats deduplication
  occurredAt: payment.paidAt, // the EVENT time, required rather than defaulted to now
  data: { amountForint: 5000 },
});
```

`created: false` is a **success**: the record already existed, because inserts are idempotent
on `externalId`. A redelivered webhook is not an error, and treating it as one is how a payment
provider ends up retrying forever.

Totals come from `getDatasetAggregate`, never a stored counter: one call, and it cannot drift
from the records it summarises.

## Errors

`ContentApiError` carries the service's own `code`, its typed `details` and a `retryable`
verdict. Branch on `code`, never on `message`.

```ts
if (error instanceof ContentApiError && error.code === "conflict") {
  const missing = error.details?.missing ?? []; // required fields empty at publish
}
```

`retryable` is `true` for `internal_error` and for a publish `conflict` caused by a lost race —
which is safe to retry after reloading — and `false` for everything else. The user-facing
sentences are yours: they belong in your voice and your language, not in a dependency.

## The revalidation webhook

```ts
const verdict = await verifyRevalidationWebhook({
  secret: process.env.CONTENT_REVALIDATE_SECRET!,
  rawBody: await request.text(), // BEFORE any parsing — re-serialising breaks the signature
  headers: request.headers,
});
if (!verdict.ok) return new Response(verdict.reason, { status: 401 });
revalidateTag(CONTENT_TAG); // the tag your reads set — a mismatch fails silently
```

The event is reachable only through a valid verdict, so verifying before parsing is structural.
`slug: null` means invalidate everything, and `version` is `null` on a collection item *and* on
a whole-site re-fire. You do not need to check `site`: the signing secret is per site.

## Licence

MIT.
