import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The revalidation route handler.
 *
 * @remarks
 * `next/cache` is replaced with spies, which is the only way to assert what the handler busts: the real
 * `revalidateTag` needs a Next request context and throws outside one. The mock is a factory, so the
 * real module is never loaded.
 */
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const { revalidateTag } = await import("next/cache");
const { createRevalidationHandler } = await import("../src/next/handler.js");
const { CONTENT_TAG } = await import("../src/next/tag.js");
const { createNextContentGateway } = await import("../src/next/gateway.js");
const { deliveryBody, deliveryRequest, testRevalidateSecret } = await import("./stubs/delivery.js");
const { fetchStub, jsonResponse, pageDocument, testBaseUrl, testSecretKey } = await import(
  "./stubs/fetch.js"
);

const revalidateTagSpy = vi.mocked(revalidateTag);

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.CONTENT_REVALIDATE_SECRET;
  delete process.env.CONTENT_REVALIDATE_SECRET;
  revalidateTagSpy.mockClear();
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CONTENT_REVALIDATE_SECRET;
  else process.env.CONTENT_REVALIDATE_SECRET = savedSecret;
});

/** A handler with the test secret supplied explicitly. */
function handler(options: Record<string, unknown> = {}) {
  return createRevalidationHandler({ secret: testRevalidateSecret, ...options });
}

/** The cache tags the last read through `stub` actually set. */
function tagsOf(stub: ReturnType<typeof fetchStub>): string[] | undefined {
  const init = (stub.calls.at(-1)?.init ?? {}) as { next?: { tags?: string[] } };
  return init.next?.tags;
}

describe("a valid delivery", () => {
  it("busts the tag and answers 200", async () => {
    const response = await handler()(deliveryRequest());

    expect(response.status).toBe(200);
    expect(revalidateTagSpy).toHaveBeenCalledTimes(1);
    expect(revalidateTagSpy.mock.calls[0]?.[0]).toBe(CONTENT_TAG);
  });

  it("busts an overridden tag instead", async () => {
    await handler({ tag: "acme-content" })(deliveryRequest());
    expect(revalidateTagSpy.mock.calls[0]?.[0]).toBe("acme-content");
  });

  it("calls onPublish with the verified event, after busting the tag", async () => {
    const seen: unknown[] = [];
    await handler({ onPublish: (event: unknown) => void seen.push(event) })(deliveryRequest());

    expect(seen).toEqual([
      {
        site: "acme_foundation",
        type: "page",
        slug: "home",
        collection: null,
        version: 8,
        publishedAt: "2026-07-28T09:12:44.101Z",
      },
    ]);
  });

  it("awaits an async onPublish before answering", async () => {
    let finished = false;
    const response = await handler({
      onPublish: async () => {
        await Promise.resolve();
        finished = true;
      },
    })(deliveryRequest());

    expect(finished).toBe(true);
    expect(response.status).toBe(200);
  });

  it("reads the secret from the environment when none is passed", async () => {
    process.env.CONTENT_REVALIDATE_SECRET = testRevalidateSecret;
    const response = await createRevalidationHandler()(deliveryRequest());
    expect(response.status).toBe(200);
  });
});

describe("the payload shapes that are easy to crash on", () => {
  it("survives slug: null, which means revalidate everything", async () => {
    const body = deliveryBody({ slug: null, version: null });
    const response = await handler()(deliveryRequest({ body }));

    expect(response.status).toBe(200);
    expect(revalidateTagSpy).toHaveBeenCalledTimes(1);
  });

  it("survives version: null on a page delivery", async () => {
    // Null for a collection item AND for a whole-site re-fire, so a page delivery can carry it too.
    const response = await handler()(deliveryRequest({ body: deliveryBody({ version: null }) }));
    expect(response.status).toBe(200);
  });

  it("handles a collection item", async () => {
    const body = deliveryBody({
      type: "collection_item",
      slug: "elso_hir",
      collection: "news",
      version: null,
    });
    const seen: { type?: string }[] = [];
    const response = await handler({ onPublish: (e: { type?: string }) => void seen.push(e) })(
      deliveryRequest({ body }),
    );

    expect(response.status).toBe(200);
    expect(seen[0]?.type).toBe("collection_item");
  });

  it("does not compare site, so a renamed slug does not reject your own deliveries", async () => {
    // The signing secret is per site: a valid signature already proves which tenant sent it.
    const response = await handler()(
      deliveryRequest({ body: deliveryBody({ site: "renamed_last_tuesday" }) }),
    );
    expect(response.status).toBe(200);
    expect(revalidateTagSpy).toHaveBeenCalledTimes(1);
  });
});

