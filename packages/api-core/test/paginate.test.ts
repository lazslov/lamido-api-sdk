import { describe, expect, it, vi } from "vitest";
import { collectAll, type Page } from "../src/paginate.js";

/** A reader over a fixed list, optionally reporting `total` as the real endpoints do. */
function pagedReader<T>(items: T[], options: { reportTotal: boolean }) {
  return vi.fn(
    async ({ limit, offset }: { limit: number; offset: number }): Promise<Page<T>> => ({
      items: items.slice(offset, offset + limit),
      ...(options.reportTotal ? { total: items.length } : {}),
    }),
  );
}

describe("collectAll", () => {
  it("follows total to the end", () => {
    const reader = pagedReader(
      Array.from({ length: 250 }, (_, index) => index),
      {
        reportTotal: true,
      },
    );
    return expect(collectAll(reader, { pageSize: 100 })).resolves.toHaveLength(250);
  });

  it("stops on an empty page", async () => {
    const reader = vi.fn(async () => ({ items: [] as number[] }));
    await expect(collectAll(reader)).resolves.toEqual([]);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page even when total claims there is more", async () => {
    // `total` can move between requests while rows are being written, so it cannot be trusted
    // to terminate the loop on its own.
    const reader = vi.fn(async ({ offset }: { limit: number; offset: number }) =>
      offset === 0 ? { items: [1, 2], total: 500 } : { items: [] as number[], total: 500 },
    );
    await expect(collectAll(reader, { pageSize: 2 })).resolves.toEqual([1, 2]);
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("treats a short page as the last page when there is no total", async () => {
    // GET /api/invoices reports no total, and the unpaginated lists omit limit and offset too.
    const reader = pagedReader([1, 2, 3], { reportTotal: false });
    await expect(collectAll(reader, { pageSize: 100 })).resolves.toEqual([1, 2, 3]);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("keeps paging on a full page when there is no total", async () => {
    const reader = pagedReader([1, 2, 3, 4, 5], { reportTotal: false });
    await expect(collectAll(reader, { pageSize: 2 })).resolves.toEqual([1, 2, 3, 4, 5]);
    // Two full pages, then a short one.
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it("throws at maxPages rather than returning a truncated list", async () => {
    // A silently short list is a bug nobody looks for inside a fetch helper.
    const reader = vi.fn(async () => ({ items: [1, 2] }));
    await expect(collectAll(reader, { pageSize: 2, maxPages: 3 })).rejects.toThrow(
      /stopped after 3 pages/,
    );
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it("advances the offset by what it has collected", async () => {
    const reader = pagedReader([1, 2, 3, 4, 5], { reportTotal: true });
    await collectAll(reader, { pageSize: 2 });
    expect(reader.mock.calls.map(([params]) => params.offset)).toEqual([0, 2, 4]);
  });

  it("defaults to a page size of 100, the documented maximum", async () => {
    const reader = pagedReader([1], { reportTotal: true });
    await collectAll(reader);
    expect(reader.mock.calls[0]?.[0].limit).toBe(100);
  });
});
