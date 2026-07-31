import { describe, expect, it } from "vitest";
import { ContentApiError } from "../src/errors.js";
import {
  contentClient,
  errorResponse,
  fetchStub,
  jsonResponse,
  pageDocument,
  testBaseUrl,
} from "./stubs/fetch.js";

describe("saving and publishing a page", () => {
  it("sends only the keys it was given, as a values map", async () => {
    const stub = fetchStub([jsonResponse({ data: pageDocument([{ key: "about", fields: {} }]) })]);
    await contentClient(stub).patchValues("home", { "about.title": "New" });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/pages/home/values`);
    expect(stub.calls.at(-1)?.init.method).toBe("PATCH");
    expect(stub.lastBody()).toEqual({ values: { "about.title": "New" } });
  });

  it("omits the locale entirely when none was asked for", async () => {
    const stub = fetchStub([jsonResponse({ data: pageDocument([]) })]);
    await contentClient(stub).patchValues("home", { "about.title": "New" }, { locale: "hu" });
    expect(stub.lastBody()).toEqual({ values: { "about.title": "New" }, locale: "hu" });
  });

  it("returns the draft document with a working section lookup", async () => {
    const stub = fetchStub([
      jsonResponse({ data: pageDocument([{ key: "about", fields: { title: "New" } }]) }),
    ]);
    const draft = await contentClient(stub).patchValues("home", { "about.title": "New" });
    expect(draft.section("about").fields).toEqual({ title: "New" });
  });

  it("publishes a page, and says so in the method name", async () => {
    const stub = fetchStub([
      jsonResponse({
        data: {
          version: 9,
          note: "Pontosítás",
          publishedBy: "acme/acme-web",
          createdAt: "2026-07-28T09:12:44.101Z",
          locales: ["hu"],
          document: pageDocument([]),
        },
      }),
    ]);
    const result = await contentClient(stub).publishPage("home", { note: "Pontosítás" });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/pages/home/publish`);
    expect(stub.lastBody()).toEqual({ note: "Pontosítás" });
    expect(result.version).toBe(9);
  });

  it("reports a publish blocked by empty required fields as a conflict that must not be retried", async () => {
    const stub = fetchStub([
      errorResponse(409, "conflict", { missing: ["about.title"], locales: ["hu"] }),
    ]);
    await expect(contentClient(stub).publishPage("home")).rejects.toMatchObject({
      code: "conflict",
      retryable: false,
      details: { missing: ["about.title"] },
    });
  });

  it("reports a lost publish race as retryable", async () => {
    // Retryable after reloading — and told apart from the case above by details, never by message.
    const stub = fetchStub([errorResponse(409, "conflict")]);
    await expect(contentClient(stub).publishPage("home")).rejects.toMatchObject({
      code: "conflict",
      retryable: true,
    });
  });

  it("keeps skipped fields non-optional to read on a restore", async () => {
    const stub = fetchStub([
      jsonResponse({
        data: {
          restored: ["about.title"],
          skipped: ["about.old_footnote"],
          document: pageDocument([]),
        },
      }),
    ]);
    const result = await contentClient(stub).restoreVersion("home", 7);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/pages/home/versions/7/restore`);
    expect(result.skipped).toEqual(["about.old_footnote"]);
  });

  it("reverts without writing a version row", async () => {
    const stub = fetchStub([
      jsonResponse({ data: { locales: ["hu"], document: pageDocument([]) } }),
    ]);
    const result = await contentClient(stub).revertPage("home");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/pages/home/revert`);
    expect(result.locales).toEqual(["hu"]);
  });

  it("reads a draft through the rendered endpoint, which is the only place a view exists", async () => {
    const stub = fetchStub([jsonResponse({ data: pageDocument([{ key: "about", fields: {} }]) })]);
    await contentClient(stub).getRenderedPage("home", { view: "draft" });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/rendered/pages/home?view=draft`);
  });
});

describe("diffDrafts", () => {
  it("names the keys where the draft differs from what is published", async () => {
    const stub = fetchStub([
      jsonResponse({
        data: pageDocument([
          { key: "about", fields: { title: "New", body: "Same" } },
          { key: "hero", fields: { title: "Only in draft" } },
        ]),
      }),
      jsonResponse({
        data: pageDocument([{ key: "about", fields: { title: "Old", body: "Same" } }]),
      }),
    ]);

    await expect(contentClient(stub).diffDrafts("home")).resolves.toEqual([
      "about.title",
      "hero.title",
    ]);
  });

  it("answers nothing when the two documents agree", async () => {
    const document = pageDocument([{ key: "about", fields: { title: "Same" } }]);
    const stub = fetchStub([jsonResponse({ data: document }), jsonResponse({ data: document })]);
    await expect(contentClient(stub).diffDrafts("home")).resolves.toEqual([]);
  });
});

describe("collection items", () => {
  it("creates an item without letting a caller set its status", async () => {
    const stub = fetchStub([jsonResponse({ data: { id: "1", status: "draft" } }, 201)]);
    await contentClient(stub).createItem("news", { values: { title: "Első hír" } });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/collections/news/items`);
    expect(stub.lastBody()).toEqual({ values: { title: "Első hír" } });
  });

  it("archives an item, which is the editor-facing remove", async () => {
    const stub = fetchStub([jsonResponse({ data: { id: "1", status: "archived" } })]);
    await contentClient(stub).archiveItem("news", "1");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/collections/news/items/1/archive`);
  });

  it("passes force through as a query flag on a hard delete", async () => {
    const stub = fetchStub([jsonResponse({ data: { id: "1", deleted: true, forced: true } })]);
    await contentClient(stub).deleteItem("news", "1", { force: true });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/collections/news/items/1?force=true`);
  });

  it("surfaces a delete refused by referencing records", async () => {
    const stub = fetchStub([errorResponse(409, "conflict", { recordCount: 3, itemId: "1" })]);
    await expect(contentClient(stub).deleteItem("beneficiaries", "1")).rejects.toMatchObject({
      code: "conflict",
      details: { recordCount: 3 },
    });
  });

  it("reorders when the order is complete", async () => {
    const stub = fetchStub([jsonResponse({ data: { collectionKey: "news", ids: ["b", "a"] } })]);
    const applied = await contentClient(stub).reorderItems("news", ["b", "a"], {
      expectedItemIds: ["a", "b"],
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/collections/news/items/reorder`);
    expect(stub.lastBody()).toEqual({ ids: ["b", "a"] });
    expect(applied).toEqual(["b", "a"]);
  });

  it("throws locally on an incomplete order, before any request", async () => {
    const stub = fetchStub();
    await expect(
      contentClient(stub).reorderItems("news", ["a"], { expectedItemIds: ["a", "b"] }),
    ).rejects.toThrow(/every item exactly once/);
    expect(stub.calls).toHaveLength(0);
  });

  it("throws locally on a duplicate and on an id that is not in the collection", async () => {
    const stub = fetchStub();
    const client = contentClient(stub);

    await expect(
      client.reorderItems("news", ["a", "a"], { expectedItemIds: ["a", "b"] }),
    ).rejects.toThrow(/cannot repeat/);
    await expect(
      client.reorderItems("news", ["a", "c"], { expectedItemIds: ["a", "b"] }),
    ).rejects.toThrow(/Not in the collection: c/);
    await expect(client.reorderItems("news", [], { expectedItemIds: [] })).rejects.toThrow(
      /between 1 and 500/,
    );
    expect(stub.calls).toHaveLength(0);
  });
});

describe("assets", () => {
  it("registers the pathname Blob returned, under the name that says so", async () => {
    const stub = fetchStub([jsonResponse({ data: { id: "0f2c", references: 0 } }, 201)]);
    await contentClient(stub).registerAsset({
      blobPathname: "sites/acme/hero-Xy7.jpg",
      url: "https://blob.example.com/sites/acme/hero-Xy7.jpg",
      contentType: "image/jpeg",
      size: 482_113,
      width: 1600,
      height: 900,
    });

    expect(stub.lastBody()).toEqual({
      pathname: "sites/acme/hero-Xy7.jpg",
      url: "https://blob.example.com/sites/acme/hero-Xy7.jpg",
      contentType: "image/jpeg",
      size: 482_113,
      width: 1600,
      height: 900,
    });
  });

  it("mints an upload token for one filename", async () => {
    const stub = fetchStub([
      jsonResponse({
        data: {
          token: "vercel_blob_client_stub",
          pathname: "sites/acme/hero.jpg",
          allowedContentTypes: ["image/jpeg"],
          maximumSizeInBytes: 15_728_640,
        },
      }),
    ]);
    const token = await contentClient(stub).createUploadToken({
      filename: "hero.jpg",
      contentType: "image/jpeg",
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/assets/upload-token`);
    expect(token.maximumSizeInBytes).toBe(15_728_640);
  });

  it("maps a resolved image URL back to its asset id", async () => {
    const stub = fetchStub([
      jsonResponse({
        data: [
          { id: "a1", url: "https://blob.example.com/one.jpg" },
          { id: "b2", url: "https://blob.example.com/two.jpg" },
        ],
        total: 2,
        limit: 100,
        offset: 0,
      }),
    ]);
    await expect(
      contentClient(stub).getAssetIdByUrl("https://blob.example.com/two.jpg"),
    ).resolves.toBe("b2");
  });

  it("answers null rather than failing the form when the library read fails", async () => {
    // The documented degradation is "alt text is not editable right now".
    const stub = fetchStub([errorResponse(500, "internal_error")]);
    await expect(
      contentClient(stub).getAssetIdByUrl("https://blob.example.com/one.jpg"),
    ).resolves.toBeNull();
  });
});

