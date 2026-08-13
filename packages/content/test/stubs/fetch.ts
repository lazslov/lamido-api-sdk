/**
 * A stub `fetch`, and clients wired to it.
 *
 * @remarks
 * Every suite here drives the real client through the real transport and asserts on what reached
 * `fetch` — the URL, the method, the headers and the body. Stubbing at any higher level would test
 * the stub.
 */

import type { ServiceConfig } from "@lazslov/api-core";
import { type ContentClient, createContentClient } from "../../src/client/create.js";
import { createWebsiteClient } from "../../src/website/create.js";
import type { WebsiteClient } from "../../src/website/reads.js";

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
 * A list response, in the one envelope every list on the service answers with.
 *
 * @param items - The rows.
 * @param siblings - `total`, `limit` and `offset` on an offset list; `next_cursor` to page.
 * @remarks
 * `next_cursor` defaults to `null` rather than being omitted, because that is the contract on
 * every list — including the ones that never page. A stub that omitted it would let a pager bug
 * pass here and fail in production.
 */
export function listResponse(
  items: unknown[],
  siblings: Record<string, unknown> = {},
  status = 200,
): Response {
  return jsonResponse({ data: items, next_cursor: null, ...siblings }, status);
}

/**
 * An RFC 9457 problem document, at a status.
 *
 * @param status - The HTTP status.
 * @param slug - The problem slug, e.g. `"conflict"`. Wrapped into the service's own URN.
 * @param extra - Extension members: `details`, `errors`, `code`, `retry_after`.
 */
export function errorResponse(
  status: number,
  slug: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `urn:content-service:problem:${slug}`,
      title: `stub ${status}`,
      status,
      detail: `stub ${slug}`,
      instance: "/v1/stub",
      request_id: "019fc236-0c4e-7e3f-8203-70fcad1d20e2",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A test secret key. Not a credential, and shaped so the repository's leak guard tolerates it. */
export const testSecretKey = "csk_YOUR_SECRET_KEY_test0000";

/** A test publishable key. */
export const testPublishableKey = "cpk_YOUR_PUBLISHABLE_KEY_test";

/** A documentation host, so no real deployment name lands in a test. */
export const testBaseUrl = "https://content.example.com";

/** A website client reading through `stub`. */
export function websiteClient(stub: FetchStub, overrides: ServiceConfig = {}): WebsiteClient {
  return createWebsiteClient({
    baseUrl: testBaseUrl,
    apiKey: testPublishableKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A client-tier client writing through `stub`. */
export function contentClient(stub: FetchStub, overrides: ServiceConfig = {}): ContentClient {
  return createContentClient({
    baseUrl: testBaseUrl,
    apiKey: testSecretKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A minimal page document, with whatever sections a case needs. */
export function pageDocument(
  sections: { key: string; type?: string; fields: Record<string, unknown> }[],
  page: Partial<{
    slug: string;
    title: string;
    locale: string;
    version: number | null;
    published_at: string | null;
  }> = {},
) {
  return {
    page: {
      slug: page.slug ?? "home",
      title: page.title ?? "Kezdőlap",
      locale: page.locale ?? "hu",
      version: page.version === undefined ? 8 : page.version,
      published_at:
        page.published_at === undefined ? "2026-07-28T09:12:44.101Z" : page.published_at,
    },
    sections: sections.map((section) => ({
      key: section.key,
      type: section.type ?? section.key,
      fields: section.fields,
    })),
  };
}
