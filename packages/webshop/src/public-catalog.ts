/**
 * `/v1/public/products` — the `wpk_` browser tier, with its caching contract.
 *
 * @remarks
 * Two `GET`s, and the only endpoints on the service that set cache headers:
 * `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` and an `ETag`. Send the `ETag`
 * back as `If-None-Match` and a match answers `304` with an empty body. Every read here therefore
 * returns the validator beside the value, and a conditional read may answer "not modified" instead of
 * a value.
 *
 * **A `304` needs deliberate handling.** `@lazslov/api-core`'s transport treats any non-2xx as a
 * failure and hands it to the error parser, so the parser bound here recognises a `304` and returns a
 * private signal the reader converts into {@link CatalogNotModified}. Nothing about that escapes this
 * module.
 */

import {
  type CursorPage,
  type ErrorContext,
  LamidoApiError,
  type ResolvedConfig,
  request,
} from "@lazslov/api-core";
import {
  type CursorListOptions,
  passInit,
  type RequestOptions,
  toCursorPage,
  type WebshopRequest,
} from "./call.js";
import { parseWebshopError, serviceName, WebshopApiError } from "./errors.js";
import type { Product } from "./types.js";

/** A conditional read: send a previously returned `etag` back. */
export interface ConditionalOptions {
  /**
   * The `etag` from an earlier read of the same resource.
   *
   * @remarks
   * Compared **weakly** by the service: `W/` and quotes are stripped, and `*` matches anything.
   * Pass it back verbatim.
   */
  readonly ifNoneMatch: string;
}

/**
 * A fresh answer from the public catalog.
 *
 * @remarks
 * `etag` is the validator to send back next time. Budget one minute of staleness at the edge: the
 * list's validator reads the product's `updated_at`, and a price edited without touching the product
 * row will not invalidate the list page it appears on until `s-maxage` lapses.
 */
export interface CatalogFresh<T> {
  readonly notModified: false;
  readonly value: T;
  /** The `ETag` header, or `null` if a proxy stripped it. */
  readonly etag: string | null;
}

/**
 * The service answered `304`: what you hold is still current.
 *
 * @remarks
 * The `ETag` and `Cache-Control` headers are still set on a `304`, so `etag` is present. Accept it and
 * keep serving your copy — but do not assume a CDN cached anything. There is no purge and no webhook
 * to invalidate on; sixty seconds is the whole invalidation story.
 */
export interface CatalogNotModified {
  readonly notModified: true;
  readonly etag: string | null;
}

/** What a conditional read answers. Narrow on `notModified`. */
export type CatalogRead<T> = CatalogFresh<T> | CatalogNotModified;

/** The public catalog. */
export interface PublicCatalogMethods {
  /**
   * A page of published products, conditionally.
   *
   * @param options - Pagination and the `etag` to revalidate against.
   * @returns The page with its `etag`, or `notModified: true` when the validator still matches.
   * @remarks
   * `limit` is part of the validator: an `etag` from `limit=24` never matches a read at `limit=50`.
   */
  listProducts(
    options: CursorListOptions & ConditionalOptions,
  ): Promise<CatalogRead<CursorPage<Product>>>;
  /**
   * A page of published products, newest first, with its `etag`.
   *
   * @remarks
   * The value is core's `CursorPage`, so `collectAllCursor` follows it with one `.then`:
   * `collectAllCursor((p) => shop.listProducts(p).then((read) => read.value))`.
   */
  listProducts(options?: CursorListOptions): Promise<CatalogFresh<CursorPage<Product>>>;

  /**
   * One published product, conditionally.
   *
   * @param idOrSlug - The product's `public_id` or its slug.
   * @param options - The `etag` to revalidate against.
   * @returns The product with its `etag`, `notModified: true` when the validator still matches, or
   * `null` when the product is unknown, `draft` or `archived`.
   * @remarks
   * The single-product validator reads the product **and its variants**, so a price change does
   * invalidate it — unlike the list.
   */
  getProduct(
    idOrSlug: string,
    options: RequestOptions & ConditionalOptions,
  ): Promise<CatalogRead<Product> | null>;
  /**
   * One published product, by `public_id` or by slug, with its `etag`.
   *
   * @returns The product, or `null` on the documented `404` — unknown slug, `draft` or `archived`.
   * @remarks
   * A `404` here is cached at the edge for ten seconds on purpose. If you publish a product and the
   * `404` persists, wait ten seconds before investigating.
   */
  getProduct(idOrSlug: string, options?: RequestOptions): Promise<CatalogFresh<Product> | null>;
}

