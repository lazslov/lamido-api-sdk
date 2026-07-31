import { describe, expect, it, vi } from "vitest";

/**
 * `revalidateAfterWrite` on Next 14 and 15, which have no `updateTag`.
 *
 * @remarks
 * A separate file rather than a case in `next-revalidate.test.ts`, because the thing being varied is the
 * **shape of the module** — a Next 14 `next/cache` namespace simply does not have the export — and a
 * module mock is per file in Vitest. Swapping it mid-file would mean re-importing the module under test
 * and reasoning about which copy each case holds.
 *
 * This is what a static `import { updateTag } from "next/cache"` would have cost: the whole subpath
 * would be unimportable on the two versions the peer range still claims.
 */
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

const { revalidateTag } = await import("next/cache");
const { revalidateAfterWrite } = await import("../src/next/revalidate.js");

describe("revalidateAfterWrite on a Next without updateTag", () => {
  it("falls back to revalidateTag, with Next 16's cache-life profile", () => {
    // `"max"` is required in Next 16 and preserves the pre-16 single-argument behaviour; on 14 and 15
    // it is an extra argument and is ignored.
    vi.mocked(revalidateTag).mockClear();

    revalidateAfterWrite("acme-content");

    expect(vi.mocked(revalidateTag).mock.calls).toEqual([["acme-content", "max"]]);
  });

  it("does not reach for an export that is not there", () => {
    // The capability check, not a try/catch: a thrown TypeError inside a server action would surface to
    // the editor as a failed save, for a tag that had in fact been expired.
    expect(() => revalidateAfterWrite()).not.toThrow();
  });
});
