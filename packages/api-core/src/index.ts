/**
 * `@lazslov/api-core` — the pieces every `@lazslov/*` service SDK shares.
 *
 * @remarks
 * A published package but not a documented one. Install `@lazslov/content`,
 * `@lazslov/invoice` or `@lazslov/payment`; the two things a consumer touches here directly are
 * {@link verifySignedBody} and {@link LamidoApiError}.
 *
 * Core owns what is true of all three services and nothing else. It carries no host, no
 * default base URL and no money type — the HMAC header names and the server-only key prefixes
 * are parameters, and each service package binds them.
 *
 * It *does* own the error reader. The three services share one RFC 9457 problem document over
 * one closed type set, verbatim and by contract, so reading it three times would be three
 * chances to disagree.
 */

export { assertServerOnly, type ServerOnlyOptions } from "./browser-guard.js";
export {
  type EnvKeys,
  type ResolveConfigInput,
  type ResolvedConfig,
  resolveConfig,
  type ServiceConfig,
} from "./config.js";
export {
  type ApiErrorInit,
  type ErrorContext,
  type ErrorParser,
  LamidoApiError,
  NotConfiguredError,
} from "./errors.js";
export {
  type VerifyFailure,
  type VerifyResult,
  type VerifySignedBodyInput,
  verifySignedBody,
} from "./hmac.js";
export {
  derivedIdempotencyKey,
  type IdempotencyKey,
  idempotencyKey,
} from "./idempotency.js";
export {
  type CollectAllOptions,
  type CursorPage,
  collectAll,
  collectAllCursor,
  type Page,
} from "./paginate.js";
export {
  type ProblemFieldError,
  type ProblemType,
  problemParser,
  readProblem,
} from "./problem.js";
export { buildQuery, type QueryInit } from "./query.js";
export type { BytesBody, ReadKind, ReadMode, ResponseMeta } from "./read.js";
export { type HttpMethod, type RequestSpec, request } from "./transport.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that
 * disagrees with the tarball it came from.
 */
export const VERSION = "2.0.1";
