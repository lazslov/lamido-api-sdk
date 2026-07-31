/**
 * The option bags every endpoint shares.
 *
 * @remarks
 * `init` is on all of them because the SDK owns no caching. The framework does, and it expresses
 * that through `fetch`'s init — `{ next: { tags: […] } }` for a tagged read a publish webhook
 * busts, `{ next: { revalidate: 10 } }` for a live total, `{ signal }` for a timeout. A client can
 * also carry one `defaultInit` for every call it makes, which is how `@lamido/content/next` builds
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

/** Paginated reads. */
export interface ListOptions extends LocaleOptions {
  /** 1–100, default 20. Out of range is a `400`, never a clamp. */
  readonly limit?: number;
  /** ≥ 0, default 0. */
  readonly offset?: number;
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
