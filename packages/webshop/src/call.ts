/**
 * How this package reaches the service.
 *
 * @remarks
 * One door out, through `@lazslov/api-core`'s `request`, with this package's problem parser bound to
 * it. Four shapes: the plain one, the one that answers `null` for a documented `404`, the keyset-list
 * reader, and the one that keeps the status and headers because checkout's replay header is part of
 * its contract. The public tier's conditional read lives in `./public-catalog.js`, because a `304`
 * needs handling the transport does not offer.
 */

import { type RequestSpec, type ResolvedConfig, request } from "@lazslov/api-core";
import { parseWebshopError, WebshopApiError } from "./errors.js";

/** A request minus the error parser, which is always this package's. */
export type WebshopRequest = Omit<RequestSpec, "onError">;

/** A list request: the read mode is always the envelope, for its siblings. */
export type WebshopListRequest = Omit<WebshopRequest, "read">;

/** Options every endpoint accepts. */
export interface RequestOptions {
  /**
   * Passed through to `fetch` intact — `{ signal }` for a deadline, `{ next: { revalidate } }` for a
   * framework's cache, and nothing else in practice.
   *
   * @remarks
   * The SDK sets no timeout of its own. And be careful what a deadline means on `checkout`: aborting
   * the request does **not** stop the order committing, so the outcome is unknown and the retry must
   * reuse the same `Idempotency-Key`.
   *
   * **`mode` is never set here, and neither is `Origin`.** The service's browser tripwire keys on
   * `Origin` or `Sec-Fetch-Dest`; a server-side client that sets `Origin` helpfully earns a `403`
   * before its key is even looked up.
   */
  readonly init?: RequestInit;
}

/** Keyset-paged reads. */
export interface CursorListOptions extends RequestOptions {
  /** 1–200, default 50. Out of range is a `400`, never a clamp. */
  readonly limit?: number;
  /**
   * An opaque cursor, taken verbatim from a previous page's `nextCursor`.
   *
   * @remarks
   * Never construct, parse or store one — the encoding is free to change, and a malformed cursor is
   * a `400` rather than a quiet restart from page one.
   */
  readonly cursor?: string;
}

/**
 * The envelope every list answers with.
 *
 * @remarks
 * `next_cursor` is **always present**, `null` on the last or only page. There is no `total` anywhere:
 * nothing in this service counts rows.
 */
interface ListEnvelope<T> {
  readonly data: T[];
  readonly next_cursor: string | null;
}

/**
 * Make a request, throwing a {@link WebshopApiError} for any non-2xx.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 */
export function call<T>(cfg: ResolvedConfig, spec: WebshopRequest): Promise<T> {
  return request<T>(cfg, { ...spec, onError: parseWebshopError });
}

/**
 * Make a request, answering `null` for a `404` and throwing for everything else.
 *
 * @remarks
 * Used **only** for a product read by slug, where the knowledge base documents the `404` as a normal
 * state — a draft, an archived product, or a slug a crawler invented. Nowhere else: a cart or an
 * order id you hold came from something you created, so a `404` there is a bug, and mapping it to
 * `null` would turn "this deployment holds another shop's key" into "the cart is gone".
 */
export async function callOrNull<T>(cfg: ResolvedConfig, spec: WebshopRequest): Promise<T | null> {
  try {
    return await call<T>(cfg, spec);
  } catch (error) {
    if (error instanceof WebshopApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Read a keyset-cursor list into core's `CursorPage` shape.
 *
 * @remarks
 * Renames `data` to `items` and `next_cursor` to `nextCursor`, so `collectAllCursor` follows it with
 * no adapter. The cursor is passed back verbatim and never parsed.
 */
export async function callCursorList<T>(
  cfg: ResolvedConfig,
  spec: WebshopListRequest,
): Promise<{ items: T[]; nextCursor: string | null }> {
  return toCursorPage(await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } }));
}

/**
 * Make a request and keep the status and headers.
 *
 * @remarks
 * Used by checkout alone. A replay of a frozen `201` is distinguished from a fresh one only by the
 * `Idempotent-Replay: true` header, and a transport that returned the body alone would throw that
 * distinction away.
 */
export function callWithMeta<T>(cfg: ResolvedConfig, spec: WebshopRequest) {
  return request<T>(cfg, {
    ...spec,
    read: { ...spec.read, withMeta: true },
    onError: parseWebshopError,
  });
}

/** Forward a caller's `init` without introducing an `init: undefined` key. */
export function passInit(options: RequestOptions): { init?: RequestInit } {
  return options.init ? { init: options.init } : {};
}

/**
 * Whether checkout answered with the frozen bytes of an earlier attempt.
 *
 * @param headers - The response headers.
 * @remarks
 * The header alone, because the status cannot tell: a replay is a `201`, the same as a fresh
 * checkout. And a **resume** — the retry that recovers an order whose payment step failed — is also a
 * `201` **without** the header, because it produces its response for the first time. So `false` means
 * "freshly generated", which covers both the first attempt and the one that recovered it; what
 * identifies the outcome is the order's `public_id`, which a resume never changes.
 */
export function isReplay(headers: Headers): boolean {
  return headers.get("idempotent-replay") === "true";
}

/** Rename the envelope's members to the shape core's paginator follows. */
export function toCursorPage<T>(envelope: ListEnvelope<T>): {
  items: T[];
  nextCursor: string | null;
} {
  return { items: envelope.data, nextCursor: envelope.next_cursor };
}