describe("a delivery that does not verify", () => {
  it("answers 400 for a stale timestamp and busts nothing", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 400);
    const response = await handler()(deliveryRequest({ timestamp: stale }));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("stale_timestamp");
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("answers 401 for a wrong signature", async () => {
    const response = await handler()(
      deliveryRequest({ secret: "whsec_EXAMPLE_WRONG_SECRET_00000" }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("bad_signature");
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("answers 401 for a missing signature", async () => {
    const response = await handler()(deliveryRequest({ signature: null }));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("missing_signature");
  });

  it("answers 400 for a body that verified but is not an event", async () => {
    const response = await handler()(deliveryRequest({ body: '{"nonsense":true}' }));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("malformed_body");
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("verifies before it parses — an unparseable body with a good signature is a 400, not a throw", async () => {
    const response = await handler()(deliveryRequest({ body: "not json at all" }));
    expect(response.status).toBe(400);
  });

  it("rejects a body mutated after signing", async () => {
    // The signature is over the raw bytes, so re-serialising a semantically identical body breaks it.
    const original = deliveryBody();
    const signed = deliveryRequest({ body: original });
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(JSON.parse(original)),
    });

    // Same keys, re-serialised in the same order — this one still verifies…
    expect((await handler()(tampered)).status).toBe(200);

    const reordered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify({ publishedAt: "2026-07-28T09:12:44.101Z", site: "acme_foundation" }),
    });
    // …and a genuinely different byte sequence does not.
    expect((await handler()(reordered)).status).toBe(401);
  });
});

describe("an unconfigured deployment", () => {
  it("answers 500 naming the variable, rather than throwing on import", async () => {
    // A route module that threw at import would take the whole route tree down, and would stop a site
    // building at all with an empty environment.
    const response = await createRevalidationHandler()(deliveryRequest());

    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/CONTENT_REVALIDATE_SECRET/);
  });

  it("can be constructed with no environment and no argument at all", () => {
    expect(() => createRevalidationHandler()).not.toThrow();
  });
});

describe("a delivery is idempotent", () => {
  it("answers 200 twice for the identical retried delivery", async () => {
    // The service retries once with the identical body, timestamp and signature. Two deliveries are
    // one publish, and busting the same tag twice costs nothing — so there is no dedupe here.
    const request = deliveryRequest();
    const retry = request.clone();

    expect((await handler()(request)).status).toBe(200);
    expect((await handler()(retry)).status).toBe(200);
    expect(revalidateTagSpy).toHaveBeenCalledTimes(2);
  });
});

describe("end to end: the tag a read sets is the tag a delivery busts", () => {
  it("matches by default, with neither side naming a string literal", async () => {
    // The failure this guards has no error message: two string literals in two files, a 200 from the
    // webhook, nothing invalidated, and content stale for as long as the time-based fallback.
    const stub = fetchStub([jsonResponse({ data: pageDocument([{ key: "hero", fields: {} }]) })]);
    const { published, tag } = createNextContentGateway({
      baseUrl: testBaseUrl,
      apiKey: testSecretKey,
      fetch: stub.fetch,
    });

    await published.getPage("home");
    const readTags = tagsOf(stub);

    const response = await createRevalidationHandler({ secret: testRevalidateSecret, tag })(
      deliveryRequest(),
    );

    expect(response.status).toBe(200);
    expect(readTags).toEqual([revalidateTagSpy.mock.calls[0]?.[0]]);
  });

  it("matches when both are overridden from one value", async () => {
    const stub = fetchStub([jsonResponse({ data: pageDocument([{ key: "hero", fields: {} }]) })]);
    const { published, tag } = createNextContentGateway({
      baseUrl: testBaseUrl,
      apiKey: testSecretKey,
      fetch: stub.fetch,
      tag: "acme-content",
    });

    await published.getPage("home");
    const readTags = tagsOf(stub);

    await createRevalidationHandler({ secret: testRevalidateSecret, tag })(deliveryRequest());

    expect(readTags).toEqual(["acme-content"]);
    expect(revalidateTagSpy.mock.calls[0]?.[0]).toBe("acme-content");
  });
});
