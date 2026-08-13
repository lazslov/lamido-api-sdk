import { LamidoApiError } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { InvoiceApiError } from "../src/errors.js";
import { errorResponse, fetchStub, invoice, invoiceClient, jsonResponse } from "./stubs/fetch.js";

/**
 * conventions §6's problem table. Construction failures — a missing base URL, a leaked key — live
 * in `clients.test.ts`, which controls the environment.
 */

const id = "0199e4a9-13f2-7c14-9d5e-2a6b8c0d1f33";

/** Read one invoice against a stubbed failure, and return the error it threw. */
async function failing(response: Response): Promise<InvoiceApiError> {
  return (await invoiceClient(fetchStub([response]))
    .getInvoice(id)
    .catch((error: unknown) => error)) as InvoiceApiError;
}

describe("the problem document", () => {
  it("carries the slug, the detail and the request id through unchanged", async () => {
    const errors = [{ pointer: "/items", code: "required", detail: "Required" }];
    const error = await failing(errorResponse(400, "validation", "Request failed", { errors }));

    expect(error).toBeInstanceOf(InvoiceApiError);
    expect(error).toBeInstanceOf(LamidoApiError);
    expect(error.type).toBe("validation");
    expect(error.message).toBe("Request failed");
    expect(error.errors).toEqual(errors);
    expect(error.requestId).toBe("019839c2-7f3a-7a11-b0c1-4d2e6f8a9b01");
    expect(error.service).toBe("invoice-service");
    expect(error.requestPath).toBe(`/v1/invoices/${id}`);
  });

  it("falls back to an unknown slug when no problem document arrived", async () => {
    // An HTML error page from an edge proxy has no `type`, and inventing one from the status
    // would be a guess presented as a fact from the service.
    const proxied = new Response("<html>504</html>", { status: 403 });
    expect((await failing(proxied)).type).toBe("unknown");
  });

  it("treats an undocumented slug as unknown rather than trusting it", async () => {
    expect((await failing(errorResponse(418, "teapot"))).type).toBe("unknown");
  });

  it("omits every optional member entirely when the service sent none", async () => {
    const error = await failing(errorResponse(404, "not-found"));
    expect("details" in error).toBe(false);
    expect("code" in error).toBe(false);
    expect("providerError" in error).toBe(false);
  });

  it("carries the provider's own text on a 502", async () => {
    const error = await failing(
      errorResponse(502, "internal", "Billingo refused", {
        provider_error: "Partner tax number invalid",
      }),
    );
    expect(error.providerError).toBe("Partner tax number invalid");
  });
});

describe("retryable follows the services' shared table", () => {
  it("is true for internal, at both statuses", async () => {
    expect((await failing(errorResponse(502, "internal"))).retryable).toBe(true);
    expect((await failing(errorResponse(500, "internal"))).retryable).toBe(true);
  });

  it("is true for a 422, because the state that forbade it can change", async () => {
    expect((await failing(errorResponse(422, "conflict"))).retryable).toBe(true);
  });

  it("is true for a 429, after waiting", async () => {
    const error = await failing(errorResponse(429, "rate-limit", "slow down", { retry_after: 30 }));
    expect(error.retryable).toBe(true);
    expect(error.retryAfter).toBe(30);
  });

  it("is false for everything else", async () => {
    for (const [status, slug] of [
      [400, "validation"],
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not-found"],
      [409, "conflict"],
    ] as const) {
      const error = await failing(errorResponse(status, slug));
      expect(error.retryable, `expected ${slug} at ${status} not to be retryable`).toBe(false);
    }
  });

  it("separates the two conflicts, which the slug alone cannot", async () => {
    // 409 is a duplicate; 422 is a state the identical request may find different later.
    expect((await failing(errorResponse(409, "conflict"))).retryable).toBe(false);
    expect((await failing(errorResponse(422, "conflict"))).retryable).toBe(true);
  });
});

describe("a 404 is never mapped to null", () => {
  it("throws, because non-existence and no-access are indistinguishable", async () => {
    // A 404 also answers for an invoice belonging to a different client, so an id you hold coming back
    // 404 is a bug — often a deployment holding the wrong key.
    await expect(
      invoiceClient(fetchStub([errorResponse(404, "not-found")])).getInvoice(id),
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
    const stub = fetchStub([jsonResponse(invoice({ public_id: id }))]);
    await expect(invoiceClient(stub).getInvoice(id)).resolves.toMatchObject({ public_id: id });
  });
});
