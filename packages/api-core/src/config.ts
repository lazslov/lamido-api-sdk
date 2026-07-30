import { NotConfiguredError } from "./errors.js";

/**
 * What a consumer may supply when constructing a client.
 *
 * @remarks
 * Every field is optional: a client constructed with no argument reads the service's
 * documented environment variables, and explicit values always win over the environment, so
 * one process can hold two clients for two tenants.
 */
export interface ServiceConfig {
  /** Absolute origin. Trailing slashes are stripped. There is no fallback — see the README. */
  baseUrl?: string;
  /** The bearer token, verbatim. Never parsed, never logged. */
  apiKey?: string;
  /** Injected for tests, or to wrap the call with a consumer's own instrumentation. */
  fetch?: typeof fetch;
  /** Merged into every request's init, beneath the caller's own per-call init. */
  defaultInit?: RequestInit;
  /** Called before each request with the method and path — never headers, never the key. */
  onRequest?: (event: { method: string; path: string }) => void;
}

/** A validated configuration. The only thing {@link ../transport.js} accepts. */
export interface ResolvedConfig {
  readonly serviceName: string;
  /** Absolute origin with no trailing slash. */
  readonly baseUrl: string;
  /**
   * The bearer token.
   *
   * @remarks
   * Defined as a **non-enumerable** property, so `JSON.stringify`, `console.log` and
   * `util.inspect` of a client or its config cannot print it. The type says it is here; the
   * runtime declines to enumerate it.
   */
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly defaultInit: RequestInit;
  readonly onRequest?: (event: { method: string; path: string }) => void;
}

/** Which environment variables a service reads, named by the service package. */
export interface EnvKeys {
  readonly baseUrl: string;
  readonly apiKey: string;
}

/** Arguments to {@link resolveConfig}. */
export interface ResolveConfigInput {
  readonly serviceName: string;
  /**
   * Variable names, supplied by the service package.
   *
   * @remarks
   * Core never hard-codes one, and a test asserts it names none. The three services do not even
   * agree on the pattern — one documents its base URL under a differently suffixed name than the
   * other two — and a consumer talking to two tenants overrides them with explicit config anyway.
   */
  readonly env: EnvKeys;
  readonly config?: ServiceConfig;
}

/**
 * Read an environment variable, on a runtime that may not have `process`.
 *
 * @remarks
 * Edge runtimes and browsers have no `process`. Reading it unguarded is a `ReferenceError`
 * at module scope, which is a crash rather than the configuration error we want to report.
 */
function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}

/** Strip trailing slashes so path concatenation cannot produce a double slash. */
function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Resolve explicit configuration over the environment, and validate the result.
 *
 * @param input - Service name, the variable names to read, and any explicit config.
 * @returns A configuration ready for {@link ../transport.js}.
 * @throws {@link NotConfiguredError} when the base URL or key is missing or unusable. There is
 * no fallback host: a missing base URL is reported, never silently defaulted.
 * @remarks
 * A service package's `tryCreate…` variant catches this and returns `null`, which is what lets
 * a site boot and render with no service variables set at all.
 */
export function resolveConfig(input: ResolveConfigInput): ResolvedConfig {
  const { serviceName, env, config } = input;

  const rawBaseUrl = config?.baseUrl ?? readEnv(env.baseUrl);
  if (!rawBaseUrl) {
    throw new NotConfiguredError({
      service: serviceName,
      message: `${serviceName}: no base URL. Set ${env.baseUrl} or pass baseUrl explicitly. There is no default host.`,
    });
  }

  const baseUrl = normaliseBaseUrl(rawBaseUrl.trim());
  assertAbsoluteHttpUrl(baseUrl, serviceName, env.baseUrl);

  const apiKey = (config?.apiKey ?? readEnv(env.apiKey))?.trim();
  if (!apiKey) {
    throw new NotConfiguredError({
      service: serviceName,
      message: `${serviceName}: no API key. Set ${env.apiKey} or pass apiKey explicitly.`,
    });
  }

  const resolved: Omit<ResolvedConfig, "apiKey"> = {
    serviceName,
    baseUrl,
    fetch: config?.fetch ?? globalThis.fetch,
    defaultInit: config?.defaultInit ?? {},
    ...(config?.onRequest ? { onRequest: config.onRequest } : {}),
  };

  // The one place the key is stored, and it is not enumerable. See ResolvedConfig.apiKey.
  return Object.defineProperty(resolved, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false,
  }) as ResolvedConfig;
}

/** Reject a relative or non-HTTP base URL at construction, not at the first request. */
function assertAbsoluteHttpUrl(baseUrl: string, serviceName: string, envName: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new NotConfiguredError({
      service: serviceName,
      message: `${serviceName}: ${envName} is not an absolute URL. Expected something like https://service.example.com.`,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NotConfiguredError({
      service: serviceName,
      message: `${serviceName}: ${envName} must use http or https, not ${parsed.protocol}`,
    });
  }
}
