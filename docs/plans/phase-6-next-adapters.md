# Phase 6 — Framework adapters

**Goal:** the `./next` subpaths — the three cache modes, the two webhook route handlers, and
the server-action error shape. This is where the SDK stops being a transport and starts
saving real time on a client site.

**Depends on:** [phase 3](phase-3-content.md) and [phase 5](phase-5-payment.md).

**Reference:** [content-service/site-integration.md §2, §5](../content-service/site-integration.md#2-one-gateway-file-three-cache-modes)
and [workflows.md](../content-service/workflows.md#1--integrating-a-nextjs-site).

**No invoice adapter.** invoice-service
[never calls you](../invoice-service/conventions.md#10-what-this-service-does-not-do) and has
no cache story — its data is per-request and per-tenant. `@lazslov/invoice` stays one entry
point.

---

## 1. Why these are subpaths, not the main entry

`next` is an **optional peer dependency**
([phase 1 §3](phase-1-foundations.md#3-build-output-and-package-shape)). Only
`@lazslov/content/next` and `@lazslov/payment/next` import it, so installing either package in
an Astro, Remix or plain-Node project neither warns nor breaks. `"sideEffects": false` lets a
bundler drop the subpath entirely when unused.

The main entries stay framework-agnostic, which is what makes the cache modes possible at all:
core takes a pass-through `init` bag, so `{ next: { tags: [...] } }` reaches `fetch` without
core knowing Next exists ([phase 2 §2](phase-2-api-core.md#2-the-transport)).

---

## 2. `@lazslov/content/next` — the three cache modes

This is the most valuable thing in phase 6, because it encodes a bug that shipped to
production in the reference integration and was invisible in the diff.

```ts
export function createNextContentGateway(config?): {
  /** Mode A — published content. Tagged, so a publish appears when the webhook fires. */
  published: WebsiteClient;
  /** Mode B — data no publish invalidates (a live total). A SHORT WINDOW, never no-store. */
  live: WebsiteClient;
  /** Mode C — the client tier: every write, and the draft reads an editor needs. Uncached. */
  client: ContentClient;
  /** The tag every published read carries, and the webhook busts. */
  tag: string;
};
```

| Mode | Used for | Freshness mechanism | `init` |
|---|---|---|---|
| **A** tagged | pages, collections, site settings | the revalidation webhook busts the tag; the service's `s-maxage=60` is only the backstop for a webhook that never arrived | `{ next: { tags: [tag] } }` |
| **B** short window | a dataset aggregate — a live total | nothing invalidates it; **no publish is involved**, because records are written by your backend, not by an editor. Ten seconds matches what the service declares for the same data | `{ next: { revalidate: 10 } }` |
| **C** uncached | every write, and every draft read | an editor reading their own draft through a cache sees their edit missing and presses Save again | `{ cache: "no-store" }` |

### The `no-store` trap, encoded

> **RULE — never `cache: "no-store"` in a route's render path.** It does not mean "this one
> query is uncached"; it opts the **whole route** out of static rendering, so every visitor
> hits your origin and this service.

The reference build reached for `no-store` for exactly the honest reason — a live total must
not be a minute stale — and silently un-statified its homepage. Three properties made it
brutal: the symptom in production is a **latency and cost regression, not an error**; a
**keyless local build hides it entirely** (nothing fetches, so nothing goes dynamic); and it
is invisible in a code review of the diff.

What the SDK does about it:

1. **Mode B exists as a named thing.** The reason `no-store` got reached for is that "a short
   revalidate window" was not a thing the gateway offered. Now it is, with a default of 10
   seconds and a comment saying where that number comes from.
2. **Mode C is typed to the client tier only.** `published` and `live` are `WebsiteClient`
   values; there is no way to get a `no-store` read out of them. Since mode C is writes and
   draft reads, it is never in a render path by construction.
3. **The doc comment on `live` says why it is not `no-store`**, in one sentence, at the place
   someone would change it.

`tag` defaults to `"content"` and is configurable, and the same value is what the webhook
handler busts — see §3.

---

## 3. `@lazslov/content/next` — the revalidation route handler

```ts
export function createRevalidationHandler(opts: {
  secret?: string;          // defaults to CONTENT_REVALIDATE_SECRET
  tag?: string;             // MUST match the gateway's tag — see below
  onPublish?: (payload: RevalidationPayload) => void | Promise<void>;
}): (req: Request) => Promise<Response>;
```

> **RULE — the tag you bust here must be the tag your reads set.** If your fetches say
> `next: { tags: ['content'] }` and your receiver busts `` `content:${body.site}` ``, the
> webhook answers `200`, nothing is invalidated, and the only symptom is content that goes
> stale for exactly as long as your time-based fallback — **with no error anywhere.**

This is a mismatch between two string literals in two files, and it fails silently. The fix is
structural: `createNextContentGateway` and `createRevalidationHandler` **read the same default
tag from one exported constant**, and the recommended usage in the README constructs both from
one module. If a consumer overrides `tag` in one place and not the other, that is now a visible
asymmetry in their own code rather than two unrelated strings.

*A single coarse tag per site is the right default*, because a page publish can also change
`GET /api/content/site` (the reserved `settings` section lives on a page) and nothing in the
payload says whether it did.

The handler:

1. reads `req.text()` **before** any parse — the signature is over raw bytes,
2. verifies via `verifyRevalidationWebhook` (300 s skew), returning `400` for a stale
   timestamp and `401` for a bad signature,
3. calls `revalidateTag(tag)`,
4. invokes `onPublish` if supplied, then answers `200`.

Payload shapes it must handle, both documented and both easy to crash on:

- **`slug: null` means "revalidate everything"** — either an item with no slug or a staff
  re-fire sent without one. Treated as whole-site invalidation.
- **`version: null` on a page delivery** — null for collection items (they have no versions)
  *and* for a whole-site re-fire, so a receiver keying off `version` must tolerate null on a
  page too.

`site` needs no checking: *the signing secret is per-site, so a valid signature already proves
which tenant sent it.* The handler does not compare it, and the doc comment says why — so
nobody adds a check that breaks when a tenant is renamed.

**Treat it as idempotent:** a delivery is retried once with the **identical body, timestamp and
signature**. Only 2 attempts, no backoff, 3 s timeout, and a failure **never fails the
publish** — the content is live either way. So `onPublish` must be fast and must not be the
only path by which the site learns something changed.

### `updateTag` in an action, `revalidateTag` in the webhook

Both exist and they are **not interchangeable**. In a **server action**, expire the tag
immediately so the editor's own next view is correct without waiting for a round trip — that
is the promise you make to someone who just pressed Save. In the **webhook handler**,
`revalidateTag` is the one available, and it keeps every *other* visitor's page fresh.

The SDK does not call either from inside a write method — a gateway that revalidated on write
would be doing framework work in a transport. It is documented, with a
`revalidateAfterWrite()` helper in the `./next` subpath that a server action calls explicitly.

---

## 4. `@lazslov/content/next` — the server-action error shape

> **RULE — a write action returns a result object; it never throws.** A thrown server-action
> message is **redacted in production**, so a rejected save reaches the editor as an opaque
> generic failure and the one piece of information they needed — *which field, and why* — is
> gone.

```ts
export type SaveResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

/** Wraps an action body: catches ContentApiError and returns it as a SaveResult. */
export function asSaveResult<T>(fn: () => Promise<T>): Promise<SaveResult>;
```

`asSaveResult` does **not** ship user-facing copy — those sentences belong to each site
([phase 3 §8](phase-3-content.md#8-error-translation)). It ships the plumbing: catch, log
server-side, and return a structured failure with `validation_error`'s `details.unknownKeys`
and `.invalid[]` mapped into `fields` so a form can render per-field errors instead of one
toast.

`not_configured` flows through the same channel thanks to core's `status: 0` sentinel, so a
site needs one translator, not two.

---

## 5. `@lazslov/payment/next` — the webhook route handler

```ts
export function createPaymentWebhookHandler(opts: {
  secret?: string;                                          // defaults to PAYMENT_SERVICE_WEBHOOK_SECRET
  alreadyProcessed: (eventId: string) => Promise<boolean>;  // REQUIRED
  markProcessed: (eventId: string) => Promise<void>;        // REQUIRED
  onEvent: (event: PaymentWebhookEvent) => Promise<void>;
}): (req: Request) => Promise<Response>;
```

Four things are non-negotiable and encoded in the signature or the body:

1. **`alreadyProcessed` and `markProcessed` are required parameters.** Delivery is
   at-least-once and *"this is the dedupe, and it is not optional."* The SDK owns no storage,
   so it cannot dedupe — but it can make omitting it impossible to do by accident. This is the
   single most important design decision in phase 6.
2. **`export const runtime = "nodejs"`** must be set by the consumer, and the README says so
   in the code sample: *"the Edge runtime may transform the body, which breaks the HMAC."* The
   handler additionally detects a transformed body as a signature failure and its 401 body
   names the edge-runtime cause, so the symptom points at the fix.
3. **Answer `2xx` in under 5 seconds.** `onEvent` is documented as *enqueue, do not process* —
   the sample shows a queue push, not fulfilment. The handler warns (once, via
   `console.warn`) if `onEvent` takes over 3 seconds in development, because the production
   symptom is dead-lettering days later.
4. **`onEvent` runs only after dedupe passes**, and `markProcessed` only after `onEvent`
   resolves. A crash between them yields a redelivery, which is the safe direction.

Response codes: `401` on a verification failure, `200` on a duplicate (a duplicate is a
success — the sender's job is done), `200` after a successful enqueue. A thrown `onEvent`
answers `500` so the sender retries.

---

## 6. What the adapters deliberately do not do

| Not provided | Why |
|---|---|
| A generic `createHandler` for any framework | Two handlers for two documented webhooks is the whole need. A framework-agnostic factory would abstract over a set of size two and cost more than it saves. |
| Middleware, or a Next plugin | Nothing here belongs in a request pipeline. |
| Automatic `revalidateTag` inside write methods | Framework work in a transport. Explicit `revalidateAfterWrite()` instead. |
| A React `<ContentProvider>` or hooks | Reads are server-side; the field descriptors are the UI contract. Rendering stays in each site. |
| An Astro / Remix / SvelteKit adapter | Add one when a client project needs it. The agnostic core means it is a small, additive package, not a refactor. |

---

## Exit criteria

- [ ] `@lazslov/content` and `@lazslov/payment` install cleanly in a project **without** `next` present, with no peer warning, and the main entry imports nothing from `next`. Asserted by a fixture project in CI.
- [ ] The gateway's mode A sets `{ next: { tags: [tag] } }`, mode B sets `{ next: { revalidate: 10 } }`, mode C sets `{ cache: "no-store" }` — asserted against a stub `fetch`.
- [ ] There is **no** way to obtain a `no-store` read from `published` or `live`. Type-level assertion.
- [ ] The gateway's tag and the handler's tag come from one exported constant, and a test asserts they are equal by default.
- [ ] The revalidation handler: verifies before parsing; `400` on stale, `401` on bad signature, `200` + `revalidateTag` on valid; handles `slug: null` and `version: null` without throwing; does not compare `site`.
- [ ] The payment handler cannot be constructed without `alreadyProcessed` and `markProcessed` — a type error, asserted.
- [ ] A duplicate `X-Event-Id` answers `200` **without** calling `onEvent`.
- [ ] `markProcessed` is not called when `onEvent` throws, and the response is `500`.
- [ ] A body mutated after signing yields `401` whose message names the edge-runtime cause.
- [ ] `asSaveResult` never throws, and maps `validation_error` details into `fields`.
- [ ] End-to-end fixture: a Next.js App Router app that renders a page through mode A, receives a signed revalidation POST, and busts the tag its reads set.

## Out of scope here

Everything for a framework nobody is using yet. The value of the agnostic core is that phase 6
can stay this small.
