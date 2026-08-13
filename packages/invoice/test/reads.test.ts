import { describe, expect, it } from "vitest";
import { fetchStub, invoice, invoiceClient, jsonResponse } from "./stubs/fetch.js";

/**
 * Keyset pagination without a `total`.
 *
 * @remarks
 * `GET /v1/invoices` reports no `total` — counting a filtered, unbounded table on every page is
 * not cheap — so `next_cursor` is the only end-of-list signal there is. **A short page is not the
 * last page**, which is the trap this suite exists to hold shut. `listInvoices`'s return type
 * declares no `total` at all, which `type-safety.test.ts` asserts is a compile error to read.
 */

/** One page of `count` invoices, as the service's envelope. */
function page(count: number, nextCursor: string | null, from = 0): Response {
  return jsonResponse({
    data: Array.from({ length: count }, (_, index) =>
      invoice({ public_id: `invoice-${from + index}` }),
    ),
    next_cursor: nextCursor,
  });
}

describe("listInvoices", () => {
  it("returns the rows and the cursor, and no total", async () => {
    const list = await invoiceClient(fetchStub([page(2, null)])).listInvoices();
    expect(Object.keys(list).sort()).toEqual(["items", "nextCursor"]);
    expect(list.items).toHaveLength(2);
    expect(list.nextCursor).toBeNull();
  });

  it("hands back the cursor verbatim, so it can be passed straight in again", async () => {
    const list = await invoiceClient(fetchStub([page(2, "MjAyNi0wNy0yNVQwOTo=")])).listInvoices();
    expect(list.nextCursor).toBe("MjAyNi0wNy0yNVQwOTo=");
  });
});

describe("listAllInvoices", () => {
  it("follows the cursor to the end", async () => {
    const stub = fetchStub([page(100, "c1", 0), page(100, "c2", 100), page(7, null, 200)]);
    const all = await invoiceClient(stub).listAllInvoices();

    expect(all).toHaveLength(207);
    expect(stub.calls).toHaveLength(3);
    expect(stub.calls[1]?.url).toContain("cursor=c1");
    expect(stub.calls[2]?.url).toContain("cursor=c2");
  });

  it("keeps going after a short page, because only the cursor terminates", async () => {
    // The bug this guards: a filtered keyset page can come back under `limit` with more behind
    // it. Stopping on a short page silently drops every row after the first gap.
    const stub = fetchStub([page(3, "c1", 0), page(50, null, 3)]);
    expect(await invoiceClient(stub).listAllInvoices()).toHaveLength(53);
    expect(stub.calls).toHaveLength(2);
  });

  it("makes exactly one request when the first page is the only one", async () => {
    const stub = fetchStub([page(3, null)]);
    expect(await invoiceClient(stub).listAllInvoices()).toHaveLength(3);
    expect(stub.calls).toHaveLength(1);
  });

  it("stops on an empty final page", async () => {
    const stub = fetchStub([page(50, "c1", 0), page(0, null, 50)]);
    expect(await invoiceClient(stub).listAllInvoices()).toHaveLength(50);
    expect(stub.calls).toHaveLength(2);
  });

  it("sends no cursor on the first request", async () => {
    // An empty `cursor=` is a malformed cursor, which the service answers with a 400.
    const stub = fetchStub([page(1, null)]);
    await invoiceClient(stub).listAllInvoices();
    expect(stub.lastUrl()).not.toContain("cursor=");
  });

  it("carries the filters into every page and keeps them out of the paginator's window", async () => {
    const stub = fetchStub([page(1, null)]);
    await invoiceClient(stub).listAllInvoices({ status: "created", provider: "billingo" });

    const url = stub.lastUrl();
    expect(url).toContain("status=created");
    expect(url).toContain("provider=billingo");
    expect(url).toContain("limit=50");
  });

  it("honours a smaller page size", async () => {
    const stub = fetchStub([page(2, "c1", 0), page(1, null, 2)]);
    expect(await invoiceClient(stub).listAllInvoices({ pageSize: 2 })).toHaveLength(3);
  });

  it("throws rather than truncating when the loop breaker is reached", async () => {
    // A silently short list is a bug nobody looks for inside a fetch helper. Raising maxPages is the
    // deliberate escape hatch for a tenant with more invoices than the default window.
    const stub = fetchStub([page(2, "always-more", 0)]);
    await expect(invoiceClient(stub).listAllInvoices({ pageSize: 2, maxPages: 2 })).rejects.toThrow(
      /without reaching the end/,
    );
  });
});
