import { describe, expect, it } from "vitest";
import { fetchStub, invoice, invoiceClient, jsonResponse } from "./stubs/fetch.js";

/**
 * Pagination without a `total`.
 *
 * @remarks
 * `GET /api/invoices` is the endpoint that forced branch 3 of core's paginator: with no `total` to
 * follow, a short page is the last page. `listInvoices`'s return type declares no `total` at all, which
 * `type-safety.test.ts` asserts is a compile error to read.
 */

/** One page of `count` invoices, as the service's envelope. */
function page(count: number, limit: number, offset = 0): Response {
  return jsonResponse({
    data: Array.from({ length: count }, (_, index) => invoice({ id: `invoice-${offset + index}` })),
    limit,
    offset,
  });
}

describe("listInvoices", () => {
  it("returns the rows and the two siblings the service echoed, and no total", async () => {
    const list = await invoiceClient(fetchStub([page(2, 20)])).listInvoices();
    expect(Object.keys(list).sort()).toEqual(["items", "limit", "offset"]);
    expect(list.items).toHaveLength(2);
  });
});

describe("listAllInvoices", () => {
  it("stops on a short page, which is the only end-of-list signal there is", async () => {
    const stub = fetchStub([page(100, 100, 0), page(100, 100, 100), page(7, 100, 200)]);
    const all = await invoiceClient(stub).listAllInvoices();

    expect(all).toHaveLength(207);
    expect(stub.calls).toHaveLength(3);
    expect(stub.calls[1]?.url).toContain("offset=100");
  });

  it("stops on an empty page", async () => {
    const stub = fetchStub([page(100, 100, 0), page(0, 100, 100)]);
    expect(await invoiceClient(stub).listAllInvoices()).toHaveLength(100);
    expect(stub.calls).toHaveLength(2);
  });

  it("makes exactly one request when the first page is short", async () => {
    const stub = fetchStub([page(3, 100)]);
    expect(await invoiceClient(stub).listAllInvoices()).toHaveLength(3);
    expect(stub.calls).toHaveLength(1);
  });

  it("carries the filters into every page and keeps them out of the paginator's window", async () => {
    const stub = fetchStub([page(1, 100)]);
    await invoiceClient(stub).listAllInvoices({ status: "created", provider: "billingo" });

    const url = stub.lastUrl();
    expect(url).toContain("status=created");
    expect(url).toContain("provider=billingo");
    expect(url).toContain("limit=100");
    expect(url).toContain("offset=0");
  });

  it("honours a smaller page size", async () => {
    const stub = fetchStub([page(2, 2, 0), page(1, 2, 2)]);
    expect(await invoiceClient(stub).listAllInvoices({ pageSize: 2 })).toHaveLength(3);
  });

  it("throws rather than truncating when the loop breaker is reached", async () => {
    // A silently short list is a bug nobody looks for inside a fetch helper. Raising maxPages is the
    // deliberate escape hatch for a tenant with more invoices than the default window.
    const stub = fetchStub([page(2, 2, 0)]);
    await expect(invoiceClient(stub).listAllInvoices({ pageSize: 2, maxPages: 2 })).rejects.toThrow(
      /without reaching the end/,
    );
  });
});
