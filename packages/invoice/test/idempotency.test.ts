import { derivedIdempotencyKey, idempotencyKey } from "@lamido/api-core";
import { describe, expect, it } from "vitest";
import { InvoiceApiError } from "../src/errors.js";
import {
  createBody,
  errorResponse,
  fetchStub,
  invoice,
  invoiceClient,
  jsonResponse,
} from "./stubs/fetch.js";

/**
 * The rule that separates this service from payment-service: **a key is consumed on first use,
 * whatever the outcome.**
 *
 * @remarks
 * A same-key retry after a failed create returns the stored `failed` row forever while looking like a
 * transient problem. Two exit criteria live here — `replayed` comes from the status code, and the
 * `provider_error` doc comment and error both state the new-key rule.
 */

const key = idempotencyKey("invoice-order-2026-0001-attempt-1");

describe("replayed comes from the status code, not the body", () => {
  it("is false on a 201, which issued a new invoice", async () => {
    const stub = fetchStub([jsonResponse({ data: invoice() }, 201)]);
    const result = await invoiceClient(stub).createInvoice(createBody(), key);
    expect(result.replayed).toBe(false);
  });

  it("is true on a 200, where nothing happened", async () => {
    const stub = fetchStub([jsonResponse({ data: invoice() }, 200)]);
    const result = await invoiceClient(stub).createInvoice(createBody(), key);
    expect(result.replayed).toBe(true);
  });

  it("is true on a 200 whose invoice came back failed — the case that looks transient", async () => {
    // The body says `failed`, the status says replay. Branching on the body would call this a fresh
    // failure and retry it, which is exactly what returns the same row forever.
    const stub = fetchStub([
      jsonResponse({ data: invoice({ status: "failed", errorMessage: "szamlazz error 54" }) }, 200),
    ]);
    const { invoice: replayed, replayed: wasReplay } = await invoiceClient(stub).createInvoice(
      createBody(),
      key,
    );

    expect(wasReplay).toBe(true);
    expect(replayed.status).toBe("failed");
  });

  it("is true on a 200 whose invoice is still pending", async () => {
    const stub = fetchStub([jsonResponse({ data: invoice({ status: "pending" }) }, 200)]);
    const result = await invoiceClient(stub).createInvoice(createBody(), key);
    expect(result.replayed).toBe(true);
    expect(result.invoice.status).toBe("pending");
  });
});

describe("a create's error says which key to use next", () => {
  it("marks a 502 retryable and names the new-key rule", async () => {
    const stub = fetchStub([
      errorResponse(502, "provider_error", "szamlazz error 54: Az agent kulcs hibás"),
    ]);

    const error = await invoiceClient(stub)
      .createInvoice(createBody(), key)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(InvoiceApiError);
    const invoiceError = error as InvoiceApiError;
    expect(invoiceError.code).toBe("provider_error");
    expect(invoiceError.retryable).toBe(true);
    // Retryable, but never under this key: the row is already stored as failed.
    expect(invoiceError.advice).toMatch(/NEW key/);
    expect(invoiceError.message).toContain("szamlazz error 54");
    expect(invoiceError.message).toMatch(/NEW key/);
  });

  it("points a 500 at the credential test rather than at backoff", async () => {
    const stub = fetchStub([errorResponse(500, "internal_error", "Internal error")]);

    const error = (await invoiceClient(stub)
      .createInvoice(createBody(), key)
      .catch((thrown: unknown) => thrown)) as InvoiceApiError;

    expect(error.code).toBe("internal_error");
    expect(error.retryable).toBe(true);
    expect(error.advice).toMatch(/credential test/);
    expect(error.advice).toMatch(/NEW key/);
  });

  it("does not attach the new-key advice to a 502 from cancel, where no key was spent", async () => {
    const stub = fetchStub([errorResponse(502, "provider_error", "Already stornoed at Billingo")]);

    const error = (await invoiceClient(stub)
      .cancelInvoice("6f1c2c8e")
      .catch((thrown: unknown) => thrown)) as InvoiceApiError;

    expect(error.retryable).toBe(true);
    expect(error.advice).not.toMatch(/NEW key/);
    expect(error.advice).toMatch(/reached and refused/);
  });
});

describe("the recommended key shape", () => {
  it("carries the attempt number to the header, visibly, from the call site", async () => {
    const stub = fetchStub([jsonResponse({ data: invoice() }, 201)]);
    await invoiceClient(stub).createInvoice(
      createBody(),
      derivedIdempotencyKey("invoice-order-2026-0001", 2),
    );
    expect(stub.lastHeaders()["idempotency-key"]).toBe("invoice-order-2026-0001-attempt-2");
  });
});