/**
 * The `304` the transport would otherwise report as a failure.
 *
 * @remarks
 * A `LamidoApiError` because that is the only thing an error parser may return. It never leaves this
 * module: {@link readCatalog} catches it and answers {@link CatalogNotModified}.
 */
class NotModifiedSignal extends LamidoApiError {
  readonly headers: Headers;

  constructor(context: ErrorContext) {
    super({
      service: serviceName,
      status: 304,
      type: "unknown",
      message: "not modified",
      requestPath: context.requestPath,
      retryable: false,
    });
    this.name = "NotModifiedSignal";
    this.headers = context.headers;
  }
}

/** This tier's error parser: a `304` is a signal, everything else is the package's error. */
function parsePublicError(context: ErrorContext): LamidoApiError {
  return context.status === 304 ? new NotModifiedSignal(context) : parseWebshopError(context);
}

/**
 * Make a conditional read, keeping the `ETag` and converting a `304` into a value.
 *
 * @param cfg - The resolved configuration.
 * @param spec - The request.
 * @param ifNoneMatch - The validator to send, if any.
 */
async function readCatalog<T>(
  cfg: ResolvedConfig,
  spec: WebshopRequest,
  ifNoneMatch: string | undefined,
): Promise<CatalogRead<T>> {
  try {
    const answer = await request<T>(cfg, {
      ...spec,
      ...(ifNoneMatch === undefined ? {} : { headers: { "If-None-Match": ifNoneMatch } }),
      read: { ...spec.read, withMeta: true },
      onError: parsePublicError,
    });
    return { notModified: false, value: answer.value, etag: answer.headers.get("etag") };
  } catch (error) {
    if (error instanceof NotModifiedSignal) {
      return { notModified: true, etag: error.headers.get("etag") };
    }
    throw error;
  }
}

/**
 * Bind the public catalog reads to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindPublicCatalogMethods(cfg: ResolvedConfig): PublicCatalogMethods {
  // Overload declarations on a function statement, so the implementation's wider return type is
  // narrowed per call shape without a cast: the conditional signature comes first, because an
  // options object carrying `ifNoneMatch` also satisfies the plain one.
  function listProducts(
    options: CursorListOptions & ConditionalOptions,
  ): Promise<CatalogRead<CursorPage<Product>>>;
  function listProducts(options?: CursorListOptions): Promise<CatalogFresh<CursorPage<Product>>>;
  async function listProducts(
    options: CursorListOptions & Partial<ConditionalOptions> = {},
  ): Promise<CatalogRead<CursorPage<Product>>> {
    const read = await readCatalog<{ data: Product[]; next_cursor: string | null }>(
      cfg,
      {
        method: "GET",
        path: "/v1/public/products",
        query: { limit: options.limit, cursor: options.cursor },
        read: { kind: "envelope" },
        ...passInit(options),
      },
      options.ifNoneMatch,
    );
    return read.notModified ? read : { ...read, value: toCursorPage(read.value) };
  }

  function getProduct(
    idOrSlug: string,
    options: RequestOptions & ConditionalOptions,
  ): Promise<CatalogRead<Product> | null>;
  function getProduct(
    idOrSlug: string,
    options?: RequestOptions,
  ): Promise<CatalogFresh<Product> | null>;
  async function getProduct(
    idOrSlug: string,
    options: RequestOptions & Partial<ConditionalOptions> = {},
  ): Promise<CatalogRead<Product> | null> {
    try {
      return await readCatalog<Product>(
        cfg,
        {
          method: "GET",
          path: `/v1/public/products/${encodeURIComponent(idOrSlug)}`,
          read: { kind: "raw" },
          ...passInit(options),
        },
        options.ifNoneMatch,
      );
    } catch (error) {
      // The documented 404: unknown slug, draft or archived. See `callOrNull` for why nowhere else.
      if (error instanceof WebshopApiError && error.status === 404) return null;
      throw error;
    }
  }

  return { listProducts, getProduct };
}
