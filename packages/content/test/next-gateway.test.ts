import { describe, expect, it } from "vitest";
import { createNextContentGateway, LIVE_REVALIDATE_SECONDS } from "../src/next/gateway.js";
import { CONTENT_TAG } from "../src/next/tag.js";
import {
  fetchStub,
  jsonResponse,
  pageDocument,
  testBaseUrl,
  testSecretKey,
} from "./stubs/fetch.js";

/**
 * The three cache modes, asserted against what reached `fetch`.
 *
 * @remarks
 * This is the phase's most valuable assertion, because the bug it guards — reaching for
 * `cache: "no-store"` to get a fresh total, and silently un-statifying the whole route — produces no
 * error, is hidden entirely by a keyless local build, and is invisible in a code review of the diff.
 * The only mechanical proof is what the init bag says.
 */

/** The init `fetch` was called with, as the Next-augmented shape. */
function lastInit(stub: ReturnType<typeof fetchStub>): {
  next?: { tags?: string[]; revalidate?: number | false };
  cache?: string;
} {
  return (stub.calls.at(-1)?.init ?? {}) as never;
}

/** A stub answering a well-formed page document, which every read here is happy with. */
function pageStub(): ReturnType<typeof fetchStub> {
  return fetchStub([jsonResponse(pageDocument([{ key: "hero", fields: {} }]))]);
}

/** A gateway reading through `stub`. */
function gateway(stub: ReturnType<typeof fetchStub>, overrides = {}) {
  return createNextContentGateway({
    baseUrl: testBaseUrl,
    apiKey: testSecretKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

describe("mode A — published, tagged", () => {
  it("sets the tag the webhook busts, and nothing else", async () => {
    const stub = pageStub();
    await gateway(stub).published.getPage("home");

    expect(lastInit(stub).next).toEqual({ tags: [CONTENT_TAG] });
    expect(lastInit(stub).cache).toBeUndefined();
  });

  it("carries the tag on every read of the tier, not just the first", async () => {
    const stub = pageStub();
    const { published } = gateway(stub);
    await published.getSite();
    await published.listPages();

    for (const call of stub.calls) {
      expect((call.init as { next?: { tags?: string[] } }).next?.tags).toEqual([CONTENT_TAG]);
    }
  });

  it("uses an overridden tag", async () => {
    const stub = pageStub();
    await gateway(stub, { tag: "acme-content" }).published.getPage("home");
    expect(lastInit(stub).next).toEqual({ tags: ["acme-content"] });
  });
});

describe("mode B — live, a short window", () => {
  it("sets a revalidate window and never no-store", async () => {
    // The whole reason this mode exists: `no-store` was reached for here, for an honest reason.
    const stub = pageStub();
    await gateway(stub).live.getDatasetAggregate("donations");

    expect(lastInit(stub).next).toEqual({ revalidate: LIVE_REVALIDATE_SECONDS });
    expect(lastInit(stub).cache).toBeUndefined();
  });

  it("defaults to ten seconds, which is what the service declares for the same data", () => {
    expect(LIVE_REVALIDATE_SECONDS).toBe(10);
  });

  it("takes a different window", async () => {
    const stub = pageStub();
    await gateway(stub, { liveRevalidateSeconds: 60 }).live.getDatasetAggregate("donations");
    expect(lastInit(stub).next).toEqual({ revalidate: 60 });
  });

  it("sets no tag, because no publish invalidates this data", async () => {
    // The records are written by the site's own backend, not by an editor — there is no webhook to
    // wait for, so a tag would be a mechanism nothing ever triggers.
    const stub = pageStub();
    await gateway(stub).live.getDatasetAggregate("donations");
    expect(lastInit(stub).next?.tags).toBeUndefined();
  });
});

describe("mode C — the write tier, uncached", () => {
  it("sets no-store, which is correct here and only here", async () => {
    const stub = pageStub();
    await gateway(stub).client.getMe();

    expect(lastInit(stub).cache).toBe("no-store");
    expect(lastInit(stub).next).toBeUndefined();
  });

  it("applies to a write as well as to a draft read", async () => {
    const stub = pageStub();
    await gateway(stub).client.patchValues("home", { "hero.title": "Új cím" });
    expect(lastInit(stub).cache).toBe("no-store");
  });
});

describe("the gateway's shape", () => {
  it("offers exactly three modes plus the tag", () => {
    // No fourth, uncached reader. Mode C is the write tier, so `no-store` is not reachable from
    // anything a page renders through.
    expect(Object.keys(gateway(pageStub())).sort()).toEqual(["client", "live", "published", "tag"]);
  });

  it("reports the tag it set, so the handler can be given the same value", () => {
    expect(gateway(pageStub()).tag).toBe(CONTENT_TAG);
    expect(gateway(pageStub(), { tag: "acme-content" }).tag).toBe("acme-content");
  });

  it("lets a per-call init win over the mode, which is what an escape hatch is for", async () => {
    const stub = pageStub();
    await gateway(stub).published.getPage("home", {
      init: { next: { revalidate: 3600 } } as never,
    });
    expect(lastInit(stub).next).toEqual({ revalidate: 3600 });
  });

  it("still keeps the credential off the published readers", async () => {
    const stub = pageStub();
    const { published } = gateway(stub);
    await published.getPage("home");

    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testSecretKey}`);
    expect(JSON.stringify(published)).not.toContain("csk_");
  });
});
