import { describe, expect, it } from "vitest";
import { ContentApiError } from "../src/errors.js";
import {
  errorResponse,
  fetchStub,
  jsonResponse,
  listResponse,
  pageDocument,
  testBaseUrl,
  websiteClient,
} from "./stubs/fetch.js";

describe("the website tier's reads", () => {
  it("lists published pages without any query parameters", async () => {
    // Not even a locale: a page's title is a column on the page, not a localised value.
    const stub = fetchStub([listResponse([{ slug: "home", title: "Kezdőlap", version: 8 }])]);
    const pages = await websiteClient(stub).listPages();

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/pages`);
    expect(pages).toHaveLength(1);
  });

  it("reads a page and passes the locale through", async () => {
    const stub = fetchStub([jsonResponse(pageDocument([{ key: "hero", fields: {} }]))]);
    const page = await websiteClient(stub).getPage("home", { locale: "hu" });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/pages/home?locale=hu`);
    expect(page?.slug).toBe("home");
  });

  it("answers null for an unpublished page", async () => {
    // A 404 is the normal state of a freshly provisioned site, not an error.
    const stub = fetchStub([errorResponse(404, "not_found")]);
    await expect(websiteClient(stub).getPage("unpublished")).resolves.toBeNull();
  });

  it("throws for a 401 from the same call", async () => {
    // Returning null here would render an empty page over a credential problem.
    const stub = fetchStub([errorResponse(401, "unauthorized")]);
    await expect(websiteClient(stub).getPage("home")).rejects.toBeInstanceOf(ContentApiError);
  });

  it("reads site chrome, including an empty settings object", async () => {
    const stub = fetchStub([
      jsonResponse({
        slug: "acme",
        name: "Acme",
        default_locale: "hu",
        locales: ["hu"],
        locale: "hu",
        settings: {},
      }),
    ]);
    const site = await websiteClient(stub).getSite();

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/site`);
    expect(site.settings).toEqual({});
  });

  it("keeps a collection list's total, so it can be paged to the end", async () => {
    const stub = fetchStub([listResponse([{ id: "1" }], { total: 12, limit: 20, offset: 0 })]);
    const page = await websiteClient(stub).getCollection("news", { limit: 20, offset: 0 });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/collections/news?limit=20&offset=0`);
    expect(page).toEqual({ items: [{ id: "1" }], total: 12, limit: 20, offset: 0 });
  });

  it("answers null for a collection that is not defined", async () => {
    const stub = fetchStub([errorResponse(404, "not_found")]);
    await expect(websiteClient(stub).getCollection("nope")).resolves.toBeNull();
  });

  it("reads one item by slug or by id", async () => {
    const stub = fetchStub([jsonResponse({ id: "1", slug: "elso_hir" })]);
    await websiteClient(stub).getCollectionItem("news", "elso_hir");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/collections/news/items/elso_hir`);
  });

  it("builds an aggregate query with joined metrics and repeated filters", async () => {
    const stub = fetchStub([listResponse([], { total: 0, limit: 100, offset: 0 })]);
    await websiteClient(stub).getDatasetAggregate("donations", {
      groupBy: "beneficiaryId",
      metrics: ["count", "sum:amountForint"],
      eq: ["manual:false"],
      from: "2026-01-01T00:00:00Z",
    });

    const url = new URL(stub.lastUrl());
    expect(url.pathname).toBe("/v1/public/datasets/donations/aggregate");
    expect(url.searchParams.get("metrics")).toBe("count,sum:amountForint");
    expect(url.searchParams.getAll("eq")).toEqual(["manual:false"]);
    expect(url.searchParams.get("groupBy")).toBe("beneficiaryId");
  });

  it("answers null for an aggregate that is not public, never a zero", async () => {
    // A progress bar at 0% is a lie about money, so unknown must stay distinguishable.
    const stub = fetchStub([errorResponse(404, "not_found")]);
    await expect(websiteClient(stub).getDatasetAggregate("donations")).resolves.toBeNull();
  });

  it("passes a framework init through to fetch intact", async () => {
    const stub = fetchStub([jsonResponse(pageDocument([]))]);
    await websiteClient(stub).getPage("home", {
      init: { next: { tags: ["content"] } } as RequestInit,
    });

    expect(stub.calls.at(-1)?.init).toMatchObject({ next: { tags: ["content"] } });
  });

  it("sends the credential as a bearer token and nothing else about it", async () => {
    const stub = fetchStub([listResponse([])]);
    await websiteClient(stub).listPages();

    expect(stub.lastHeaders().authorization).toMatch(/^Bearer cpk_/);
    expect(stub.lastHeaders()["content-type"]).toBeUndefined();
  });

  it("has no way to ask for a draft, because every non-published view is a 403 here", () => {
    const client = websiteClient(fetchStub());
    // A parameter whose only non-default value is guaranteed to fail has no reason to exist.
    expect(Object.keys(client)).not.toContain("view");
    expect(JSON.stringify(Object.keys(client))).not.toContain("draft");
  });
});
