import { type ResolvedConfig, resolveConfig, type ServiceConfig } from "../../src/config.js";
import { type ErrorParser, LamidoApiError } from "../../src/errors.js";

/** A recorded call, so a test can assert what actually reached `fetch`. */
export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A stub `fetch` plus the log of what it was called with. */
export interface FetchStub {
  readonly fetch: typeof fetch;
  readonly calls: RecordedCall[];
  /** Headers of the most recent call, lower-cased for case-insensitive assertions. */
  lastHeaders(): Record<string, string>;
}

/**
 * Build a `fetch` that answers with a fixed response and records every call.
 *
 * @param respond - Produces the response. Defaults to `200 {}`.
 */
export function fetchStub(respond: () => Response = () => jsonResponse({})): FetchStub {
  const calls: RecordedCall[] = [];
  const stub: FetchStub = {
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return respond();
    }) as unknown as typeof fetch,
    calls,
    lastHeaders() {
      const headers = (calls.at(-1)?.init.headers ?? {}) as Record<string, string>;
      return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
    },
  };
  return stub;
}

/** A JSON response, the shape most endpoints answer with. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A test key. Not a real credential, and shaped so the leak guard tolerates it. */
export const testApiKey = "csk_YOUR_TEST_KEY_abcdef123456";

/** A resolved config pointing at a documentation host, with the stub wired in. */
export function testConfig(overrides: ServiceConfig = {}): ResolvedConfig {
  return resolveConfig({
    serviceName: "content-service",
    env: { baseUrl: "TEST_BASE_URL", apiKey: "TEST_API_KEY" },
    config: {
      baseUrl: "https://content.example.com",
      apiKey: testApiKey,
      fetch: fetchStub().fetch,
      ...overrides,
    },
  });
}

/**
 * A fixed error parser, so a transport test asserts on the transport.
 *
 * @remarks
 * Deliberately **not** the real {@link problemParser}: these tests check that the transport
 * hands the parser a status, a body, headers and a path, which a parser that reads the body
 * would let a body-shape change break. The real reader has its own tests.
 */
export const testErrorParser: ErrorParser = (context) =>
  new LamidoApiError({
    service: "content-service",
    status: context.status,
    type: "unknown",
    message: `request failed with ${context.status}`,
    requestPath: context.requestPath,
    retryable: false,
    details: context.body ?? undefined,
  });
