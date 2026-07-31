/**
 * A stub `fetch`, and a client wired to it.
 *
 * @remarks
 * Every suite drives the real client through the real transport and asserts on what reached `fetch`.
 * Stubbing higher up would test the stub.
 */

import type { ServiceConfig } from "@lazslov/api-core";
import { createPaymentClient, type PaymentClient } from "../../src/client.js";

/** One recorded call. */
export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A stub `fetch` plus the log of what it was called with. */
export interface FetchStub {
  readonly fetch: typeof fetch;
  readonly calls: RecordedCall[];
  lastUrl(): string;
  /** The most recent call's body, as text — so key order can be asserted, not just the values. */
  lastBodyText(): string;
  lastBody(): unknown;
  lastHeaders(): Record<string, string>;
}

/**
 * Build a `fetch` that answers from a queue and records every call.
 *
 * @param responses - One response per call, in order. The last repeats once exhausted.
 */
export function fetchStub(responses: Response[] = [jsonResponse({})]): FetchStub {
  const calls: RecordedCall[] = [];
  let index = 0;

  return {
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return (response ?? jsonResponse({})).clone();
    }) as unknown as typeof fetch,
    calls,
    lastUrl() {
      return calls.at(-1)?.url ?? "";
    },
    lastBodyText() {
      const body = calls.at(-1)?.init.body;
      return typeof body === "string" ? body : "";
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

/** A success response. This service has no envelope — the resource itself is the body. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** An RFC 7807 problem document, as every failure is served. */
export function problemResponse(
  status: number,
  type: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type,
      title: titleFor(status),
      status,
      detail: `stub detail for ${status}`,
      instance: "/v1/payments",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** `title` summarises the status, not the type — which is exactly why nothing branches on it. */
function titleFor(status: number): string {
  return status === 422 ? "Unprocessable Entity" : status === 409 ? "Conflict" : "Error";
}

/** A test merchant key. Not a credential, and shaped so the repository's leak guard tolerates it. */
export const testApiKey = "pmk_YOUR_MERCHANT_KEY_test00";

/** A documentation host, so no real deployment name lands in a test. */
export const testBaseUrl = "https://payment.example.com";

/** A merchant client talking through `stub`. */
export function paymentClient(stub: FetchStub, overrides: ServiceConfig = {}): PaymentClient {
  return createPaymentClient({
    baseUrl: testBaseUrl,
    apiKey: testApiKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A payment object, with whatever a case needs overridden. */
export function payment(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "019e4a91-3f2b-7c14-9d5e-2a6b8c0d1f33",
    merchant_payment_ref: "order-12345",
    amount_minor: "2500",
    currency: "HUF",
    status: "pending",
    provider: "barion",
    mode: "sandbox",
    provider_payment_id: null,
    provider_status: "Prepared",
    gateway_url: "https://secure.example.com/Pay?id=stub",
    redirect_url: null,
    metadata: null,
    expires_at: null,
    succeeded_at: null,
    failed_at: null,
    created_at: "2026-07-27T12:46:31.700Z",
    updated_at: "2026-07-27T12:46:31.700Z",
    ...overrides,
  };
}

/** A refund object. */
export function refund(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "019e4a95-77c1-7a02-8f31-9b0c4d5e6f70",
    payment_public_id: "019e4a91-3f2b-7c14-9d5e-2a6b8c0d1f33",
    amount_minor: "1000",
    currency: "HUF",
    status: "pending",
    outcome_unknown: false,
    reason: null,
    provider: "barion",
    mode: "sandbox",
    provider_refund_id: null,
    provider_status: null,
    created_at: "2026-07-27T14:02:11.140Z",
    updated_at: "2026-07-27T14:02:11.980Z",
    ...overrides,
  };
}
