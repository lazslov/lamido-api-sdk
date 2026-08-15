# @lazslov/content

Consumer SDK for content-service — pages, sections and collections for content, datasets for
the application data a client site would otherwise need a database for, and images on the
CDN.

**What ships in it:** both consumer tiers, the field-descriptor layer on `@lazslov/content/fields`,
and the Next.js App Router adapter on `@lazslov/content/next` — three cache modes, the revalidation
route handler and the server-action error shape.

## Install

```sh
pnpm add @lazslov/content
```

Zero runtime dependencies except `@lazslov/api-core`, which is the shared transport.

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
import { createWebsiteClient, createContentClient } from "@lazslov/content";

const site = createWebsiteClient(); // /v1/public/* — published reads, cpk_ or csk_
const editor = createContentClient(); // /v1/* — drafts and writes, csk_ only
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

`@lazslov/content/fields` imports nothing — no transport, no credential handling — so a client
component and a server action can share it.

```ts
import { asImage, asRows, asText, prepareValues } from "@lazslov/content/fields";

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
if (error instanceof ContentApiError && error.type === "conflict") {
  const missing = error.details?.missing ?? []; // required fields empty at publish
}
```

`retryable` is `true` for `internal_error` and for a publish `conflict` caused by a lost race —
which is safe to retry after reloading — and `false` for everything else. The user-facing
sentences are yours: they belong in your voice and your language, not in a dependency.

## The revalidation webhook

```ts
const verdict = await verifyContentWebhook({
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

In a Next.js app you do not need to write any of that — see below.

## `@lazslov/content/next` — the Next.js App Router adapter

`next` is an **optional peer dependency**, and only this subpath imports it. Installing this package
in an Astro, Remix or plain-Node project neither warns nor breaks, and `"sideEffects": false` lets a
bundler drop the subpath when it is unused.

### One gateway module, three cache modes

```ts
// lib/content.ts
import "server-only";
import { createNextContentGateway } from "@lazslov/content/next";

export const { published, live, client, tag } = createNextContentGateway();
```

| Mode | For | What it sets |
| --- | --- | --- |
| `published` | pages, collections, site settings | `{ next: { tags: [tag] } }` — the webhook busts it |
| `live` | a dataset aggregate; a live total | `{ next: { revalidate: 10 } }` — a **short window** |
| `client` | every write, and every draft read | `{ cache: "no-store" }` |

> **RULE — never `cache: "no-store"` in a route's render path.** It does not mean "this one query is
> uncached"; it opts the **whole route** out of static rendering, so every visitor hits your origin
> and this service.

That is the bug `live` exists to have prevented. The reference build reached for `no-store` for a
perfectly honest reason — a live total must not be a minute stale — and silently un-statified its
homepage. Three things made it brutal: the production symptom is a latency and cost regression rather
than an error, a **keyless local build hides it entirely** (nothing fetches, so nothing goes
dynamic), and it is invisible in a code review of the diff.

So `no-store` is not something `published` or `live` can be asked for. It is on `client`, the write
tier — which is never in a render path by construction. Ten seconds on `live` is what the service
declares for the same data; the one value not to reach for is `0`.

### The revalidation route

```ts
// app/api/revalidate/route.ts
import { createRevalidationHandler } from "@lazslov/content/next";
import { tag } from "@/lib/content";

export const POST = createRevalidationHandler({ tag });
```

It reads the raw body before anything parses it, answers `400` for a stale timestamp or an
unreadable body and `401` for a bad signature, busts the tag, then calls your optional `onPublish`.

> **RULE — the tag you bust must be the tag your reads set.** If your fetches say
> `tags: ["content"]` and your receiver busts `` `content:${body.site}` ``, the webhook answers
> `200`, nothing is invalidated, and the only symptom is content going stale for exactly as long as
> your time-based fallback — **with no error anywhere.**

Both sides default to the same exported `CONTENT_TAG`, so passing the gateway's `tag` through keeps
them one value rather than two string literals in two files. `site` is deliberately **not** compared:
the signing secret is per site, so a valid signature already proves which tenant sent it, and a check
would only break when a slug is renamed.

Treat a delivery as idempotent — it is retried once with the identical body, timestamp and signature,
and a failure never fails the publish. So `onPublish` must be fast, and must not be the only path by
which your site learns something changed.

An unset `CONTENT_REVALIDATE_SECRET` answers `500` on delivery rather than throwing at import: a
route module that throws on import takes the whole route tree down, and would stop the site building
with an empty environment.

### Server actions: return errors, never throw them

> **RULE — a write action returns a result object.** A thrown server-action message is **redacted in
> production**, so a rejected save reaches the editor as an opaque generic failure and the one thing
> they needed — *which field, and why* — is gone.

```ts
"use server";
import { asSaveResult, revalidateAfterWrite } from "@lazslov/content/next";
import { client, tag } from "@/lib/content";

export async function saveAbout(submitted: Record<string, unknown>) {
  const prepared = prepareValues(ABOUT, submitted, page.section("about").fields);
  if (!prepared.ok) return { ok: false as const, error: "validation" as const };
  if (Object.keys(prepared.values).length === 0) return { ok: true as const };

  return asSaveResult(async () => {
    await client.patchValues("home", prepared.values);
    revalidateAfterWrite(tag);
  });
}
```

`asSaveResult` never throws. Its `error` is the service's **stable code**, not prose — the sentences
belong in your voice and your language, not in a dependency — and `fields` carries a
`validation`'s `unknown_keys` and `invalid[]` so a form can render errors next to inputs instead
of one toast. `not_configured` arrives through the same channel as a real `401`, so you need one
translator rather than two.

`revalidateAfterWrite` uses `updateTag` where the installed Next has it, giving the editor
read-your-own-writes in the same request, and falls back to `revalidateTag`. **They are not
interchangeable:** Next throws if `updateTag` is called from a route handler, which is why the
webhook handler uses the other one. Nothing in this SDK calls either from inside a write method —
that would be framework work in a transport.

## Licence

MIT.
