/**
 * `/v1/products` — the storefront tier's catalog reads.
 *
 * @remarks
 * The same shapes as the public tier, from the same implementation, so a storefront backend and a
 * browser never disagree about what is published. What this tier does **not** get is caching: no
 * `ETag`, no `Cache-Control`, no `304`. Cache it yourself if you need to.
 */

import type { CursorPage, ResolvedConfig } from "@lazslov/api-core";
import {
  type CursorListOptions,
  callCursorList,
  callOrNull,
  passInit,
  type RequestOptions,
} from "./call.js";
import type { Product } from "./types.js";

/** The catalog part of a storefront client. */
export interface CatalogMethods {
  /**
   * A page of published products, newest first.
   *
   * @remarks
   * `status = 'published'` is the tier, not a parameter: there is no filter and no way to ask for
   * drafts. Follow `nextCursor` to the end, or hand this to core's `collectAllCursor`.
   */
  listProducts(options?: CursorListOptions): Promise<CursorPage<Product>>;

  /**
   * One published product, by `public_id` or by slug.
   *
   * @param idOrSlug - A UUID-shaped segment is tried as an id; anything else can only be a slug.
   * @returns The product, or `null` when the slug is unknown in this shop or the product is `draft` or
   * `archived`.
   * @remarks
   * The one read on this package that maps a `404` to `null`, because the knowledge base documents it
   * as a normal state — a product page route resolves a slug from a URL, and an unpublished product
   * *is* a not-found page. Every other status still throws.
   */
  getProduct(idOrSlug: string, options?: RequestOptions): Promise<Product | null>;
}

/**
 * Bind the storefront catalog reads to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCatalogMethods(cfg: ResolvedConfig): CatalogMethods {
  return {
    listProducts: (options = {}) =>
      callCursorList<Product>(cfg, {
        method: "GET",
        path: "/v1/products",
        query: { limit: options.limit, cursor: options.cursor },
        ...passInit(options),
      }),

    getProduct: (idOrSlug, options = {}) =>
      callOrNull<Product>(cfg, {
        method: "GET",
        path: `/v1/products/${encodeURIComponent(idOrSlug)}`,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
