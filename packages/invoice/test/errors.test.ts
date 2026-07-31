import { LamidoApiError } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { InvoiceApiError } from "../src/errors.js";
import { errorResponse, fetchStub, invoiceClient, jsonResponse } from "./stubs/fetch.js";

/**
 * conventions §5's error table. Construction failures — a missing base URL, a leaked key — live in
 * `clients.test.ts`, which controls the environment.
 */

const id = "6f1c2c8e-4b6d-4f2a-9c33-0b1f2a4d55aa";

/** Read one invoice against a stubbed failure, and return the error it threw. */
async function failing(response: Response): Promise<InvoiceApiError> {
  return (await invoiceClient(fetchStub([response]))
    .getInvoice(id)
    .catch((error: unknown) => error)) as InvoiceApiError;
}

describe("the error codes", () => {
  it("carries the service's own code, message and details through unchanged", async () => {
    const details = { formErrors: [], fieldErrors: { items: ["Array must contain at least 1"] } };
    const error = await failing(errorResponse(400, "validation_error", "Request failed", details));

    expect(error).toBeInstanceOf(InvoiceApiError);
    expect(error).toBeInstanceOf(LamidoApiError);
    expect(error.code).toBe("validation_error");
    expect(error.message).toBe("Request failed");
    expect(error.details).toEqual(details);
    expect(error.service).toBe("invoice-service");
    expect(error.requestPath).toBe(`/api/invoices/${id}`);
  });

  it("falls back to the status's own code when no envelope arrived", async () => {
    // An HTML error page from an edge proxy has no `error.code`, and inventing one from the message
    // would be branching on prose.
    const proxied = new Response("<html>504</html>", { status: 403 });
    expect((await failing(proxied)).code).toBe("forbidden");
  });

  it("treats an undocumented code as internal_error rather than trusting it", async () => {
    expect((await failing(errorResponse(418, "teapot"))).code).toBe("internal_error");
  });

  it("omits details entirely when the service sent none", async () => {
    const error = await failing(errorResponse(404, "not_found"));
    expect("details" in error).toBe(false);
  });
});

describe("retryable follows the service's table, not the status", () => {
  it("is true for provider_error and internal_error", async () => {
    expect((await failing(errorResponse(502, "provider_error"))).retryable).toBe(true);
    expect((await failing(errorResponse(500, "internal_error"))).retryable).toBe(true);
  });

  it("is false for everything else", async () => {
    for (const [status, code] of [
      [400, "validation_error"],
      [400, "bad_request"],
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
    ] as const) {
      const error = await failing(errorResponse(status, code));
      expect(error.retryable, `expected ${code} not to be retryable`).toBe(false);
    }
  });
});

describe("a 404 is never mapped to null", () => {
  it("throws, because non-existence and no-access are indistinguishable", async () => {
    // A 404 also answers for an invoice belonging to a different client, so an id you hold coming back
    // 404 is a bug — often a deployment holding the wrong key.
    await expect(
      invoiceClient(fetchStub([errorResponse(404, "not_found")])).getInvoice(id),
    ).rejects.toBeInstanceOf(InvoiceApiError);
  });
});

describe("nothing carries the credential", () => {
  it("keeps the key out of a serialised client, however it is printed", () => {
    const client = invoiceClient(fetchStub());
    for (const rendering of [JSON.stringify(client), String(client), Object.keys(client).join()]) {
      expect(rendering).not.toContain("YOUR_CLIENT_KEY");
    }
  });

  it("keeps the key, the host and the body out of a caught error", async () => {
    const stub = fetchStub([errorResponse(401, "unauthorized", "Invalid API key")]);
    const error = (await invoiceClient(stub)
      .getInvoice(id)
      .catch((thrown: unknown) => thrown)) as InvoiceApiError;

    const serialised = `${JSON.stringify(error)}${error.stack ?? ""}${error.message}`;
    expect(serialised).not.toContain("YOUR_CLIENT_KEY");
    expect(serialised).not.toContain("invoice.example.com");
  });
});

describe("a successful read is not an error", () => {
  it("resolves normally on a 200", async () => {
    const stub = fetchStub([jsonResponse({ data: { id, status: "created" } })]);
    await expect(invoiceClient(stub).getInvoice(id)).resolves.toMatchObject({ id });
  });
});
