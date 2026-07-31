/**
 * A stub `fetch`, and a client wired to it.
 *
 * @remarks
 * Every suite here drives the real client through the real transport and asserts on what reached
 * `fetch` — the URL, the method, the headers and the body. Stubbing at any higher level would test the
 * stub.
 */

import type { ServiceConfig } from "@lamido/api-core";
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
export function fetchStub(responses: Response[] = [jsonResponse({ data: invoice() })]): FetchStub {
  const calls: RecordedCall[] = [];
  let index = 0;

  return {
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return (response ?? jsonResponse({ data: invoice() })).clone();
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

/** A JSON response, the shape every endpoint but `/api/health` and the PDF answers with. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The service's error envelope, at a status. */
export function errorResponse(
  status: number,
  code: string,
  message = `stub ${code}`,
  details?: unknown,
): Response {
  return jsonResponse(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    status,
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

/** An invoice, with whatever a case needs overridden. */
export function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "6f1c2c8e-4b6d-4f2a-9c33-0b1f2a4d55aa",
    provider: "billingo",
    providerConfigId: "billingo_acme",
    status: "created" satisfies InvoiceStatus,
    invoiceNumber: "2026/0042",
    providerInvoiceId: "99123",
    grossAmount: 38100,
    currency: "HUF",
    partnerRef: "order-2026-0001",
    errorMessage: null,
    createdAt: "2026-07-25T09:14:03.221Z",
    updatedAt: "2026-07-25T09:14:05.882Z",
    ...overrides,
  };
}

/** A minimal valid create body. */
export function createBody() {
  return {
    provider: "billingo",
    providerConfigId: "billingo_acme",
    partner: {
      name: "Teszt Vevő Kft",
      address: { postalCode: "1011", city: "Budapest", address: "Fő utca 1" },
    },
    items: [{ name: "Tanácsadás", quantity: 1, netUnitPrice: 15000, vatRate: "27" }],
  } as const;
}
