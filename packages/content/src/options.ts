/**
 * The option bags every endpoint shares.
 *
 * @remarks
 * `init` is on all of them because the SDK owns no caching. The framework does, and it expresses
 * that through `fetch`'s init — `{ next: { tags: […] } }` for a tagged read a publish webhook
 * busts, `{ next: { revalidate: 10 } }` for a live total, `{ signal }` for a timeout. A client can
 * also carry one `defaultInit` for every call it makes, which is how `@lazslov/content/next` builds
 * one reader per cache mode in phase 6.
 */

/** Passed through to `fetch` intact. Never a place the SDK puts anything of its own. */
export interface RequestOptions {
  readonly init?: RequestInit;
}

/** Reads that take a locale. */
export interface LocaleOptions extends RequestOptions {
  /**
   * Which locale to read.
   *
   * @remarks
   * Defaults to the site's own `defaultLocale`. A locale the site does not publish is a `400`
   * listing the ones it does — there is **no fallback chain**, because a missing translation
   * silently reading as the default locale's text looks like a content bug on the live site.
   */
  readonly locale?: string;
}

/**
 * Offset-paged reads — the bounded, staff-curated lists.
 *
 * @remarks
 * Collection items, page versions and dataset aggregates. The service pages these by offset
 * because the list does not grow with your activity, so a stable page number is meaningful.
 */
export interface ListOptions extends LocaleOptions {
  /** 1–100, default 20 — 1–1000, default 100 on a dataset aggregate. Out of range is a `400`, never a clamp. */
  readonly limit?: number;
  /** ≥ 0, default 0. */
  readonly offset?: number;
}

/**
 * Keyset-paged reads — the lists that grow with your activity.
 *
 * @remarks
 * Dataset records and the asset library. There is no `offset`: the rows move under you as new
 * ones arrive, and an offset would skip or repeat across pages.
 */
export interface CursorListOptions extends RequestOptions {
  /** 1–200, default 50. Out of range is a `400`, never a clamp. */
  readonly limit?: number;
  /**
   * An opaque cursor, taken verbatim from a previous page's `nextCursor`.
   *
   * @remarks
   * Never construct, parse or store one — the encoding is free to change, and a malformed cursor
   * is a `400` rather than a quiet restart from page one.
   */
  readonly cursor?: string;
}

/**
 * Forward a caller's `init`, and nothing else.
 *
 * @param options - Any option bag.
 * @returns `{ init }` when there is one, otherwise `{}`.
 * @remarks
 * Spread rather than assigned so a request spec never gains an `init: undefined` key, which would
 * override a client's `defaultInit` with nothing.
 * @internal
 */
export function passInit(options: RequestOptions): { init?: RequestInit } {
  return options.init ? { init: options.init } : {};
}
