/** One page of results, as a `limit`/`offset` list endpoint returns it. */
export interface Page<T> {
  readonly items: T[];
  /**
   * Total matching rows, when the endpoint reports one.
   *
   * @remarks
   * Absent on `GET /api/invoices`, and the unpaginated invoice lists omit `limit` and `offset`
   * from the body as well — so a paginator cannot assume any pagination key exists.
   */
  readonly total?: number;
}

/** Options for {@link collectAll}. */
export interface CollectAllOptions {
  /** Default 100, the documented maximum on both `limit`-based services. */
  readonly pageSize?: number;
  /** Default 100. A loop breaker, not a result cap — see {@link collectAll}. */
  readonly maxPages?: number;
}

/**
 * Follow a `limit`/`offset` list to the end.
 *
 * @param readPage - Reads one page. Supplied by the endpoint function, so the paginator knows
 * nothing about paths or parameters.
 * @param options - Page size and the loop breaker.
 * @returns Every item, in page order.
 * @throws When `maxPages` is reached. Deliberately a throw rather than a truncated list: a
 * silently short list is a bug nobody looks for inside a fetch helper, and it appears the day
 * a list outgrows the cap.
 * @remarks
 * Not exported from `@lamido/payment`: its merchant tier is unpaginated and its admin tier uses
 * keyset cursors, so neither shape fits this.
 *
 * @example
 * ```ts
 * const items = await collectAll(({ limit, offset }) =>
 *   content.getCollection("news", { limit, offset }).then((page) => page ?? { items: [], total: 0 }),
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

  throw new Error(
    `collectAll stopped after ${maxPages} pages of ${pageSize} without reaching the end. ` +
      "Raise maxPages deliberately, or narrow the query — a truncated list is not returned.",
  );
}
