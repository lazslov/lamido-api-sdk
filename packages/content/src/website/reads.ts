/**
 * `/api/content/*` — the published read tier, and the shape of the client that serves it.
 *
 * @remarks
 * Every method here is a `GET`, and none of them accepts a `?view=` parameter. Any value other
 * than `published` is a `403` on this tier for *every* kind of key, so a parameter whose only
 * non-default value is guaranteed to fail has no reason to exist in an SDK.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { type AggregateQuery, aggregateQuery } from "../aggregate.js";
import { call, callListOrNull, callOrNull } from "../call.js";
import { type ListOptions, type LocaleOptions, passInit, type RequestOptions } from "../options.js";
import { type PublishedPage, toPublishedPage } from "../page.js";
import type {
  AggregateGroup,
  CollectionItem,
  ContentHealth,
  ContentList,
  ContentSite,
  PageDocument,
  PublishedPageSummary,
} from "../types.js";
import { getHealth } from "./health.js";

/**
 * The published read tier.
 *
 * @remarks
 * Constructed with a `cpk_` publishable key, which may ship in a browser bundle, or with a `csk_`
 * secret key, which may not — a server-rendered site does not need a second credential just to
 * read. See `createWebsiteClient`.
 */
export interface WebsiteClient {
  /**
   * Every published page.
   *
   * @remarks
   * Unpaginated, and takes no parameters at all — not even `locale`, because a page's `title` is a
   * column on the page rather than a localised value. A page that has never been published, or an
   * inactive one, is **absent** rather than listed with a null version. For a sitemap or a static
   * path list.
   */
  listPages(options?: RequestOptions): Promise<PublishedPageSummary[]>;

  /**
   * One page's published document.
   *
   * @param slug - The page slug.
   * @param options - Locale, and the framework's `init`.
   * @returns The page, or `null` when it is unpublished, inactive, unknown — or belongs to another
   * site, which reads as absent because tenant scoping is per-query.
   * @remarks
   * A `404` here is the normal state of a freshly provisioned site, so it is not an error. Every
   * other status still throws: a `401` from the same call means the key is wrong, and returning
   * `null` for it would render an empty page over a credential problem.
   */
  getPage(slug: string, options?: LocaleOptions): Promise<PublishedPage | null>;

  /**
   * The site's identity and chrome.
   *
   * @remarks
   * `settings` holds nav labels, social links, e-mail addresses, bank details and page metadata.
   * It is a **reserved section on a page**, not a separate table, which is why publishing a page
   * can change this payload — and why nothing in a revalidation webhook tells you whether it did.
   * A site with no `settings` section gets `{}` here, never a `404`, so a failure is not how a
   * seeding mistake announces itself.
   */
  getSite(options?: LocaleOptions): Promise<ContentSite>;

  /**
   * One collection's published items, in `position` order.
   *
   * @param key - The collection key.
   * @param options - Locale, pagination, `init`.
   * @returns A page of items, or `null` when the collection is not defined.
   */
  getCollection(key: string, options?: ListOptions): Promise<ContentList<CollectionItem> | null>;

  /**
   * One published item.
   *
   * @param key - The collection key.
   * @param idOrSlug - Either a uuid, as the list payload carries, or the item's slug, as a URL
   * carries.
   * @returns The item, or `null` when it is draft, archived or unknown.
   */
  getCollectionItem(
    key: string,
    idOrSlug: string,
    options?: LocaleOptions,
  ): Promise<CollectionItem | null>;

  /**
   * A dataset's grouped counts and sums.
   *
   * @param key - The dataset key.
   * @param query - What to group, sum and filter by.
   * @returns The groups, or `null` when this dataset's aggregate is not public.
   * @remarks
   * **`null` means unknown and must hide the UI**, never render as `0`. A progress bar at 0% is a
   * lie about money, and staff have to opt a dataset in before its aggregate is served at all — an
   * unconfigured one answers the same `404` as an unknown dataset, deliberately, because a `403`
   * would confirm the dataset exists.
   *
   * A total always comes from here and **never from a stored counter**: one call, and it cannot
   * drift from the records it summarises.
   */
  getDatasetAggregate(key: string, query?: AggregateQuery): Promise<AggregateGroup[] | null>;

  /**
   * The service's health, degraded body included.
   *
   * @remarks
   * Unauthenticated, so it answers whatever key this client holds — or none.
   */
  getHealth(options?: RequestOptions): Promise<ContentHealth>;
}

/**
 * Bind the published read tier to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindWebsiteReads(cfg: ResolvedConfig): WebsiteClient {
  return {
    listPages: (options = {}) =>
      call<PublishedPageSummary[]>(cfg, {
        method: "GET",
        path: "/api/content/pages",
        read: { kind: "data" },
        ...passInit(options),
      }),

    async getPage(slug, options = {}) {
      const document = await callOrNull<PageDocument>(cfg, {
        method: "GET",
        path: `/api/content/pages/${encodeURIComponent(slug)}`,
        query: { locale: options.locale },
        read: { kind: "data" },
        ...passInit(options),
      });
      return document === null ? null : toPublishedPage(document);
    },

    getSite: (options = {}) =>
      call<ContentSite>(cfg, {
        method: "GET",
        path: "/api/content/site",
        query: { locale: options.locale },
        read: { kind: "data" },
        ...passInit(options),
      }),

    getCollection: (key, options = {}) =>
      callListOrNull<CollectionItem>(cfg, {
        method: "GET",
        path: `/api/content/collections/${encodeURIComponent(key)}`,
        query: { locale: options.locale, limit: options.limit, offset: options.offset },
        ...passInit(options),
      }),

    getCollectionItem: (key, idOrSlug, options = {}) =>
      callOrNull<CollectionItem>(cfg, {
        method: "GET",
        path: `/api/content/collections/${encodeURIComponent(key)}/items/${encodeURIComponent(idOrSlug)}`,
        query: { locale: options.locale },
        read: { kind: "data" },
        ...passInit(options),
      }),

    getDatasetAggregate: (key, query = {}) =>
      callOrNull<AggregateGroup[]>(cfg, {
        method: "GET",
        path: `/api/content/datasets/${encodeURIComponent(key)}/aggregate`,
        query: aggregateQuery(query),
        read: { kind: "data" },
        ...passInit(query),
      }),

    getHealth: (options = {}) => getHealth(cfg, options),
  };
}
