/**
 * A stub `fetch`, and clients wired to it.
 *
 * @remarks
 * Every suite here drives the real client through the real transport and asserts on what reached
 * `fetch` — the URL, the method, the headers and the body. Stubbing at any higher level would test
 * the stub.
 */

import type { ServiceConfig } from "@lamido/api-core";
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
export function fetchStub(responses: Response[] = [jsonResponse({ data: {} })]): FetchStub {
  const calls: RecordedCall[] = [];
  let index = 0;

  return {
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return (response ?? jsonResponse({ data: {} })).clone();
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

/** A JSON response, the shape every endpoint but `/api/health` answers with. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The service's error envelope, at a status. */
export function errorResponse(status: number, code: string, details?: unknown): Response {
  return jsonResponse(
    { error: { code, message: `stub ${code}`, ...(details === undefined ? {} : { details }) } },
    status,
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
    publishedAt: string | null;
  }> = {},
) {
  return {
    page: {
      slug: page.slug ?? "home",
      title: page.title ?? "Kezdőlap",
      locale: page.locale ?? "hu",
      version: page.version === undefined ? 8 : page.version,
      publishedAt: page.publishedAt === undefined ? "2026-07-28T09:12:44.101Z" : page.publishedAt,
    },
    sections: sections.map((section) => ({
      key: section.key,
      type: section.type ?? section.key,
      fields: section.fields,
    })),
  };
}
