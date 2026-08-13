/**
 * The ways this package reaches the service: one that throws for every non-2xx, one that
 * answers `null` for a `404`, and one reader per kind of list.
 *
 * @remarks
 * All of them go through `@lazslov/api-core`'s `request`, so there is exactly one place a
 * request leaves the process and exactly one place the credential is attached.
 */

import { type RequestSpec, type ResolvedConfig, request } from "@lazslov/api-core";
import { ContentApiError, parseContentError } from "./errors.js";
import type { ContentCursorList, ContentList } from "./types.js";

/** A request minus the error parser, which is always this package's. */
export type ContentRequest = Omit<RequestSpec, "onError">;

/** A list request: the read mode is always the envelope, for its siblings. */
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

/**
 * The envelope every list answers with.
 *
 * @remarks
 * `next_cursor` is **always present**, `null` rather than absent, on every list — including the
 * offset-paged and the unpaginated ones. That is deliberate on the service's side: one pager
 * reads `body.next_cursor` everywhere and gets `null` rather than `undefined`.
 *
 * `total` is per-endpoint. The keyset lists omit it, because counting a filtered unbounded table
 * on every page is not cheap.
 */
interface ListEnvelope<T> {
  readonly data: T[];
  readonly next_cursor: string | null;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read an offset-paged list — the bounded, staff-curated ones.
 *
 * @remarks
 * Collection items, page versions and sites. Keeps `total` rather than unwrapping to the rows
 * alone: a list read without it cannot be followed to the end, and a hardcoded `limit=100`
 * starts truncating silently the day a list outgrows it.
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

/**
 * Read a list that takes no pagination parameter at all, returning the rows alone.
 *
 * @remarks
 * The **only** place this package reads `data` and discards the siblings, and it is deliberately
 * a separate function rather than a `read` mode so that every use of it is greppable.
 *
 * conventions §3 forbids a general `unwrap(body.data)` helper because a pager that loses
 * `next_cursor` silently stops after one page. That risk needs a pager: these four endpoints —
 * `/v1/pages`, `/v1/collections`, `/v1/datasets` and `/v1/public/pages` — accept no `limit`, no
 * `offset` and no `cursor`, so there is nothing to page and the siblings carry no information
 * (`next_cursor` is always `null`, `total` always equals `data.length`).
 *
 * If one of them ever grows a pagination parameter, it moves to {@link callCursorList} and the
 * signature change is a compile error rather than a silently short list.
 */
export async function callUnpaginated<T>(
  cfg: ResolvedConfig,
  spec: ContentListRequest,
): Promise<T[]> {
  const envelope = await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return envelope.data;
}

/**
 * Read a keyset-cursor list — the ones that grow with your activity.
 *
 * @remarks
 * Dataset records, assets, the audit trail and the publish outbox. Carries `nextCursor` and no
 * `total`; pass the cursor back verbatim, and never parse it.
 */
export async function callCursorList<T>(
  cfg: ResolvedConfig,
  spec: ContentListRequest,
): Promise<ContentCursorList<T>> {
  const envelope = await call<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return { items: envelope.data, nextCursor: envelope.next_cursor };
}

/** As {@link callCursorList}, with a `404` answering `null`. */
export async function callCursorListOrNull<T>(
  cfg: ResolvedConfig,
  spec: ContentListRequest,
): Promise<ContentCursorList<T> | null> {
  const envelope = await callOrNull<ListEnvelope<T>>(cfg, { ...spec, read: { kind: "envelope" } });
  return envelope === null ? null : { items: envelope.data, nextCursor: envelope.next_cursor };
}

/**
 * Rename `data` to `items`, so the shape satisfies core's `collectAll` with no adapter.
 *
 * @remarks
 * `total` stays optional even here. An offset list that does not report one is followed by its
 * short final page instead, which is what `collectAll` already does.
 */
function toList<T>(envelope: ListEnvelope<T>): ContentList<T> {
  return {
    items: envelope.data,
    ...(envelope.total === undefined ? {} : { total: envelope.total }),
    ...(envelope.limit === undefined ? {} : { limit: envelope.limit }),
    ...(envelope.offset === undefined ? {} : { offset: envelope.offset }),
  };
}
