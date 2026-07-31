import { describe, expect, it, vi } from "vitest";

/**
 * `updateTag` in an action, `revalidateTag` in the webhook.
 *
 * @remarks
 * Not interchangeable, and Next enforces it: `updateTag` throws *"can only be called from within a
 * Server Action"* from a route handler. This file covers a Next that has both — the fallback for a Next
 * that has only `revalidateTag` is `next-revalidate-legacy.test.ts`, a separate file because a module
 * mock is per file and a Next 14 namespace is a different module shape, not a different call.
 */
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const { revalidateTag, updateTag } = await import("next/cache");
const { revalidateAfterWrite } = await import("../src/next/revalidate.js");
const { CONTENT_TAG } = await import("../src/next/tag.js");

describe("revalidateAfterWrite on a Next that has updateTag", () => {
  it("prefers updateTag, for read-your-own-writes in the editor's same request", () => {
    vi.mocked(updateTag).mockClear();
    vi.mocked(revalidateTag).mockClear();

    revalidateAfterWrite();

    expect(vi.mocked(updateTag).mock.calls).toEqual([[CONTENT_TAG]]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("uses the tag it is given", () => {
    vi.mocked(updateTag).mockClear();
    revalidateAfterWrite("acme-content");
    expect(vi.mocked(updateTag).mock.calls).toEqual([["acme-content"]]);
  });

  it("defaults to the same constant the gateway and the handler default to", () => {
    expect(CONTENT_TAG).toBe("content");
  });
});
