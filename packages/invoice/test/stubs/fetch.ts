/**
 * A stub `fetch`, and a client wired to it.
 *
 * @remarks
 * Every suite here drives the real client through the real transport and asserts on what reached
 * `fetch` — the URL, the method, the headers and the body. Stubbing at any higher level would test the
 * stub.
 */

import type { ServiceConfig } from "@lazslov/api-core";
import { createInvoiceClient, type InvoiceClient } from "../../src/client.js";
import type { Invoice, InvoiceStatus } from "../../src/types.js";

/** One recorded call. */
export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A stub `fetch` plus the log of what it was called with. */
export interface FetchStub {
  readonly fetch: typeof fetch;
  readonly calls: RecordedCall[];
  /** The most recent call's URL, as a string. */
  lastUrl(): string;
  /** The most recent call's parsed JSON body, or `undefined` when it carried none. */
  lastBody(): unknown;
  /** The most recent call's headers, lower-cased. */
  lastHeaders(): Record<string, string>;
}

/**
 * Build a `fetch` that answers from a queue and records every call.
 *
 * @param responses - One response per call, in order. The last one repeats once exhausted, so a
 * single-response stub serves any number of calls.
 */
export function fetchStub(responses: Response[] = [jsonResponse(invoice())]): FetchStub {
  const calls: RecordedCall[] = [];
  let index = 0;

  return {
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return (response ?? jsonResponse(invoice())).clone();
    }) as unknown as typeof fetch,
    calls,
    lastUrl() {
      return calls.at(-1)?.url ?? "";
    },
    lastBody() {
      const body = calls.at(-1)?.init.body;
      return typeof body === "string" ? JSON.parse(body) : undefined;
    },
    lastHeaders() {
      const headers = (calls.at(-1)?.init.headers ?? {}) as Record<string, string>;
      return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
    },
  };
}

/** A JSON response. A single resource is the resource, unwrapped. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * An RFC 9457 problem document, at a status.
 *
 * @param status - The HTTP status.
 * @param slug - The problem slug, e.g. `"conflict"`. Wrapped into the service's own URN.
 * @param detail - The human sentence.
 * @param extra - Extension members: `code`, `errors`, `provider_error`, `retry_after`.
 */
export function errorResponse(
  status: number,
  slug: string,
  detail = `stub ${slug}`,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `urn:invoice-service:problem:${slug}`,
      title: `stub ${status}`,
      status,
      detail,
      instance: "/v1/invoices",
      request_id: "019839c2-7f3a-7a11-b0c1-4d2e6f8a9b01",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A `application/pdf` response, optionally carrying a `Content-Disposition`. */
export function pdfResponse(
  disposition?: string,
  bytes = new Uint8Array([37, 80, 68, 70]),
): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      ...(disposition === undefined ? {} : { "content-disposition": disposition }),
    },
  });
}

/**
 * A test client key.
 *
 * @remarks
 * Not a credential, and shaped so the repository's leak guard tolerates it: the guard treats a
 * `YOUR_`-prefixed tail as a documentation placeholder rather than a key.
 */
export const testClientKey = "isk_YOUR_CLIENT_KEY_test0000";

/** A documentation host, so no real deployment name lands in a test. */
export const testBaseUrl = "https://invoice.example.com";

/** A client reading and writing through `stub`. */
export function invoiceClient(stub: FetchStub, overrides: ServiceConfig = {}): InvoiceClient {
  return createInvoiceClient({
    baseUrl: testBaseUrl,
    apiKey: testClientKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/**
 * An invoice, with whatever a case needs overridden.
 *
 * @remarks
 * `gross_amount_minor` is a decimal string of minor units, and HUF is zero-decimal in this API —
 * so `"38100"` is 38 100 Ft, the same number the old major-unit field carried.
 */
export function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    public_id: "0199e4a9-13f2-7c14-9d5e-2a6b8c0d1f33",
    provider: "billingo",
    provider_config_id: "billingo_acme",
    status: "created" satisfies InvoiceStatus,
    invoice_number: "2026/0042",
    provider_invoice_id: "99123",
    gross_amount_minor: "38100",
    currency: "HUF",
    partner_ref: "order-2026-0001",
    error_message: null,
    created_at: "2026-07-25T09:14:03.221Z",
    updated_at: "2026-07-25T09:14:05.882Z",
    ...overrides,
  };
}

/** A minimal valid create body. */
export function createBody() {
  return {
    provider: "billingo",
    provider_config_id: "billingo_acme",
    partner: {
      name: "Teszt Vevő Kft",
      address: { postal_code: "1011", city: "Budapest", address: "Fő utca 1" },
    },
    // Minor units as a decimal string: 15 000 Ft, because HUF is zero-decimal here.
    items: [{ name: "Tanácsadás", quantity: 1, net_unit_price_minor: "15000", vat_rate: "27" }],
  } as const;
}

/** A list response, in the envelope every list on the service answers with. */
export function listResponse(items: unknown[], nextCursor: string | null = null): Response {
  return jsonResponse({ data: items, next_cursor: nextCursor });
}
