import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  createBody,
  fetchStub,
  invoice,
  invoiceClient,
  jsonResponse,
  pdfResponse,
} from "./stubs/fetch.js";

/**
 * Every client-tier endpoint plus `/api/health`, driven through the real transport.
 *
 * @remarks
 * Phase 4's first exit criterion is that all six are callable and that no admin endpoint exists. The
 * absence is `public-surface.test.ts`'s job; this file is the presence, and it asserts the URL, the
 * method and the read path each one takes.
 */

const id = "6f1c2c8e-4b6d-4f2a-9c33-0b1f2a4d55aa";
const key = idempotencyKey("invoice-order-2026-0001-attempt-1");

describe("the six client-tier endpoints", () => {
  it("createInvoice posts the body to /api/invoices with its idempotency key", async () => {
    const stub = fetchStub([jsonResponse({ data: invoice() }, 201)]);
    const { invoice: created } = await invoiceClient(stub).createInvoice(createBody(), key);

    expect(stub.lastUrl()).toBe("https://invoice.example.com/api/invoices");
    expect(stub.calls[0]?.init.method).toBe("POST");
    expect(stub.lastHeaders()["idempotency-key"]).toBe(key);
    expect(stub.lastHeaders().authorization).toBe("Bearer isk_YOUR_CLIENT_KEY_test0000");
    expect(stub.lastBody()).toMatchObject({ provider: "billingo" });
    // Unwrapped from `data`, not returned as the envelope.
    expect(created.id).toBe(id);
  });

  it("listInvoices reads the envelope, filters and pages", async () => {
    const stub = fetchStub([jsonResponse({ data: [invoice()], limit: 50, offset: 0 })]);
    const page = await invoiceClient(stub).listInvoices({
      status: "failed",
      provider: "szamlazz",
      limit: 50,
      offset: 0,
    });

    expect(stub.lastUrl()).toBe(
      "https://invoice.example.com/api/invoices?status=failed&provider=szamlazz&limit=50&offset=0",
    );
    // The two siblings survive; `data` is renamed to `items`.
    expect(page).toEqual({ items: [invoice()], limit: 50, offset: 0 });
  });

  it("listInvoices sends no query parameters when given none", async () => {
    const stub = fetchStub([jsonResponse({ data: [], limit: 20, offset: 0 })]);
    await invoiceClient(stub).listInvoices();
    expect(stub.lastUrl()).toBe("https://invoice.example.com/api/invoices");
  });

  it("getInvoice reads one invoice out of the data envelope", async () => {
    const stub = fetchStub([jsonResponse({ data: invoice({ status: "pending" }) })]);
    const read = await invoiceClient(stub).getInvoice(id);

    expect(stub.lastUrl()).toBe(`https://invoice.example.com/api/invoices/${id}`);
    expect(stub.calls[0]?.init.method).toBe("GET");
    expect(read.status).toBe("pending");
  });

  it("getInvoicePdf reads bytes, not JSON", async () => {
    const stub = fetchStub([pdfResponse('inline; filename="2026-0042.pdf"')]);
    const pdf = await invoiceClient(stub).getInvoicePdf(id);

    expect(stub.lastUrl()).toBe(`https://invoice.example.com/api/invoices/${id}/pdf`);
    expect(new Uint8Array(pdf.bytes)).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("createDownloadLink returns the url and its expiry", async () => {
    const link = {
      url: "https://invoice.example.com/api/public/invoices/6f1c2c8e/pdf?token=1785312843.Qm9n",
      expiresAt: "2026-08-01T09:14:03.000Z",
    };
    const stub = fetchStub([jsonResponse({ data: link })]);

    expect(await invoiceClient(stub).createDownloadLink(id)).toEqual(link);
    expect(stub.lastUrl()).toBe(`https://invoice.example.com/api/invoices/${id}/download-link`);
  });

  it("cancelInvoice posts with no body at all", async () => {
    const stub = fetchStub([
      jsonResponse({ data: { ...invoice({ status: "cancelled" }), stornoNumber: "2026/0043" } }),
    ]);
    const cancelled = await invoiceClient(stub).cancelInvoice(id);

    expect(stub.lastUrl()).toBe(`https://invoice.example.com/api/invoices/${id}/cancel`);
    expect(stub.calls[0]?.init.method).toBe("POST");
    // No body, and therefore no Content-Type: the service neither requires nor reads one.
    expect(stub.calls[0]?.init.body).toBeUndefined();
    expect(stub.lastHeaders()["content-type"]).toBeUndefined();
    expect(cancelled.stornoNumber).toBe("2026/0043");
  });

  it("encodes an id that is not a bare uuid", async () => {
    const stub = fetchStub();
    await invoiceClient(stub).getInvoice("../admin/clients");
    expect(stub.lastUrl()).toBe("https://invoice.example.com/api/invoices/..%2Fadmin%2Fclients");
  });
});

describe("getHealth", () => {
  it("returns the bare body, with no data unwrapper applied to it", async () => {
    // A shared `unwrap(body.data)` here returns undefined — this endpoint has no envelope.
    const stub = fetchStub([jsonResponse({ status: "ok" })]);
    expect(await invoiceClient(stub).getHealth()).toEqual({ status: "ok" });
    expect(stub.lastUrl()).toBe("https://invoice.example.com/api/health");
  });

  it("returns the degraded body a 503 carries rather than throwing", async () => {
    // The service's own docs list "your client throws before reading it" as a live problem.
    const degraded = { status: "degraded", db: "unreachable", code: "ETIMEDOUT" };
    const stub = fetchStub([jsonResponse(degraded, 503)]);
    expect(await invoiceClient(stub).getHealth()).toEqual(degraded);
  });

  it("still throws for a failure that is not a health report", async () => {
    const stub = fetchStub([jsonResponse({ status: "nonsense" }, 503)]);
    await expect(invoiceClient(stub).getHealth()).rejects.toThrow();
  });
});

describe("a caller's init", () => {
  it("reaches fetch intact and cannot overwrite the credential", async () => {
    const stub = fetchStub();
    const signal = new AbortController().signal;
    await invoiceClient(stub).getInvoice(id, {
      init: { signal, headers: { Authorization: "Bearer isk_attacker" } },
    });

    expect(stub.calls[0]?.init.signal).toBe(signal);
    expect(stub.lastHeaders().authorization).toBe("Bearer isk_YOUR_CLIENT_KEY_test0000");
  });
});
