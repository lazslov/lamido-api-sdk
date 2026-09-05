/**
 * A stub `fetch`, and the two clients wired to it.
 *
 * @remarks
 * Every suite drives the real client through the real transport and asserts on what reached `fetch`.
 * Stubbing higher up would test the stub.
 */

import type { ServiceConfig } from "@lazslov/api-core";
import {
  type AuthClient,
  type AuthPublicClient,
  createAuthClient,
  createAuthPublicClient,
} from "../../src/client.js";

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
  lastMethod(): string | undefined;
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
    lastMethod() {
      return calls.at(-1)?.init.method;
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

/** A success response. A single resource is the body itself; a collection is `{ data, next_cursor }`. */
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

/** A `204` — the customer exchange and the logout answer with one. */
export function emptyResponse(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers });
}

/** The collection envelope. `next_cursor` is always present, `null` on the last page. */
export function collection(data: unknown[], nextCursor: string | null = null): Response {
  return jsonResponse({ data, next_cursor: nextCursor });
}

/** An RFC 9457 problem document, as every failure is served. */
export function problemResponse(
  status: number,
  slug: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `urn:auth-service:problem:${slug}`,
      title: titleFor(status),
      status,
      detail: `stub detail for ${status}`,
      instance: "/v1/authorize",
      request_id: "019fe8ee-fc09-71eb-bca3-25225321ffe3",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** `title` summarises the status, not the type — which is exactly why nothing branches on it. */
function titleFor(status: number): string {
  return status === 422 ? "Unprocessable Entity" : status === 409 ? "Conflict" : "Error";
}

/** A test publishable key. Not a credential, and shaped so the repository's leak guard tolerates it. */
export const testPublishableKey = "apk_YOUR_WEBSITE_KEY_test000";

/** A test application key. Same shape, same reason. */
export const testApplicationKey = "ask_YOUR_APPLICATION_KEY_test0";

/** A documentation host, so no real deployment name lands in a test. */
export const testBaseUrl = "https://auth.example.com";

/** A session token as a test hands it over. Not a credential. */
export const testSessionToken = "session-token-for-tests";

/** A browser client talking through `stub`. */
export function publicClient(stub: FetchStub, overrides: ServiceConfig = {}): AuthPublicClient {
  return createAuthPublicClient({
    baseUrl: testBaseUrl,
    apiKey: testPublishableKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** An application client talking through `stub`. */
export function authClient(stub: FetchStub, overrides: ServiceConfig = {}): AuthClient {
  return createAuthClient({
    baseUrl: testBaseUrl,
    apiKey: testApplicationKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A subscription, as client-api.md shows one. */
export function subscription(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "019f0a10-0000-7000-8000-0000000000c3",
    organization: "019f0a10-0000-7000-8000-0000000000b2",
    website: null,
    plan: "starter",
    status: "active",
    period_start: "2026-08-01T00:00:00.000Z",
    period_end: "2026-09-01T00:00:00.000Z",
    past_due_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A customer. Only the members the knowledge base documents. */
export function customer(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "019f0a10-0000-7000-8000-0000000000d4",
    status: "active",
    ...overrides,
  };
}
