/**
 * The two ways this package reaches the service: one that throws for every non-2xx, and one that
 * answers `null` for a `404`.
 *
 * @remarks
 * Both go through `@lazslov/api-core`'s `request`, so there is exactly one place a request leaves
 * the process and exactly one place the credential is attached.
 */

import { type RequestSpec, type ResolvedConfig, request } from "@lazslov/api-core";
import { ContentApiError, parseContentError } from "./errors.js";
import type { ContentList } from "./types.js";

/** A request minus the error parser, which is always this package's. */
export type ContentRequest = Omit<RequestSpec, "onError">;

/** A list request: the read mode is always the envelope, for its `total`. */
export type ContentListRequest = Omit<ContentRequest, "read">;

/**
 * Make a request, throwing a {@link ContentApiError} for any non-2xx.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 */
export function call<T>(cfg: ResolvedConfig, spec: ContentRequest): Promise<T> {
  return request<T>(cfg, { ...spec, onError: parseContentError });
}

/**
 * Make a request, answering `null` for a `404` and throwing for everything else.
 *
 * @param cfg - The resolved configuration a client closes over.
 * @param spec - The request.
 * @returns The value, or `null` when the resource is absent.
 * @remarks
 * Used **only** where the service documents a `404` as a normal state — an unpublished page, an
 * undefined collection, a dataset whose aggregate is not public. Not globally: tenant scoping is
 * per-query on `site_id`, so another site's page also reads as a `404`, and mapping every `404`
 * everywhere would turn "you configured the wrong tenant" into "this content does not exist yet",
 * which is by far the harder bug to find. On a write path a `404` throws.
 */
export async function callOrNull<T>(cfg: ResolvedConfig, spec: ContentRequest): Promise<T | null> {
  try {
    return await call<T>(cfg, spec);
  } catch (error) {
    if (error instanceof ContentApiError && error.status === 404) return null;
    throw error;
  }
}

/** The envelope a `limit`/`offset` list answers with: `data` plus its three siblings. */
interface ListEnvelope<T> {
  readonly data: T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Read a paginated list.
 *
 * @remarks
 * Keeps `total` rather than unwrapping to the rows alone: a list read without it cannot be followed
 * to the end, and a hardcoded `limit=100` starts truncating silently the day a list outgrows it —
 * a missing row is a bug nobody goes looking for inside a fetch helper.
 */
export async function callList<T>(
  cfg: ResolvedConfig,
  spec: ContentListRequest,
): Promise<ContentList<T>> {
  return toList(await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } }));
}

/** As {@link callList}, with a `404` answering `null`. See {@link callOrNull} for when that applies. */
export async function callListOrNull<T>(
  cfg: ResolvedConfig,
  spec: ContentListRequest,
): Promise<ContentList<T> | null> {
  const envelope = await callOrNull<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return envelope === null ? null : toList(envelope);
}

/** Rename `data` to `items`, so the shape satisfies core's `collectAll` with no adapter. */
function toList<T>(envelope: ListEnvelope<T>): ContentList<T> {
  return {
    items: envelope.data,
    total: envelope.total,
    limit: envelope.limit,
    offset: envelope.offset,
  };
}
