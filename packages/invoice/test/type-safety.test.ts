import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { isoDate } from "../src/dates.js";
import type { components } from "../src/generated/schema.js";
import type { CancelledInvoice, CreateInvoiceInput, Invoice, InvoiceList } from "../src/types.js";
import { createBody, fetchStub, invoice, invoiceClient, jsonResponse } from "./stubs/fetch.js";

/**
 * The assertions that must fail at **compile** time, not at runtime.
 *
 * @remarks
 * Each `@ts-expect-error` is the assertion: `tsc` fails if the line it precedes turns out to be
 * *legal*, so `pnpm typecheck` is what runs this suite. The runtime bodies exist so the file is also a
 * readable list of what the types forbid.
 *
 * Note that the directive applies to the **following line**, so these calls are kept short enough that
 * the formatter cannot wrap them out from under it.
 */

describe("storno_number is reachable from the cancel and from nowhere else", () => {
  it("is a compile error on an invoice read from getInvoice", () => {
    const read: Invoice = invoice();
    // @ts-expect-error — there is no column for storno_number, so no read returns it. Rendering it on
    // a detail page is the documented silent failure: it type-checks and shows nothing forever.
    const wrong = read.storno_number;
    expect(wrong).toBeUndefined();
  });

  it("type-checks on the cancel's result", () => {
    const cancelled: CancelledInvoice = {
      ...invoice({ status: "canceled" }),
      storno_number: "2026/0043",
    };
    expect(cancelled.storno_number).toBe("2026/0043");
  });

  it("is optional there, because the provider may return none and the cancel still succeeded", () => {
    const noStorno: CancelledInvoice = invoice({ status: "canceled" });
    expect(noStorno.storno_number).toBeUndefined();
  });
});

describe("a list carries no total", () => {
  it("is a compile error to read one", () => {
    const list: InvoiceList = { items: [], nextCursor: null };
    // @ts-expect-error — GET /v1/invoices returns no total. Math.ceil(total / limit) would be NaN.
    const pages = list.total;
    expect(pages).toBeUndefined();
  });

  it("is a compile error to read an offset, because the list is keyset-paged", () => {
    const list: InvoiceList = { items: [], nextCursor: null };
    // @ts-expect-error — there is no offset on a cursor list; `nextCursor` is the only handle.
    const offset = list.offset;
    expect(offset).toBeUndefined();
  });
});

describe("an invoice date cannot be a bare string", () => {
  it("rejects a correctly formatted string that never went through isoDate", () => {
    const bad = {
      ...createBody(),
      // @ts-expect-error — even "2026-08-02" must be built by isoDate(); the service forwards anything.
      due_date: "2026-08-02",
    } satisfies CreateInvoiceInput;
    expect(bad.due_date).toBe("2026-08-02");
  });

  it("accepts what isoDate produces", () => {
    const good: CreateInvoiceInput = { ...createBody(), due_date: isoDate("2026-08-02") };
    expect(good.due_date).toBe("2026-08-02");
  });
});

describe("items must be non-empty", () => {
  it("rejects an empty array at the type level", () => {
    const bad = {
      ...createBody(),
      // @ts-expect-error — the tuple type says at least one line, so the round trip is not needed.
      items: [],
    } satisfies CreateInvoiceInput;
    expect(bad.items).toEqual([]);
  });
});

describe("a create cannot happen without an idempotency key", () => {
  const client = invoiceClient(fetchStub([jsonResponse(invoice(), 201)]));

  it("has no createInvoice overload without one", () => {
    // @ts-expect-error — the key is the second argument and there is no overload lacking it.
    const call = () => client.createInvoice(createBody());
    expect(typeof call).toBe("function");
  });

  it("rejects a raw string as a key", () => {
    // @ts-expect-error — IdempotencyKey is branded: it must go through idempotencyKey().
    const call = () => client.createInvoice(createBody(), "order-1");
    expect(typeof call).toBe("function");
  });

  it("accepts a validated key", () => {
    expect(typeof idempotencyKey("invoice-order-2026-0001-attempt-1")).toBe("string");
  });
});

describe("gross_amount_minor is a minor-unit decimal string", () => {
  it("is string | null, matching payment-service's money model rather than contradicting it", () => {
    const created: Invoice = invoice();
    const pending: Invoice = invoice({ status: "pending", gross_amount_minor: null });
    // Only meaningful once `created` — and `?? 0` here would report a 0 Ft invoice as real.
    // HUF is zero-decimal in this API, so "38100" is 38 100 Ft.
    expect([created.gross_amount_minor, pending.gross_amount_minor]).toEqual(["38100", null]);
  });

  it("is not a number, so arithmetic on it does not silently compile", () => {
    // The field used to be a major-unit number. Anything that still adds it to a running total
    // has to be looked at, which is the point of the type change.
    expect(typeof invoice().gross_amount_minor).toBe("string");
  });
});

describe("the hand-written input still matches the generated contract", () => {
  it("satisfies CreateInvoiceRequest once the service's defaults are supplied", () => {
    // The input type is hand-written because the generated one marks defaulted fields required. This
    // is what keeps it honest: a renamed or retyped field on the wire fails the type-check here.
    const input: CreateInvoiceInput = { ...createBody(), due_date: isoDate("2026-08-02") };
    const wire = {
      ...input,
      items: input.items.map((item) => ({ ...item, unit: item.unit ?? "db" })),
      partner: { ...input.partner, address: { ...input.partner.address, country: "Magyarország" } },
      payment_method: "átutalás",
      currency: "HUF",
      language: "hu",
      e_invoice: true,
    } satisfies components["schemas"]["CreateInvoiceRequest"];
    expect(wire.provider).toBe("billingo");
  });
});
