/**
 * The two paginators, because the services genuinely have two kinds of list.
 *
 * @remarks
 * The difference is whether the table grows with your activity. A keyset cursor walks an
 * unbounded one — dataset records, assets, invoices, payments, the audit trail — and carries no
 * `total`, because counting a filtered unbounded table on every page is not cheap. An offset
 * walks the bounded, staff-curated ones: collection items, page versions, sites.
 */

/** One page of a cursor list, as every list endpoint on the three services returns it. */
export interface CursorPage<T> {
  readonly items: T[];
  /**
   * The next cursor, or `null` on the last page.
   *
   * @remarks
   * **Always present, `null` rather than absent.** A pager that reads `undefined` exits, which
   * is accidentally right until the day the endpoint grows a second page.
   */
  readonly nextCursor: string | null;
}

/** One page of an offset list. */
export interface Page<T> {
  readonly items: T[];
  /** Total matching rows, when the endpoint reports one. Never `null`. */
  readonly total?: number;
}

/** Options common to both paginators. */
export interface CollectAllOptions {
  /** Page size. Defaults to each paginator's own documented maximum-friendly value. */
  readonly pageSize?: number;
  /** Default 100. A loop breaker, not a result cap — see {@link collectAll}. */
  readonly maxPages?: number;
}

/**
 * The message both paginators fail with, so the two read identically in a log.
 *
 * @remarks
 * Deliberately a throw rather than a truncated list: a silently short list is a bug nobody
 * looks for inside a fetch helper, and it appears the day a list outgrows the cap.
 */
function exhausted(name: string, maxPages: number, pageSize: number): Error {
  return new Error(
    `${name} stopped after ${maxPages} pages of ${pageSize} without reaching the end. ` +
      "Raise maxPages deliberately, or narrow the query — a truncated list is not returned.",
  );
}

/**
 * Follow a keyset-cursor list to the end.
 *
 * @param readPage - Reads one page. Supplied by the endpoint function, so the paginator knows
 * nothing about paths or parameters.
 * @param options - Page size (default 50, the services' own default; the maximum is 200) and
 * the loop breaker.
 * @returns Every item, in page order.
 * @throws When `maxPages` is reached.
 * @remarks
 * The cursor is opaque and is passed back verbatim. This function never constructs, parses or
 * stores one — the encoding is free to change, and a malformed cursor is a `400` rather than a
 * quiet restart from page one.
 *
 * @example
 * ```ts
 * const records = await collectAllCursor(({ limit, cursor }) =>
 *   content.listRecords("donations", { limit, cursor }),
 * );
 * ```
 */
export async function collectAllCursor<T>(
  readPage: (params: { limit: number; cursor?: string }) => Promise<CursorPage<T>>,
  options: CollectAllOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 100;

  const collected: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await readPage(
      cursor === undefined ? { limit: pageSize } : { limit: pageSize, cursor },
    );
    collected.push(...result.items);

    // The cursor is the only terminator. A short page is *not* one: a filtered keyset page can
    // come back under `limit` and still have more behind it.
    if (result.nextCursor === null) return collected;
    cursor = result.nextCursor;
  }

  throw exhausted("collectAllCursor", maxPages, pageSize);
}

/**
 * Follow a `limit`/`offset` list to the end.
 *
 * @param readPage - Reads one page.
 * @param options - Page size (default 100) and the loop breaker.
 * @returns Every item, in page order.
 * @throws When `maxPages` is reached.
 * @remarks
 * For the bounded, staff-curated lists only. An out-of-range `limit` is a `400` on these
 * endpoints rather than a clamp, and the ceiling is 100 — 1000 on a dataset aggregate — so a
 * caller raising `pageSize` should check the endpoint first.
 *
 * @example
 * ```ts
 * const items = await collectAll(({ limit, offset }) =>
 *   content.listCollectionItems("news", { limit, offset }),
 * );
 * ```
 */
export async function collectAll<T>(
  readPage: (params: { limit: number; offset: number }) => Promise<Page<T>>,
  options: CollectAllOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 100;

  const collected: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const { items, total } = await readPage({ limit: pageSize, offset: collected.length });
    collected.push(...items);

    // An empty page is always terminal, and it guards the `total` check below, because `total`
    // can move between requests while rows are being written.
    if (items.length === 0) return collected;
    if (total !== undefined && collected.length >= total) return collected;
    // With no `total` to follow, a short page is the last page.
    if (total === undefined && items.length < pageSize) return collected;
  }

  throw exhausted("collectAll", maxPages, pageSize);
}
