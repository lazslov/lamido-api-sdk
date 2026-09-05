/**
 * How this package reaches the service.
 *
 * @remarks
 * One door out, through `@lazslov/api-core`'s `request`, with this package's problem parser bound to
 * it. Three shapes: the plain one, the one that keeps the status and headers because a status or a
 * `Set-Cookie` header is part of the contract, and the list reader for the `{ data, next_cursor }`
 * envelope. No shape answers `null` for a `404`: on this service a `404` is never a normal state —
 * see `errors.ts`.
 */

import {
  type CursorPage,
  type IdempotencyKey,
  type RequestSpec,
  type ResolvedConfig,
  request,
} from "@lazslov/api-core";
import { parseAuthError } from "./errors.js";

/** A request minus the error parser, which is always this package's. */
export type AuthRequest = Omit<RequestSpec, "onError">;

/** Options every endpoint accepts. */
export interface RequestOptions {
  /**
   * Passed through to `fetch` intact — `{ signal }` for a deadline, `{ cache: "no-store" }` for a
   * framework, and nothing else in practice.
   *
   * @remarks
   * The SDK sets no timeout of its own, and **`mode` is never set here.** The service's `Origin` /
   * `Sec-Fetch-Dest` tripwire is not a security boundary — anything that can make a request can omit a
   * header — so there is nothing for the SDK to satisfy.
   */
  readonly init?: RequestInit;
}

/**
 * Options for a create that accepts an `Idempotency-Key` without requiring one.
 *
 * @remarks
 * conventions.md §8 documents the header as optional, and the contract declares the two idempotency
 * conflict codes on the organization, website and invitation creates. Supply one when a retry after a
 * dropped connection must not create a second row. The SDK never generates a key. The website key mint
 * is the exception: its plaintext is unrecoverable, so there the key is a required argument.
 */
export interface CreateOptions extends RequestOptions {
  readonly idempotencyKey?: IdempotencyKey;
}

/** Keyset pagination, as every paginated list on this service takes it. */
export interface PageOptions extends RequestOptions {
  /** 1–200, default 50. **201 is a `400`, not a clamp.** */
  readonly limit?: number;
  /** Opaque. Pass a page's `nextCursor` back verbatim; a malformed one is a `400`, never a restart. */
  readonly cursor?: string;
}

/** The header a person's session travels in. `Authorization` carries the key, never a session. */
export const sessionTokenHeader = "X-Session-Token";

/**
 * Make a request, throwing an {@link ./errors.js | AuthApiError} for any non-2xx.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 */
export function call<T>(cfg: ResolvedConfig, spec: AuthRequest): Promise<T> {
  return request<T>(cfg, { ...spec, onError: parseAuthError });
}

/**
 * Make a request and keep the status and headers.
 *
 * @remarks
 * Used where the status or a header *is* the contract: `POST /v1/customers` says `201` created and
 * `200` resolved, and the two exchanges put the session in a `Set-Cookie` header rather than a body.
 */
export function callWithMeta<T>(cfg: ResolvedConfig, spec: AuthRequest) {
  return request<T>(cfg, {
    ...spec,
    read: { ...spec.read, withMeta: true },
    onError: parseAuthError,
  });
}

/**
 * The envelope every collection answers with.
 *
 * @remarks
 * `next_cursor` is **always present**, `null` rather than absent, on every list — including the ones
 * that never paginate. There is no `total`, anywhere, service-wide.
 */
interface ListEnvelope<T> {
  readonly data: T[];
  readonly next_cursor: string | null;
}

/**
 * Read a keyset-cursor list into core's page shape, so `collectAllCursor` works on it.
 *
 * @remarks
 * The cursor is passed back verbatim and never parsed: it encodes `(created_at, public_id)` today
 * and is free to change.
 */
export async function callCursorList<T>(
  cfg: ResolvedConfig,
  spec: Omit<AuthRequest, "read">,
): Promise<CursorPage<T>> {
  const envelope = await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return { items: envelope.data, nextCursor: envelope.next_cursor };
}

/**
 * Read a collection that takes no pagination parameter, returning the rows alone.
 *
 * @remarks
 * The **only** place this package reads `data` and discards `next_cursor`, kept separate so every
 * use is greppable. It is for the three registry-bounded collections — permissions, features, and a
 * website's domains and keys — whose contract declares no `limit` and no `cursor`, so there is
 * nothing to page and `next_cursor` is always `null`. If one of them ever grows a pagination
 * parameter it moves to {@link callCursorList}, and the return type changes with it.
 */
export async function callUnpaginated<T>(
  cfg: ResolvedConfig,
  spec: Omit<AuthRequest, "read">,
): Promise<T[]> {
  const envelope = await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return envelope.data;
}

/** Forward a caller's `init` without introducing an `init: undefined` key. */
export function passInit(options: RequestOptions): { init?: RequestInit } {
  return options.init ? { init: options.init } : {};
}

/** The two pagination parameters, dropped when unset so the service's own defaults apply. */
export function pageQuery(options: PageOptions): { limit?: number; cursor?: string } {
  return { limit: options.limit, cursor: options.cursor };
}

/** The `Idempotency-Key` header, when the caller supplied one. */
export function idempotencyHeader(options: CreateOptions): Record<string, string> {
  return options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {};
}

/**
 * The header block for a route that acts for a person.
 *
 * @remarks
 * Both credentials ride on every such call: `Authorization` says which backend is calling and is
 * attached by the transport, `X-Session-Token` says for whom and is attached here. They are checked
 * in that order, so a session with no key is a `401` — the failure every first integration hits.
 */
export function withSession(sessionToken: string): Record<string, string> {
  return { [sessionTokenHeader]: sessionToken };
}
