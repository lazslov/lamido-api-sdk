import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  createBody,
  fetchStub,
  invoice,
  invoiceClient,
  jsonResponse,
  listResponse,
  pdfResponse,
} from "./stubs/fetch.js";

/**
 * Every client-tier endpoint plus `/healthz`, driven through the real transport.
 *
 * @remarks
 * Phase 4's first exit criterion is that all six are callable and that no admin endpoint exists. The
 * absence is `public-surface.test.ts`'s job; this file is the presence, and it asserts the URL, the
 * method and the read path each one takes.
 */
const id = "0199e4a9-13f2-7c14-9d5e-2a6b8c0d1f33";
const key = idempotencyKey("invoice-order-2026-0001-attempt-1");

describe("the six client-tier endpoints", () => {
  it("createInvoice posts the body to /v1/invoices with its idempotency key", async () => {
    const stub = fetchStub([jsonResponse(invoice(), 201)]);
    const { invoice: created } = await invoiceClient(stub).createInvoice(createBody(), key);

    expect(stub.lastUrl()).toBe("https://invoice.example.com/v1/invoices");
    expect(stub.calls[0]?.init.method).toBe("POST");
    expect(stub.lastHeaders()["idempotency-key"]).toBe(key);
    expect(stub.lastHeaders().authorization).toBe("Bearer isk_YOUR_CLIENT_KEY_test0000");
    expect(stub.lastBody()).toMatchObject({ provider: "billingo" });
    // The resource itself, unwrapped — there is no `data` wrapper any more.
    expect(created.public_id).toBe(id);
  });

  it("listInvoices reads the envelope, filters and pages", async () => {
    const stub = fetchStub([listResponse([invoice()])]);
    const page = await invoiceClient(stub).listInvoices({
      status: "failed",
      provider: "szamlazz",
      limit: 50,
      cursor: "c1",
    });

    expect(stub.lastUrl()).toBe(
      "https://invoice.example.com/v1/invoices?status=failed&provider=szamlazz&limit=50&cursor=c1",
    );
    // The cursor survives; `data` is renamed to `items`.
    expect(page).toEqual({ items: [invoice()], nextCursor: null });
  });

  it("listInvoices sends no query parameters when given none", async () => {
    const stub = fetchStub([listResponse([])]);
    await invoiceClient(stub).listInvoices();
    expect(stub.lastUrl()).toBe("https://invoice.example.com/v1/invoices");
  });

  it("getInvoice reads one invoice, unwrapped", async () => {
    const stub = fetchStub([jsonResponse(invoice({ status: "pending" }))]);
    const read = await invoiceClient(stub).getInvoice(id);

    expect(stub.lastUrl()).toBe(`https://invoice.example.com/v1/invoices/${id}`);
    expect(stub.calls[0]?.init.method).toBe("GET");
    expect(read.status).toBe("pending");
  });

  it("getInvoicePdf reads bytes, not JSON", async () => {
    const stub = fetchStub([pdfResponse('inline; filename="2026-0042.pdf"')]);
    const pdf = await invoiceClient(stub).getInvoicePdf(id);

    expect(stub.lastUrl()).toBe(`https://invoice.example.com/v1/invoices/${id}/pdf`);
    expect(new Uint8Array(pdf.bytes)).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("createDownloadLink returns the url and its expiry", async () => {
    const link = {
      url: "https://invoice.example.com/api/public/invoices/6f1c2c8e/pdf?token=1785312843.Qm9n",
      expiresAt: "2026-08-01T09:14:03.000Z",
    };
    const stub = fetchStub([jsonResponse(link)]);

    expect(await invoiceClient(stub).createDownloadLink(id)).toEqual(link);
    expect(stub.lastUrl()).toBe(`https://invoice.example.com/v1/invoices/${id}/download-link`);
  });

  it("cancelInvoice posts with no body at all", async () => {
    const stub = fetchStub([
      jsonResponse({ ...invoice({ status: "canceled" }), storno_number: "2026/0043" }),
    ]);
    const cancelled = await invoiceClient(stub).cancelInvoice(id);

    expect(stub.lastUrl()).toBe(`https://invoice.example.com/v1/invoices/${id}/cancel`);
    expect(stub.calls[0]?.init.method).toBe("POST");
    // No body, and therefore no Content-Type: the service neither requires nor reads one.
    expect(stub.calls[0]?.init.body).toBeUndefined();
    expect(stub.lastHeaders()["content-type"]).toBeUndefined();
    expect(cancelled.storno_number).toBe("2026/0043");
  });

  it("encodes an id that is not a bare uuid", async () => {
    const stub = fetchStub();
    await invoiceClient(stub).getInvoice("../admin/clients");
    expect(stub.lastUrl()).toBe("https://invoice.example.com/v1/invoices/..%2Fadmin%2Fclients");
  });
});

describe("getHealth", () => {
  it("returns the bare body, with no data unwrapper applied to it", async () => {
    // A shared `unwrap(body.data)` here returns undefined — this endpoint has no envelope.
    const stub = fetchStub([jsonResponse({ status: "ok" })]);
    expect(await invoiceClient(stub).getHealth()).toEqual({ status: "ok" });
    expect(stub.lastUrl()).toBe("https://invoice.example.com/healthz");
  });

  it("reports a degraded database in the body, at a 200", async () => {
    // The route stopped answering 503 for this. A monitor that checks `response.ok` and stops
    // there now reports a healthy service with an unreachable database — `status` is the check.
    const degraded = { status: "degraded", db: "unreachable", code: "ETIMEDOUT" };
    const stub = fetchStub([jsonResponse(degraded)]);
    expect(await invoiceClient(stub).getHealth()).toEqual(degraded);
  });

  it("throws for a non-2xx, because this route always answers 200", async () => {
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
