/**
 * One gateway, three cache modes.
 *
 * @remarks
 * The most valuable thing in this subpath, because it encodes a bug that shipped to production in the
 * reference integration and was invisible in the diff.
 *
 * > **RULE — never `cache: "no-store"` in a route's render path.** It does not mean "this one query is
 * > uncached"; it opts the **whole route** out of static rendering, so every visitor hits your origin
 * > and this service.
 *
 * Three properties made that one brutal: the production symptom is a latency and cost regression
 * rather than an error, a **keyless local build hides it entirely** (nothing fetches, so nothing goes
 * dynamic), and it is invisible in a code review of the diff.
 *
 * What this module does about it is not a warning. It is that **mode B exists as a named thing** —
 * `no-store` got reached for because "a short revalidate window" was not something the gateway
 * offered, and the honest requirement behind it (a live total must not be a minute stale) was real.
 */

import type { ServiceConfig } from "@lamido/api-core";
import { type ContentClient, createContentClient } from "../client/create.js";
import { createWebsiteClient } from "../website/create.js";
import type { WebsiteClient } from "../website/reads.js";
import { CONTENT_TAG } from "./tag.js";

/**
 * `fetch`'s init as Next augments it.
 *
 * @remarks
 * Declared here rather than relying on Next's own global augmentation of `RequestInit`, which is
 * present only inside a Next project's compilation — this package is built outside one. `@lamido/api-core`
 * passes `init` to `fetch` untouched and knows nothing about any of these keys.
 */
interface NextFetchInit extends RequestInit {
  readonly next?: {
    readonly tags?: string[];
    readonly revalidate?: number | false;
  };
}

/**
 * How long mode B may serve a stale value, in seconds.
 *
 * @remarks
 * Ten seconds is not a guess: it is what content-service declares for the same data, so the gateway's
 * window and the service's own freshness statement agree. Raise it deliberately and knowingly; the one
 * value not to reach for is `0`, which is `no-store` in everything but spelling.
 */
export const LIVE_REVALIDATE_SECONDS = 10;

/** What {@link createNextContentGateway} accepts. */
export interface NextGatewayConfig extends ServiceConfig {
  /**
   * The cache tag mode A sets.
   *
   * @remarks
   * Defaults to {@link CONTENT_TAG}. If you override it, override it in `createRevalidationHandler`
   * too — from the same constant, in the same module. A mismatch is silent.
   */
  readonly tag?: string;
  /** Mode B's window. Defaults to {@link LIVE_REVALIDATE_SECONDS}. */
  readonly liveRevalidateSeconds?: number;
}

/**
 * The three cache modes, plus the tag that ties mode A to the webhook.
 *
 * @remarks
 * There is deliberately **no fourth reader.** Mode C is typed to the write tier, so a `no-store` read
 * is not something `published` or `live` can be asked for — and since mode C is writes and draft
 * reads, it is never in a render path by construction.
 */
export interface NextContentGateway {
  /**
   * **Mode A** — published content: pages, collections, site settings.
   *
   * @remarks
   * Tagged, so a publish appears within seconds of the revalidation webhook firing. The service's own
   * `s-maxage=60` is not the mechanism and is not even in play — every request carries an
   * `Authorization` header, so Vercel's edge answers `BYPASS` and does not cache this tier at all. The
   * framework cache is the cache.
   */
  readonly published: WebsiteClient;
  /**
   * **Mode B** — data no publish invalidates. A live total from a dataset aggregate.
   *
   * @remarks
   * A short window, and **never `no-store`.** Nothing invalidates this data by tag, because no publish
   * is involved: the records are written by your own backend, not by an editor, so there is no webhook
   * to wait for. `no-store` would un-statify the entire route that reads it — that is the bug this mode
   * exists to have prevented, and this is the sentence to read before changing it.
   */
  readonly live: WebsiteClient;
  /**
   * **Mode C** — the write tier: every write, and the draft reads an editor needs.
   *
   * @remarks
   * Uncached, which here is correct and safe: an editor reading their own draft through a cache sees
   * their edit missing and presses Save again. Nothing on this client belongs in a page's render path —
   * it is a `csk_` key, so it belongs in a server action or a route already behind your own auth.
   */
  readonly client: ContentClient;
  /** The tag mode A's reads carry. Pass this same value to `createRevalidationHandler`. */
  readonly tag: string;
}

/**
 * Build the three readers a Next site needs.
 *
 * @param config - Credentials and the two cache knobs. Anything omitted comes from the environment.
 * @returns The three modes and the tag.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved, and `Error` in a
 * browser — from the underlying constructors, at construction.
 * @remarks
 * Three clients over one configuration, each carrying its mode as a `defaultInit`. Nothing here
 * reaches into `next`: the init bag is passed through to `fetch` by `@lamido/api-core`, which is what
 * makes the cache modes possible without the transport knowing Next exists.
 *
 * A per-call `options.init` still wins over the mode's default, because that is what an escape hatch
 * is for — a one-off `{ next: { revalidate: 3600 } }` on a read that really is that stable.
 *
 * @example
 * ```ts
 * // lib/content.ts
 * import "server-only";
 * import { createNextContentGateway } from "@lamido/content/next";
 *
 * export const { published, live, client, tag } = createNextContentGateway();
 *
 * // app/page.tsx — static, tagged, busted by the webhook
 * const page = await published.getPage("home");
 *
 * // a live total, ten seconds stale at worst, and the route stays static
 * const [total] = await live.getDatasetAggregate("donations", { metrics: ["sum"] }) ?? [];
 * ```
 */
export function createNextContentGateway(config: NextGatewayConfig = {}): NextContentGateway {
  const { tag = CONTENT_TAG, liveRevalidateSeconds = LIVE_REVALIDATE_SECONDS, ...service } = config;

  // Named locals rather than inline literals: `RequestInit` has no `next` key outside a Next
  // compilation, and assigning a typed variable is what keeps that legal without a cast.
  const taggedInit: NextFetchInit = { next: { tags: [tag] } };
  const shortWindowInit: NextFetchInit = { next: { revalidate: liveRevalidateSeconds } };
  const uncachedInit: NextFetchInit = { cache: "no-store" };

  return {
    published: createWebsiteClient({ ...service, defaultInit: taggedInit }),
    live: createWebsiteClient({ ...service, defaultInit: shortWindowInit }),
    client: createContentClient({ ...service, defaultInit: uncachedInit }),
    tag,
  };
}
