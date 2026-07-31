/**
 * `@lazslov/api-core` — the pieces every `@lazslov/*` service SDK shares.
 *
 * @remarks
 * A published package but not a documented one. Install `@lazslov/content`,
 * `@lazslov/invoice` or `@lazslov/payment`; the two things a consumer touches here directly are
 * {@link verifySignedBody} and {@link LamidoApiError}.
 *
 * Core owns what is true of all three services and nothing else. It carries no host, no
 * default base URL, no money type and no service-specific error code — the HMAC header names
 * and the server-only key prefixes are parameters, and each service package binds them.
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
export { type CollectAllOptions, collectAll, type Page } from "./paginate.js";
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
export const VERSION = "0.1.0";
