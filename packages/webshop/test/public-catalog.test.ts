import { describe, expect, it } from "vitest";
import { WebshopApiError } from "../src/errors.js";
import {
  fetchStub,
  jsonResponse,
  listResponse,
  notModifiedResponse,
  problemResponse,
  product,
  publicClient,
  testBaseUrl,
  testPublishableKey,
} from "./stubs/fetch.js";

/**
 * The `wpk_` tier and its caching contract.
 *
 * @remarks
 * The transport treats a `304` as a failure, so the one thing this suite must prove is that a
 * conditional read turns it into a value rather than a thrown error — and that nothing else about
 * the error path changed on the way.
 */

const etag = '"0191f3b1-4c02-7a10-9d3e-6b1c0f2a55d7-products--24-1754835667512-24"';

describe("listProducts", () => {
  it("answers the page with its etag, and sends no validator when none was given", async () => {
    const stub = fetchStub([listResponse([product()], null, { etag })]);
    const read = await publicClient(stub).listProducts({ limit: 24 });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/products?limit=24`);
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testPublishableKey}`);
    expect(stub.lastHeaders()).not.toHaveProperty("if-none-match");
    expect(read.notModified).toBe(false);
    expect(read.etag).toBe(etag);
    expect(read.value.items).toHaveLength(1);
    expect(read.value.nextCursor).toBeNull();
  });

  it("sends the validator back as If-None-Match", async () => {
    const stub = fetchStub([listResponse([product()], null, { etag })]);
    await publicClient(stub).listProducts({ limit: 24, ifNoneMatch: etag });
    expect(stub.lastHeaders()["if-none-match"]).toBe(etag);
  });

  it("turns a 304 into notModified rather than an error", async () => {
    // The transport hands every non-2xx to the error parser; this tier's parser recognises the 304.
    const stub = fetchStub([notModifiedResponse(etag)]);
    const read = await publicClient(stub).listProducts({ limit: 24, ifNoneMatch: etag });

    expect(read.notModified).toBe(true);
    expect(read.etag).toBe(etag);
    expect(read).not.toHaveProperty("value");
  });

  it("answers a null etag when a proxy stripped the header", async () => {
    const stub = fetchStub([listResponse([product()])]);
    const read = await publicClient(stub).listProducts();
    expect(read.etag).toBeNull();
  });

  it("passes a cursor back verbatim", async () => {
    const stub = fetchStub([listResponse([], null)]);
    await publicClient(stub).listProducts({ cursor: "MjAyNi0wOC0xMHwwMTkx" });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/products?cursor=MjAyNi0wOC0xMHwwMTkx`);
  });

  it("still throws for every other failure", async () => {
    const stub = fetchStub([problemResponse(401, "urn:webshop-service:problem:unauthorized")]);
    await expect(publicClient(stub).listProducts()).rejects.toBeInstanceOf(WebshopApiError);
  });

  it("surfaces the service's 403 for a secret key on the public tier", async () => {
    // Outside a browser the SDK cannot know a wsk_ is wrong here; the service can, and says so.
    const stub = fetchStub([problemResponse(403, "urn:webshop-service:problem:forbidden")]);
    await expect(
      publicClient(stub, { apiKey: "wsk_YOUR_SECRET_KEY_test000" }).listProducts(),
    ).rejects.toMatchObject({ status: 403, type: "forbidden" });
  });
});

describe("getProduct", () => {
  it("answers the product with its etag", async () => {
    const stub = fetchStub([jsonResponse(product(), 200, { etag })]);
    const read = await publicClient(stub).getProduct("espresso_beans");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/products/espresso_beans`);
    expect(read?.notModified).toBe(false);
    expect(read?.value.slug).toBe("espresso_beans");
    expect(read?.etag).toBe(etag);
  });

  it("turns a 304 into notModified", async () => {
    const stub = fetchStub([notModifiedResponse(etag)]);
    const read = await publicClient(stub).getProduct("espresso_beans", { ifNoneMatch: etag });

    expect(stub.lastHeaders()["if-none-match"]).toBe(etag);
    expect(read?.notModified).toBe(true);
  });

  it("maps the documented 404 to null", async () => {
    const stub = fetchStub([problemResponse(404, "urn:webshop-service:problem:not-found")]);
    await expect(publicClient(stub).getProduct("no-such-slug")).resolves.toBeNull();
  });

  it("passes a caller's init through, and sets no fetch mode", async () => {
    const controller = new AbortController();
    const stub = fetchStub([jsonResponse(product(), 200, { etag })]);
    await publicClient(stub).getProduct("espresso_beans", { init: { signal: controller.signal } });

    expect(stub.calls.at(-1)?.init.signal).toBe(controller.signal);
    expect(stub.calls.at(-1)?.init.mode).toBeUndefined();
  });
});
