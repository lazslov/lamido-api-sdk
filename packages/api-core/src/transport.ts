import type { ResolvedConfig } from "./config.js";
import type { ErrorParser } from "./errors.js";
import { buildQuery, type QueryInit } from "./query.js";
import { parseJsonSafe, type ReadMode, type ResponseMeta, readBody } from "./read.js";

/** The methods the three services use. */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** One request, fully described. */
export interface RequestSpec {
  readonly method: HttpMethod;
  /** Always starts with `/`. Endpoint functions never build the origin. */
  readonly path: string;
  readonly query?: QueryInit;
  /** JSON-serialised only when present, so a GET carries no `Content-Type`. */
  readonly body?: unknown;
  /** Headers the endpoint itself needs, e.g. `Idempotency-Key`. */
  readonly headers?: Record<string, string>;
  /**
   * Framework escape hatch: `{ next: { tags: […] } }`, `{ cache: "no-store" }`, `{ signal }`.
   *
   * @remarks
   * Passed through to `fetch` intact. The SDK owns no caching — the framework does.
   */
  readonly init?: RequestInit;
  readonly read: ReadMode;
  readonly onError: ErrorParser;
}

/** Collect header-ish values into a plain object, whatever shape they arrived in. */
function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

export async function request<T>(
  cfg: ResolvedConfig,
  spec: RequestSpec & { read: ReadMode & { withMeta: true } },
): Promise<ResponseMeta<T>>;
export async function request<T>(cfg: ResolvedConfig, spec: RequestSpec): Promise<T>;
/**
 * The one function through which every request leaves the process.
 *
 * @param cfg - A resolved configuration; the only place the credential lives.
 * @param spec - The request.
 * @returns The value read according to `spec.read`, or a {@link ResponseMeta} wrapper when
 * `read.withMeta` is set.
 * @throws Whatever `spec.onError` returns, for any non-2xx response.
 * @remarks
 * No timeout, no retry, no backoff, and no `mode` — all deliberately absent. Retrying a write
 * needs idempotency the content endpoints do not have, and content-service explicitly warns
 * against copying invoice-service's `mode: "same-origin"` workaround. A caller who wants a
 * timeout passes an `AbortSignal` through `spec.init`.
 */
export async function request<T>(
  cfg: ResolvedConfig,
  spec: RequestSpec,
): Promise<T | ResponseMeta<T>> {
  if (!spec.path.startsWith("/")) {
    throw new TypeError(`request path must start with "/", received ${JSON.stringify(spec.path)}`);
  }

  cfg.onRequest?.({ method: spec.method, path: spec.path });

  const hasBody = spec.body !== undefined;
  const headers: Record<string, string> = {
    ...toHeaderRecord(cfg.defaultInit.headers),
    ...toHeaderRecord(spec.init?.headers),
    ...spec.headers,
    // Last, and unconditionally: a caller's init may set cache hints, never the credential.
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  const response = await cfg.fetch(`${cfg.baseUrl}${spec.path}${buildQuery(spec.query)}`, {
    ...cfg.defaultInit,
    ...spec.init,
    method: spec.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(spec.body) } : {}),
  });

  if (!response.ok) {
    throw spec.onError({
      status: response.status,
      body: await parseJsonSafe(response),
      headers: response.headers,
      requestPath: spec.path,
    });
  }

  const value = (await readBody(response, spec.read.kind)) as T;
  return spec.read.withMeta ? { value, status: response.status, headers: response.headers } : value;
}
