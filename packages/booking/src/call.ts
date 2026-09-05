/**
 * How this package reaches the service.
 *
 * @remarks
 * One door out, through `@lazslov/api-core`'s `request`, with this package's problem parser bound
 * to it. Four shapes: the plain one; the one that keeps the status because a create's *status* is
 * part of its contract; the one that answers `null` for the single documented normal `404`; and
 * the two list readers.
 */

import { type CursorPage, type RequestSpec, type ResolvedConfig, request } from "@lazslov/api-core";
import { BookingApiError, parseBookingError } from "./errors.js";

/** A request minus the error parser, which is always this package's. */
export type BookingRequest = Omit<RequestSpec, "onError">;

/** A list request: the read mode is always the envelope. */
export type BookingListRequest = Omit<BookingRequest, "read">;

/** Options every endpoint accepts. */
export interface RequestOptions {
  /**
   * Passed through to `fetch` intact — `{ signal }` for a deadline, `{ next: { revalidate } }`
   * for a framework cache, and nothing else in practice.
   *
   * @remarks
   * The SDK sets no timeout of its own. Be careful what a deadline means on a create: aborting the
   * request does **not** undo a booking the service may already have committed, so the retry must
   * reuse the same `Idempotency-Key`.
   *
   * **`mode` is never set here.** The service's `Origin` / `Sec-Fetch-Dest` check is a tripwire,
   * not a boundary, and its own docs say to delete any inherited `mode: 'same-origin'`.
   */
  readonly init?: RequestInit;
}

/** Options every keyset-paged list accepts. */
export interface ListOptions extends RequestOptions {
  /** Page size. Default 50, maximum 200. */
  readonly limit?: number;
  /** The previous page's `nextCursor`, passed back **verbatim**. Never build one. */
  readonly cursor?: string;
}

/**
 * Make a request, throwing a {@link BookingApiError} for any non-2xx.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 */
export function call<T>(cfg: ResolvedConfig, spec: BookingRequest): Promise<T> {
  return request<T>(cfg, { ...spec, onError: parseBookingError });
}

/**
 * Make a request and keep the status and headers.
 *
 * @remarks
 * Used by the creates that take an `Idempotency-Key`. A transport that returned only the body
 * would throw away the one distinction idempotency exists to express: `201` created it, `200`
 * replayed it.
 */
export function callWithMeta<T>(cfg: ResolvedConfig, spec: BookingRequest) {
  return request<T>(cfg, {
    ...spec,
    read: { ...spec.read, withMeta: true },
    onError: parseBookingError,
  });
}

/**
 * Make a request, answering `null` for a `404` and throwing for everything else.
 *
 * @remarks
 * Used in **exactly one place**: a staff member's calendar connection, where the knowledge base
 * says *"404 if there is none, which is normal"*. Nowhere else — every other read is scoped to the
 * key's tenant inside the query, so another tenant's id also reads as a `404`, and mapping that to
 * `null` would turn "this deployment holds the wrong key" into "no such booking".
 */
export async function callOrNull<T>(cfg: ResolvedConfig, spec: BookingRequest): Promise<T | null> {
  try {
    return await call<T>(cfg, spec);
  } catch (error) {
    if (error instanceof BookingApiError && error.status === 404) return null;
    throw error;
  }
}

/** The envelope every list answers with. `next_cursor` is always present, `null` at the end. */
interface ListEnvelope<T> {
  readonly data: T[];
  readonly next_cursor: string | null;
}

/**
 * Read a keyset-cursor list — the ones that accept `limit` and `cursor`.
 *
 * @remarks
 * Locations, services, employees, bookings, webhook endpoints, events and deliveries. Answers
 * core's `CursorPage`, so `collectAllCursor` works with no adapter. The cursor is opaque: it
 * encodes a row-value comparison, and a pager that built one would skip or duplicate rows.
 */
export async function callCursorList<T>(
  cfg: ResolvedConfig,
  spec: BookingListRequest,
): Promise<CursorPage<T>> {
  const envelope = await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return { items: envelope.data, nextCursor: envelope.next_cursor };
}

/**
 * Read a list that takes no pagination parameter at all, returning the rows alone.
 *
 * @remarks
 * The **only** place this package reads `data` and discards `next_cursor`, kept as a separate
 * function so every use is greppable. It is used for the lists whose contract declares no
 * `limit` and no `cursor`: the public catalogue, one employee's rules, exceptions, services and
 * locations, and the event-type catalogue. On those, `next_cursor` is always `null` and carries
 * no information. If one of them grows a pagination parameter, it moves to
 * {@link callCursorList} and the signature change is a compile error rather than a short list.
 */
export async function callUnpaginated<T>(
  cfg: ResolvedConfig,
  spec: BookingListRequest,
): Promise<T[]> {
  const envelope = await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return envelope.data;
}

/** Forward a caller's `init` without introducing an `init: undefined` key. */
export function passInit(options: RequestOptions): { init?: RequestInit } {
  return options.init ? { init: options.init } : {};
}

/**
 * Whether a create answered with a replay rather than having created something.
 *
 * @param status - The response status.
 * @param headers - The response headers.
 * @remarks
 * Both signals are checked. The status is the contract — `200` is a replay, `201` is new — and the
 * `Idempotent-Replay: true` header says the same thing; reading both means a proxy that rewrites
 * one cannot make a replay look like a fresh booking.
 */
export function isReplay(status: number, headers: Headers): boolean {
  return status === 200 || headers.get("idempotent-replay") === "true";
}