describe("dataset records", () => {
  it("reports created: false on a replay rather than throwing", async () => {
    // A redelivered payment webhook. An error here would make a provider retry forever.
    const stub = fetchStub([jsonResponse({ data: { id: "8a3e" }, created: false }, 200)]);
    const result = await contentClient(stub).createRecord("donations", {
      externalId: "cs_test_a1b2c3",
      occurredAt: "2026-03-01T12:00:00Z",
      data: { amountForint: 5000 },
    });

    expect(result.created).toBe(false);
    expect(result.record).toEqual({ id: "8a3e" });
  });

  it("reports created: true for a new row, and sends the event time it was given", async () => {
    const stub = fetchStub([jsonResponse({ data: { id: "8a3e" }, created: true }, 201)]);
    const result = await contentClient(stub).createRecord("donations", {
      externalId: "cs_test_a1b2c3",
      occurredAt: "2026-03-01T12:00:00Z",
      data: { amountForint: 5000 },
    });

    expect(result.created).toBe(true);
    expect(stub.lastBody()).toEqual({
      data: { amountForint: 5000 },
      occurredAt: "2026-03-01T12:00:00Z",
      externalId: "cs_test_a1b2c3",
    });
  });

  it("asks for sensitive values only when told to, and never by default", async () => {
    const stub = fetchStub([jsonResponse({ data: { id: "8a3e", withheld: [] } })]);
    const client = contentClient(stub);

    await client.getRecord("donations", "8a3e");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/client/datasets/donations/records/8a3e`);

    await client.getRecord("donations", "8a3e", { includeSensitive: true });
    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/api/client/datasets/donations/records/8a3e?include=sensitive`,
    );
  });

  it("answers null for a record that is gone", async () => {
    const stub = fetchStub([errorResponse(404, "not_found")]);
    await expect(contentClient(stub).getRecord("donations", "gone")).resolves.toBeNull();
  });

  it("throws for a client-tier aggregate on an unknown dataset, which has no public gate", async () => {
    const stub = fetchStub([errorResponse(404, "not_found")]);
    await expect(contentClient(stub).getDatasetAggregate("typo")).rejects.toBeInstanceOf(
      ContentApiError,
    );
  });

  it("repeats eq filters on a record list", async () => {
    const stub = fetchStub([jsonResponse({ data: [], total: 0, limit: 20, offset: 0 })]);
    await contentClient(stub).getRecords("donations", {
      eq: ["manual:false", "beneficiaryId:3f1c"],
    });

    expect(new URL(stub.lastUrl()).searchParams.getAll("eq")).toEqual([
      "manual:false",
      "beneficiaryId:3f1c",
    ]);
  });
});
