# Phase 3 — `@lazslov/content`

**Goal:** the package a client website actually installs. Covers the website read tier and
the client read/write tier, the field-descriptor layer that makes an editor UI tractable, and
the three-step image upload.

**Depends on:** [phase 2](phase-2-api-core.md).

**Reference:** [content-service/site-integration.md](../content-service/site-integration.md)
is the primary input for this phase. It is distilled from a completed Next.js integration
*including the bugs it shipped first*, and most of what follows exists to make one of those
bugs unrepeatable.

**Out of scope:** the admin tier (`cad_`), and anything in `./next` — that is
[phase 6](phase-6-next-adapters.md).

---

## 1. Two clients, because there are two credentials

```ts
createWebsiteClient(config?)   // cpk_ or csk_ → /api/content/*   — browser-safe with cpk_
createContentClient(config?)   // csk_        → /api/client/*     — server only
tryCreateWebsiteClient(config?)
tryCreateContentClient(config?)
```

Not one client with a tier parameter. The credentials have different blast radii and
different browser rules, and a single object holding a `csk_` that *can* serve public reads
is a `csk_` that ends up in a client component. Separate constructors mean the import graph
shows which tier a module touches.

`createWebsiteClient` accepts either prefix because the website tier does
([conventions §2](../content-service/conventions.md#2-the-three-credential-tiers)), and
applies `assertServerOnly` only for `csk_`.

Env var names, from
[site-integration §2](../content-service/site-integration.md#2-one-gateway-file-three-cache-modes):
`CONTENT_SERVICE_BASE_URL`, `CONTENT_SERVICE_SECRET_KEY`, plus the proposed
`CONTENT_SERVICE_PUBLISHABLE_KEY`.

---

## 2. The website tier — six reads

| Method | Endpoint | Notes |
|---|---|---|
| `listPages()` | `GET /api/content/pages` | unpaginated; a site has single-digit pages |
| `getPage(slug, { locale })` | `GET /api/content/pages/:slug` | `404` → `null`, see §3 |
| `getSite({ locale })` | `GET /api/content/site` | site chrome; the reserved `settings` section lives on a page, which is why a page publish can change this |
| `getCollection(key, { locale, limit, offset })` | `GET /api/content/collections/:key` | |
| `getDatasetAggregate(key, params)` | `GET /api/content/datasets/:key/aggregate` | opt-in public; `limit` 1–1000, default 100 |
| `getHealth()` | `GET /api/health` | the only unauthenticated endpoint |

`getHealth` must read the **body** on a 503, not just `response.ok`: the service answers
`503` *with* `{"status":"degraded","db":"unreachable","code":"…"}`, and
[conventions §1](../content-service/conventions.md#1-base-url) notes that a monitor checking
`ok` first never sees the reason. So `getHealth` uses `read: { kind: "raw" }` and does not
treat 503 as a thrown error.

> **RULE — no `?view=` parameter is exposed on this client.** Any value other than
> `published` is a `403` on this tier for *every* key kind. There is no reason for the SDK to
> offer a parameter whose only non-default value is guaranteed to fail.

---

## 3. Read semantics: the degradation contract

The read layer's job is that **a half-published site degrades one section at a time** rather
than throwing. From
[site-integration §8](../content-service/site-integration.md#8-rendering-decisions-that-bite),
encoded in the types:

| Rule | How the SDK encodes it |
|---|---|
| **A `404` is not an error.** It is what an unpublished page and an undefined collection answer — the normal state of a freshly provisioned site. | `getPage`/`getCollection`/`getRecord` return `T \| null`. The 404 is caught in the method, not by the caller. Every *other* status still throws. |
| **A missing section maps to an empty field set**, not `null`. | `page.section(key)` returns a section accessor that is always non-null; its fields are empty. No component needs a null check, and one unpublished section cannot take a route down. |
| **A field whose value is `null` is omitted** from the document. | The coercions (§4) never see the key, so their defaults *are* the empty-value behaviour. |
| **`""` and `[]` are real values, not omissions.** | Coercions must distinguish "absent" from "present and empty" and must **not** fall back to a default for the latter. Emptying a field is a deliberate editorial action. |
| **A deleted asset resolves to `null`,** never a dangling id. | The image type is `{ url, alt, width: number \| null, height: number \| null } \| null`. |
| **A draft read is a superset of a published one.** | One return type for both, so preview reuses the real components. |
| **`null` from an aggregate means unknown and must hide the UI.** | `getDatasetAggregate` returns `null` when unconfigured or when the read failed — typed `number \| null`, never coerced to `0`. A progress bar at 0% is a lie about money. |

> **RULE — a 404 is mapped to `null` only where the documentation says 404 is a normal
> state.** Not globally. `conventions §4` notes that a foreign id is *also* a 404 — tenant
> scoping is per-query on `site_id`, so another site's page reads as absent. Mapping every
> 404 to `null` everywhere would turn "you configured the wrong tenant" into "this content
> does not exist yet", which is the harder bug to find. On write paths a 404 throws.

---

## 4. The field-descriptor layer — `@lazslov/content/fields`

[site-integration §3](../content-service/site-integration.md#3-the-field-descriptor-layer)
calls this *"the abstraction that paid for itself most, and the one you will be tempted to
skip."* It is the strongest argument for this SDK existing at all: without it, a hundred
fields get named in four places each — a read mapper, a write validator, a label lookup, and
the JSX.

**What the SDK ships:** the types, the coercions, and the write preparer.
**What each site owns:** its own descriptor tables. Labels and help text are product copy.

### Types

Ported from site-integration §3 essentially verbatim — `FieldType`, `FieldControl`,
`ListEntryDescriptor`, `FieldDescriptor`, `SectionDescriptor`. This is a **leaf module**: it
imports nothing, not even `@lazslov/api-core`, so descriptors, the reader, the write validator
and a site's form components can all depend on it without a cycle. The doc records that this
cycle was hit in the real build.

### Coercions

```ts
asText(doc, key): string          // "" when absent AND when stored empty — both are ""
asRows(doc, key, entry): Row[]    // [] when absent; picks columns from `entry`, one by one
asImage(doc, key): ContentImage | null
asRichtext(doc, key): string      // the markdown source; rendering is the site's
```

> **RULE — pick entry fields column by column when coercing list rows.** A key the schema
> gained but this build does not know about then cannot reach a component. `asRows` takes the
> `entry` descriptor array precisely so it can iterate *that* rather than the row.

### `prepareValues` — the write preparer

This is the highest-value function in the package.

```ts
prepareValues(section: SectionDescriptor, submitted: Record<string, unknown>, current: ContentDocument):
  | { ok: true; values: Record<string, unknown> }   // changed keys only; may be {}
  | { ok: false; errors: Record<string, string> }   // per field, for the editor
```

> **RULE — iterate the descriptor table, never the submission.** A server action is a public
> endpoint; a key your table does not know must not reach the wire. The service answers `400`
> for an unknown value key rather than dropping it silently — which is correct and protects
> the editor's text — so **one stray field fails the entire save**.

Four more behaviours it must have, each from a documented failure:

- **Return only changed keys.** `PATCH …/pages/:slug/values` merges key by key, so send only
  what changed.
- **Return `{}` when nothing changed, and the caller makes no HTTP call at all.** Not
  tidiness: a save is usually followed by a publish, and **publish carries every other
  pending draft on the page live**. An idly pressed Save must not be able to publish someone
  else's half-finished section. (The service also rejects an empty `values` map with a `400`,
  so the early exit saves a round trip either way.)
- **Preserve an unknown stored option rather than rewriting it.** If a stored value is not in
  a descriptor's `options` array — a model that gained an icon this build predates — it must
  survive the save. Otherwise opening the form and pressing Save silently rewrites a value
  nobody touched. Same for an unknown `locked` key: keep it, do not drop it.
- **Mirror the service's `url` rule exactly, and block rather than warn.** The service accepts
  `https://`, `mailto:`, `tel:`, `/path` and `#anchor` and `400`s anything else. A
  non-blocking warning spends a round trip to deliver an English error message to an editor
  who cannot act on it. The predicate is exported as `isValidContentUrl` so a site can use
  the *same function* in the browser for immediacy and on the server for truth — and it lives
  in this plain library module because a client component cannot be the home of a server rule.

`snake_case` on the wire, `camelCase` in components, converted **at the boundary in the read
layer, once**. The SDK does not "tidy" wire keys — the model is shared with the service's own
tooling.

---

## 5. Writing: the save unit is the row, not the document

> **RULE — the SDK exposes no method that writes a whole list or a whole document.**

[site-integration §4](../content-service/site-integration.md#4-writing-safely-the-save-unit-is-the-row-not-the-document)
records what happened when one existed: a whole-list save wrote a form's stale `raised`
counter over a payment recorded *after* the form loaded, and a public fundraising bar read
**0% against a 6.2M goal while 3.18M was actually recorded.** It is last-write-wins by
construction.

So the write surface is deliberately granular:

| Method | Endpoint | Unit |
|---|---|---|
| `patchValues(slug, values, { locale })` | `PATCH /api/client/pages/:slug/values` | one field per key; merges |
| `publishPage(slug, { locale })` | `POST /api/client/pages/:slug/publish` | **the page** — see below |
| `revertPage`, `restoreVersion` | `POST …/revert`, `POST …/versions/:v/restore` | |
| `createItem`, `patchItem`, `archiveItem`, `reorderItems` | collection items | one row |
| `registerAsset`, `deleteAsset` | assets | one image |
| `createRecord`, `patchRecord`, `deleteRecord` | dataset records | one record |

### Publish is per page, and the SDK says so twice

> **GOTCHA — publish is per PAGE, not per section.** Every section of a page shares one
> document, so publishing one section publishes every unpublished draft on that page.

This is the single most surprising behaviour in the service, and the SDK cannot make it
safer — only visible. Two measures:

1. `publishPage` is named for what it does. There is no `publishSection`, and no
   `publish(sectionKey)` overload that would read as section-scoped.
2. A companion `diffDrafts(slug, { locale })` returns the keys where the draft differs from
   the published document, so a UI can warn *"3 other sections have unpublished changes"*
   before publishing. [site-integration §12](../content-service/site-integration.md#12-before-you-call-it-done)
   check 9 requires exactly this.

`restoreVersion` returns a `skipped` list — fields the snapshot has that the structure no
longer does. The return type makes it non-optional to read, and the README says to show it:
silently dropping it means an editor believes a restore was complete when it was not. And
`restore` is **not** "make live" — there is exactly one path to live content, so a restore
still needs a publish.

### Concurrency rules the SDK enforces or documents

- **Snapshot before awaiting.** `prepareValues` takes `current` as a parameter rather than
  reading it, so the caller passes the document they diffed against, not live form state.
- **One idempotency key per submit, not per call.** Dataset record inserts are idempotent on
  `externalId`; per-call keys make a retry a second write.
- **Defer a reorder while any row is unsaved.** `reorderItems` requires *every* non-archived
  item exactly once — a partial list is a `validation_error`, not a partial reorder. The SDK
  validates the completeness of the array before sending, so the failure is local and
  legible instead of a round trip.

---

## 6. Assets — three steps, and the bytes never touch your server

```
server ──1──▶ createUploadToken()   → { token, pathname, allowedContentTypes, maximumSizeInBytes }
browser ─2──▶ direct PUT to Blob with that token        ← NOT the SDK's job
server ──3──▶ registerAsset({ pathname, url, … })       → the registered row
```

Step 2 is deliberately absent from the SDK. It needs `@vercel/blob` in the browser, and
adding it would break the zero-dependency rule for a call the SDK cannot make anyway. The
README documents the handoff and why: a serverless request body cap (4.5 MB on Vercel) is
well under the 15 MB the service allows, so **proxying the file makes large photos fail for a
reason that has nothing to do with images.**

Two typed guards for documented traps:

- **`registerAsset` requires the pathname Blob returned, not the one the token asked for.**
  Blob appends a random suffix, and re-registering a pathname is a `409`. The parameter is
  named `blobPathname` and the doc comment says where it comes from.
- **`alt` is required by the type on `registerAsset`**, and the README's checklist item is
  *"alt text is required **and rendered** — look at the page source, not the form."* The real
  build captured alt, validated it as required, stored it, and then hardcoded `alt` at every
  render site. An alt an editor is forced to type and nothing displays is theatre. `asImage`
  therefore carries `{ url, alt }` together so the value is hard *not* to render.

`getAssetIdByUrl(url)` exists because of a genuine asymmetry: reading a content value gives
you the resolved image, never its `assetId`, but writing alt text back needs
`{ assetId, alt }`. The id comes from listing `/api/client/assets` and mapping `url → id` — a
URL identifies an asset uniquely, so the lookup is exact, and that list is what an image
picker needs anyway. If the read fails, the documented degradation is *"alt text not editable
right now"*, never failing the whole form — so this method returns `string | null`.

---

## 7. Datasets — application data, not content

This tier is the **only** place records are created. Notes that shape the API:

- **`createRecord` is idempotent on `externalId`**, and a redelivered webhook is a *success*,
  not a `409`. So the return type is `{ record, created: boolean }` — a caller writing a
  payment webhook handler needs to know it was a redelivery without treating it as an error.
- **`externalId` must be the payment provider's own id.** A uuid generated per attempt
  defeats the deduplication entirely. The parameter's doc comment says so, because this is a
  parameter someone will fill with `crypto.randomUUID()` on autopilot.
- **`occurredAt` is the event time, not the write time.** It is what the list orders by.
  Required, not defaulted to `Date.now()` — a default would quietly make every backfilled
  record sort as if it happened now.
- **A record's `data` is flat and its field names are camelCase-legal** (`^[a-z][a-zA-Z0-9_]*$`),
  unlike slugs. An unknown key in `data` is a `400` — *"a silently dropped `amountForintt` is
  a lost donation."*
- **`?include=sensitive` is audited** (`record.read_sensitive`). The SDK exposes it as an
  explicit `includeSensitive: true` argument, never a default, and the doc comment states
  that using it writes an audit entry.
- **`getRecords` returns donor PII.** No convenience that logs or serialises a record list.

Totals come from `getDatasetAggregate`, **never a stored counter** — computing it is one call
and it cannot drift from the records it summarises. The counter that got overwritten in the
real build should not have existed.

---

## 8. Error translation

Exports the documented code union and a `retryable` verdict from
[conventions §4](../content-service/conventions.md#4-error-codes):

```ts
export type ContentErrorCode =
  | "validation_error" | "bad_request" | "unauthorized" | "forbidden"
  | "not_found" | "conflict" | "payload_too_large" | "internal_error"
  | "not_configured";   // status 0, never sent
```

`retryable` is `true` only for `internal_error` (*"retry once, then report"*) and for a
**publish `conflict` caused by a lost race**, which is retryable after reloading — unlike
every other `conflict`. Distinguishing those two requires reading `details`, so the parser
does.

The SDK does **not** ship the `explain(error)` copy table from
[site-integration §5](../content-service/site-integration.md#translate-the-services-errors-once) —
those are user-facing sentences and belong to each site. It ships the typed `details` shapes
that make writing them mechanical: `validation_error.details.unknownKeys` and `.invalid[]`,
`conflict.details.recordCount` on a delete, `conflict.details.missing[]` on a publish.

---

## Public API surface

```ts
// @lazslov/content
export { createWebsiteClient, tryCreateWebsiteClient, createContentClient, tryCreateContentClient }
export { ContentApiError, type ContentErrorCode }
export type { PublishedPage, ContentDocument, ContentImage, CollectionItem, DatasetRecord, … }
export { verifyRevalidationWebhook }   // binds core's verifier to X-Content-* headers

// @lazslov/content/fields
export type { FieldType, FieldControl, FieldDescriptor, ListEntryDescriptor, SectionDescriptor }
export { asText, asRows, asImage, asRichtext, prepareValues, isValidContentUrl }
```

`verifyRevalidationWebhook` lives in the main entry, not in `./next`, because the payload and
the signature are framework-independent. Only the route handler is Next-specific.

---

## Exit criteria

- [ ] Every website-tier and client-tier consumer endpoint is callable. Admin endpoints are absent.
- [ ] `getPage` on an unpublished slug returns `null`; a 401 from the same call throws.
- [ ] `page.section("nope")` returns an empty section, not `null`, and does not throw.
- [ ] `asText` returns `""` for both an absent key and a stored `""`, and a test asserts a stored `""` is **not** replaced by a default.
- [ ] `prepareValues` drops a key absent from the descriptor, returns `{}` when nothing changed, preserves a stored option outside `options`, and rejects a bad `url` with a per-field error.
- [ ] There is no exported method that writes a whole document or a whole list. Grep-asserted against the export list.
- [ ] `reorderItems` throws locally on an incomplete array, before any request.
- [ ] `createRecord` reports `created: false` on a replay rather than throwing.
- [ ] `getHealth` returns the degraded body on a 503 instead of throwing.
- [ ] `verifyRevalidationWebhook` passes fixtures covering `slug: null` (whole-site invalidation) and `version: null` on a page delivery — both documented and both easy to crash on.
- [ ] `createContentClient` throws when constructed in a browser with a `csk_`; `createWebsiteClient` with a `cpk_` does not.
- [ ] `tryCreateContentClient()` with no env returns `null`, and a site built on it renders.

## Out of scope here

The three cache modes, `revalidateTag`, and the webhook route handler — all
[phase 6](phase-6-next-adapters.md). No React, no rendering, no markdown parser: `asRichtext`
returns the source string, and a reference tokeniser for the markdown subset lives in
[data-model.md](../content-service/data-model.md#the-richtext-markdown-subset) for a site to
adopt.
