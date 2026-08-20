/**
 * `/v1/collections/*` — repeating content, one row at a time.
 *
 * @remarks
 * An item's lifecycle is a `status`, not a version history: a news list of 200 items would otherwise
 * snapshot 200 documents on every edit. `archive` is the editor-facing "remove" — the item leaves the
 * site, keeps its values, and keeps whatever dataset records point at it, so a ledger still adds up.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, callList, callUnpaginated } from "../call.js";
import { type ListOptions, type LocaleOptions, passInit, type RequestOptions } from "../options.js";
import type {
  CollectionItem,
  CollectionSummary,
  ContentList,
  ContentValue,
  ContentView,
  DeleteResult,
  ItemPublishResult,
  ItemStatus,
} from "../types.js";

/** Options for the item list. */
export interface ItemListOptions extends ListOptions {
  /** Omitted returns draft, published and archived items alike. */
  readonly status?: ItemStatus;
  /** Defaults to `draft` on this tier, which falls back to the published value per key. */
  readonly view?: ContentView;
}

/** Options for reading one item. */
export interface ItemOptions extends LocaleOptions {
  /** Defaults to `draft` on this tier. */
  readonly view?: ContentView;
}

/** What a new item carries. It is always born a draft. */
export interface NewItem {
  /**
   * Only items addressable by a URL need one.
   *
   * @remarks
   * A duplicate within one collection is a `409`; any number of slugless items may coexist, because
   * NULLs do not collide in a unique index.
   */
  readonly slug?: string;
  /** Omitted means `max(position) + 1`. */
  readonly position?: number;
  /** Keyed by field key, validated against the collection's item schema. */
  readonly values: Record<string, ContentValue>;
}

/** A partial update to one item. Keys the patch does not mention keep their value. */
export interface ItemPatch {
  /** `null` clears it. */
  readonly slug?: string | null;
  readonly position?: number;
  readonly values?: Record<string, ContentValue>;
}

/** How a reorder proves it is complete before it is sent. */
export interface ReorderOptions extends RequestOptions {
  /**
   * Every item that must appear in the order, in any order.
   *
   * @remarks
   * Required, and the reason this method can fail locally: the service needs the **complete**
   * ordered set and answers `400` with `missing`/`unknown` for a partial one, never applying it to a
   * prefix. The SDK cannot know what complete means without being told — asking the service first
   * would be the round trip this check exists to save — so the caller passes the list it just
   * rendered from.
   */
  readonly expectedItemIds: readonly string[];
}

/** The collection half of a client-tier client. */
export interface CollectionMethods {
  /** Every collection of this site, with item counts by status. Unpaginated. */
  listCollections(options?: RequestOptions): Promise<CollectionSummary[]>;

  /** One collection's items, in `position` order. */
  listItems(key: string, options?: ItemListOptions): Promise<ContentList<CollectionItem>>;

  /** One item. Throws for an unknown id — on this tier that is a wrong id, not absent content. */
  getItem(key: string, id: string, options?: ItemOptions): Promise<CollectionItem>;

  /**
   * Create one item.
   *
   * @remarks
   * Born a draft: `status` is not settable, or "add the next news item" would be a publish.
   */
  createItem(key: string, item: NewItem, options?: LocaleOptions): Promise<CollectionItem>;

  /**
   * Update one item.
   *
   * @remarks
   * `values` **merge** key by key, which is what keeps the save unit the row rather than the list. A
   * patch with no fields at all is a `400`.
   */
  patchItem(
    key: string,
    id: string,
    patch: ItemPatch,
    options?: LocaleOptions,
  ): Promise<CollectionItem>;

  /**
   * Publish one item.
   *
   * @returns The locales the publish covered, and the item in one of them.
   * @remarks
   * Publishing an archived item flips it straight back to published.
   *
   * **Omitting `locale` publishes every locale of the site.** The required-value check then runs
   * per locale, so an item filled in one language and empty in another is a `409`.
   */
  publishItem(key: string, id: string, options?: LocaleOptions): Promise<ItemPublishResult>;

  /**
   * Archive one item — off the site, recoverable, and the editor-facing "remove".
   *
   * @remarks
   * Label the button with what the editor wants and say what happens: *"removed from the site; its
   * history is kept."* Archiving has nothing to refuse, so it never conflicts.
   */
  archiveItem(key: string, id: string, options?: LocaleOptions): Promise<CollectionItem>;

  /**
   * **Hard** delete one item.
   *
   * @param force - Leaves any dataset records pointing at it dangling. They are counted in
   * `danglingRefs` on the service's admin health rather than lost silently, and the delete is audited
   * as forced.
   * @throws {@link ../errors.js | ContentApiError} `conflict` with `details.recordCount` when records
   * reference it. Do not pre-check by counting first — the count can change between the check and the
   * delete, and the service's answer is the authoritative one. Translate the `409` instead, and offer
   * archive.
   */
  deleteItem(
    key: string,
    id: string,
    options?: RequestOptions & { force?: boolean },
  ): Promise<DeleteResult>;

