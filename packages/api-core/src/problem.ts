/**
 * RFC 9457 Problem Details, read once for all three services.
 *
 * @remarks
 * The three services share one closed type set, verbatim and by design — invoice-service's
 * conventions §6 says so explicitly: "shared verbatim with payment-service and content-service
 * so a consumer of two of them writes one error reader". This is that reader.
 *
 * Only the URN namespace differs (`urn:content-service:problem:…` against
 * `urn:payment-service:problem:…`), so the slug is what this module extracts and the namespace
 * is what it ignores. A service package binds its own name and gets a parser back.
 */

import { type ErrorContext, type ErrorParser, LamidoApiError } from "./errors.js";

/**
 * Every slug the three services send, and the only values `LamidoApiError.type` takes.
 *
 * @remarks
 * Seven are shared verbatim by all three. `payload-too-large` is content-service's alone — a
 * dataset record whose `data` serialises past 8 KB — and neither invoice-service nor
 * payment-service can produce it. The union is the estate's, not one service's, so a consumer
 * of two packages still writes one `switch`.
 *
 * Adding a member is an API change. `unknown` is this SDK's own, for a body that never came
 * from the service — an edge proxy's HTML error page has no problem document, and inventing a
 * slug from its status would be a guess presented as a fact.
 */
export type ProblemType =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "payload-too-large"
  | "rate-limit"
  | "internal"
  | "unknown";

/** The slugs a service can send. `unknown` is absent: only this SDK produces it. */
const documented: ReadonlySet<string> = new Set<ProblemType>([
  "validation",
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "payload-too-large",
  "rate-limit",
  "internal",
]);

/**
 * One field-level error, as the registered `errors` extension carries it.
 *
 * @remarks
 * `pointer` is a JSON Pointer into the request body — `/items/0/quantity` — or `#/query/<name>`
 * for a query parameter. Every problem is reported at once, so this array is the whole list
 * rather than the first failure.
 */
export interface ProblemFieldError {
  readonly pointer: string;
  readonly code: string;
  readonly detail?: string;
}

/**
 * Decide whether retrying the identical request can succeed.
 *
 * @remarks
 * Read off the three services' error tables, which agree. The pairing that matters is
 * `(type, status)` rather than either alone: `conflict` is a flat no at `409` and a yes-later at
 * `422`, because `422` means the resource's *state* forbids the call and a state can change.
 *
 * A service package may narrow this — `@lazslov/invoice` does, where a retryable status still
 * needs a **new** idempotency key — but nothing may widen it into a retry the service documents
 * as hopeless.
 */
function isRetryable(type: ProblemType, status: number): boolean {
  if (status === 429) return true;
  // 500 is "our bug, try once"; 502 is the provider refusing or unreachable.
  if (status === 500 || status === 502) return true;
  return type === "conflict" && status === 422;
}

/** Read a member that must be a non-empty string, or nothing. */
function stringMember(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Lift the slug out of `urn:<service>:problem:<slug>`.
 *
 * @returns The slug when it is one the services document, `"unknown"` otherwise.
 * @remarks
 * The namespace is deliberately not checked. A caller pointing `@lazslov/content` at a proxy
 * that rewrites the URN still gets a usable verdict, and the service name is already on the
 * error from the package that threw it.
 */
function slugOf(type: string | undefined): ProblemType {
  if (type === undefined) return "unknown";
  const slug = type.slice(type.lastIndexOf(":") + 1);
  return documented.has(slug) ? (slug as ProblemType) : "unknown";
}

/**
 * The `retry_after` extension, in seconds.
 *
 * @remarks
 * Prefers the member over the `Retry-After` header. The two always agree on these services, and
 * the member is already a number of seconds — the header may be an HTTP date, which is a second
 * format to parse for no gain.
 */
function retryAfterOf(body: Record<string, unknown>, headers: Headers): number | undefined {
  const member = body.retry_after;
  if (typeof member === "number" && Number.isFinite(member)) return member;
  const header = Number(headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? header : undefined;
}

/** The `errors` extension, when it is the shape the contract promises. */
function fieldErrorsOf(body: Record<string, unknown>): readonly ProblemFieldError[] | undefined {
  if (!Array.isArray(body.errors)) return undefined;
  const errors = body.errors.filter(
    (entry): entry is ProblemFieldError =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as ProblemFieldError).pointer === "string",
  );
  return errors.length > 0 ? errors : undefined;
}

/**
 * Build the error parser for one service.
 *
 * @param service - The service name carried on every error, e.g. `"content-service"`.
 * @returns A parser each package binds into its own transport calls.
 * @remarks
 * Returns the shared {@link LamidoApiError}. A package that needs a narrower class — a named
 * error for a state its callers branch on — wraps this rather than reimplementing it.
 *
 * @example
 * ```ts
 * const onError = problemParser("content-service");
 * ```
 */
export function problemParser(service: string): ErrorParser {
  return (context: ErrorContext): LamidoApiError =>
    new LamidoApiError(readProblem(service, context));
}

/**
 * Read one problem document into the fields {@link LamidoApiError} carries.
 *
 * @remarks
 * Exported so a package building a narrower error class reuses the parse instead of repeating
 * it. Never throws: a body that is absent, HTML or malformed still yields a usable error, which
 * is the whole reason the transport parses error bodies defensively.
 */
export function readProblem(
  service: string,
  context: ErrorContext,
): ConstructorParameters<typeof LamidoApiError>[0] & { readonly type: ProblemType } {
  const body = (
    typeof context.body === "object" && context.body !== null ? context.body : {}
  ) as Record<string, unknown>;

  const type = slugOf(stringMember(body, "type"));
  // `detail` is the human sentence; `title` only ever summarises the status, so it is the
  // fallback rather than a peer. Neither is ever branched on — see conventions §4.
  const message =
    stringMember(body, "detail") ??
    stringMember(body, "title") ??
    `${service} answered ${context.status}`;

  const errors = fieldErrorsOf(body);
  const retryAfter = retryAfterOf(body, context.headers);
  const requestId = stringMember(body, "request_id") ?? context.headers.get("x-request-id");

  return {
    service,
    status: context.status,
    type,
    message,
    requestPath: context.requestPath,
    retryable: isRetryable(type, context.status),
    // `code` is the 409/422 sub-case, e.g. `idempotency_key_reused`. Absent on most problems.
    ...(stringMember(body, "code") === undefined ? {} : { code: stringMember(body, "code") }),
    ...(errors === undefined ? {} : { errors }),
    ...(retryAfter === undefined ? {} : { retryAfter }),
    ...(requestId ? { requestId } : {}),
    ...(body.details === undefined ? {} : { details: body.details }),
  };
}
