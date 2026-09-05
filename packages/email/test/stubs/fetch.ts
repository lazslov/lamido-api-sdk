/**
 * A stub `fetch`, and a client wired to it.
 *
 * @remarks
 * Every suite drives the real client through the real transport and asserts on what reached `fetch`.
 * Stubbing higher up would test the stub.
 */

import type { ServiceConfig } from "@lazslov/api-core";
import { createEmailClient, type EmailClient } from "../../src/client.js";

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

/** An RFC 9457 problem document, as every failure is served. */
export function problemResponse(
  status: number,
  slug: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `urn:email-service:problem:${slug}`,
      title: titleFor(status),
      status,
      detail: `stub detail for ${status}`,
      instance: "/v1/messages",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** `title` summarises the status, not the code — which is exactly why nothing branches on it. */
function titleFor(status: number): string {
  return status === 422 ? "Unprocessable Entity" : status === 409 ? "Conflict" : "Error";
}

/** A test tenant key. Not a credential, and shaped so the repository's leak guard tolerates it. */
export const testApiKey = "esk_YOUR_TENANT_KEY_test000";

/** A documentation host, so no real deployment name lands in a test. */
export const testBaseUrl = "https://email.example.com";

/** A tenant client talking through `stub`. */
export function emailClient(stub: FetchStub, overrides: ServiceConfig = {}): EmailClient {
  return createEmailClient({
    baseUrl: testBaseUrl,
    apiKey: testApiKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A message object, as the send answers it, with whatever a case needs overridden. */
export function message(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "0194c7a1-8f3e-7a2b-9c4d-1e5f6a7b8c9d",
    status: "queued",
    stream: "transactional",
    template: { key: "order.confirmation", version: 1 },
    to: "guest@example.com",
    subject: "Your order A-2291",
    from: { email: "hello@mail.example.com", name: "Example Kft." },
    provider: "resend",
    provider_message_id: null,
    attachment_count: 0,
    attempts: 0,
    error_code: null,
    metadata: { order_id: "A-2291" },
    created_at: "2026-08-09T09:14:03.221Z",
    ...overrides,
  };
}

/** A minimal valid send body. */
export function sendBody() {
  return {
    template: { key: "order.confirmation" },
    to: "guest@example.com",
    variables: { orderNumber: "A-2291" },
  } as const;
}