  /**
   * Reorder a collection.
   *
   * @param key - The collection key.
   * @param orderedIds - The complete ordered set, 1–500 ids, no duplicates.
   * @param options - `expectedItemIds`, and `init`.
   * @throws `TypeError` **before any request** when `orderedIds` is not exactly a permutation of
   * `expectedItemIds`, or holds a duplicate, or is out of range.
   * @remarks
   * Defer a reorder while any row has unsaved edits, or you reorder stale positions. And look rows up
   * by their locked key rather than by index — index 0 is not a contract.
   */
  reorderItems(
    key: string,
    orderedIds: readonly string[],
    options: ReorderOptions,
  ): Promise<string[]>;
}

/**
 * Bind the collection methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCollectionMethods(cfg: ResolvedConfig): CollectionMethods {
  const items = (key: string) => `/v1/collections/${encodeURIComponent(key)}/items`;
  const item = (key: string, id: string) => `${items(key)}/${encodeURIComponent(id)}`;

  /** A body carrying a locale only when one was asked for. */
  const withLocale = (body: object, options: LocaleOptions) => ({
    ...body,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
  });

  return {
    listCollections: (options = {}) =>
      callUnpaginated<CollectionSummary>(cfg, {
        method: "GET",
        path: "/v1/collections",
        ...passInit(options),
      }),

    listItems: (key, options = {}) =>
      callList<CollectionItem>(cfg, {
        method: "GET",
        path: items(key),
        query: {
          status: options.status,
          view: options.view,
          locale: options.locale,
          limit: options.limit,
          offset: options.offset,
        },
        ...passInit(options),
      }),

    getItem: (key, id, options = {}) =>
      call<CollectionItem>(cfg, {
        method: "GET",
        path: item(key, id),
        query: { view: options.view, locale: options.locale },
        read: { kind: "raw" },
        ...passInit(options),
      }),

    createItem: (key, newItem, options = {}) =>
      call<CollectionItem>(cfg, {
        method: "POST",
        path: items(key),
        body: withLocale({ ...newItem }, options),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    patchItem: (key, id, patch, options = {}) =>
      call<CollectionItem>(cfg, {
        method: "PATCH",
        path: item(key, id),
        body: withLocale({ ...patch }, options),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    publishItem: (key, id, options = {}) =>
      call<ItemPublishResult>(cfg, {
        method: "POST",
        path: `${item(key, id)}/publish`,
        body: withLocale({}, options),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    archiveItem: (key, id, options = {}) =>
      call<CollectionItem>(cfg, {
        method: "POST",
        path: `${item(key, id)}/archive`,
        body: withLocale({}, options),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    deleteItem: (key, id, options = {}) =>
      call<DeleteResult>(cfg, {
        method: "DELETE",
        path: item(key, id),
        query: { force: options.force },
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async reorderItems(key, orderedIds, options) {
      assertCompleteOrder(orderedIds, options.expectedItemIds);
      const applied = await call<{ ids?: string[] }>(cfg, {
        method: "POST",
        path: `${items(key)}/reorder`,
        body: { ids: [...orderedIds] },
        read: { kind: "raw" },
        ...passInit(options),
      });
      return applied.ids ?? [...orderedIds];
    },
  };
}

/** The service's own bounds on a reorder set. */
const reorderBounds = { min: 1, max: 500 } as const;

/**
 * Refuse an order the service would refuse, without spending the request.
 *
 * @throws `TypeError` naming what is missing, extra or duplicated.
 * @remarks
 * A local failure is legible: the message names the ids, whereas the service's `400` arrives after a
 * round trip and after the editor has watched a spinner. The check is set equality rather than a
 * length comparison, so swapping one id for another cannot pass.
 */
function assertCompleteOrder(orderedIds: readonly string[], expected: readonly string[]): void {
  if (orderedIds.length < reorderBounds.min || orderedIds.length > reorderBounds.max) {
    throw new TypeError(
      `a reorder must name between ${reorderBounds.min} and ${reorderBounds.max} items, received ${orderedIds.length}`,
    );
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new TypeError(`a reorder cannot repeat an item: ${[...duplicates].join(", ")}`);
  }

  const wanted = new Set(expected);
  const missing = [...wanted].filter((id) => !seen.has(id));
  const unknown = [...seen].filter((id) => !wanted.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new TypeError(
      "a reorder must list every item exactly once — a partial list is rejected outright, never " +
        `applied to a prefix. Missing: ${missing.join(", ") || "none"}. Not in the collection: ${
          unknown.join(", ") || "none"
        }.`,
    );
  }
}
