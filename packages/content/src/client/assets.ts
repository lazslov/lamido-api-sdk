/**
 * `/v1/assets/*` — images, in three steps, and the bytes never touch your server.
 *
 * @remarks
 * ```
 * server ──1──▶ createUploadToken()               → { token, pathname, … }
 * browser ─2──▶ direct PUT to Blob with that token   ← NOT the SDK's job
 * server ──3──▶ registerAsset({ blobPathname, … }) → the registered row
 * ```
 *
 * **Step 2 is deliberately absent.** It needs `@vercel/blob/client` in the browser, which would
 * break this package's zero-dependency rule for a call the SDK cannot make anyway. And proxying the
 * file through your own server is not a shortcut: a serverless request-body cap (4.5 MB on Vercel)
 * is well under the 15 MB the service allows, so proxying makes large photos fail for a reason that
 * has nothing to do with images.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, callCursorList } from "../call.js";
import { type CursorListOptions, passInit, type RequestOptions } from "../options.js";
import type {
  ContentAsset,
  ContentCursorList,
  DeleteResult,
  ImageContentType,
  UploadToken,
} from "../types.js";

/** What step 1 asks for. */
export interface UploadTokenRequest extends RequestOptions {
  /**
   * A filename, not a path, 1–300 characters.
   *
   * @remarks
   * Sanitised server-side regardless of what arrives: directory components are dropped, the name is
   * reduced to `[a-z0-9._-]`, and the result always lands under `sites/<siteSlug>/`.
   */
  readonly filename: string;
  /** SVG is not one of the four — it is a script-execution vector served from a CDN origin. */
  readonly contentType: ImageContentType;
}

/** What step 3 registers. */
export interface AssetRegistration extends RequestOptions {
  /**
   * The pathname **Blob actually created** — what `upload()` returned, not what the token asked for.
   *
   * @remarks
   * Blob appends a random suffix, so the token's pathname is not the one that exists, and
   * re-registering a pathname is a `409` with `details.assetId`. This parameter is named
   * `blobPathname` rather than `pathname` precisely so the two cannot be confused at the call site.
   */
  readonly blobPathname: string;
  /** The public Blob URL. A URL Blob's own `del()` cannot accept is a `400`. */
  readonly url: string;
  readonly contentType: ImageContentType;
  /** 1 … 15 728 640 bytes. **`0` is a `400`** — a zero-byte image is a failed upload. */
  readonly size: number;
  /** Rendering hints from the browser that already decoded the image. */
  readonly width?: number;
  readonly height?: number;
}

/** The asset half of a client-tier client. */
export interface AssetMethods {
  /**
   * Step 1: mint an upload capability.
   *
   * @returns The token, the pathname it covers, the accepted content types and the size cap.
   * @remarks
   * The token reaches the browser; the `csk_` key never does. It is valid for **15 minutes** and for
   * one pathname under this site's prefix — a capability should cover one upload, not one session.
   * Tell the user *why* a file was refused, from `allowed_content_types` and `maximum_size_in_bytes`,
   * rather than letting Blob reject the PUT opaquely.
   */
  createUploadToken(request: UploadTokenRequest): Promise<UploadToken>;

  /**
   * Step 3: register what Blob stored.
   *
   * @remarks
   * Registration is explicit rather than Blob's `onUploadCompleted` callback, which does not fire
   * against `localhost` — relying on it would make local development diverge from production in
   * exactly the flow that is hardest to test.
   */
  registerAsset(registration: AssetRegistration): Promise<ContentAsset>;

  /**
   * This site's image library, newest first, with a live `references` count per asset.
   *
   * @remarks
   * `references: 0` means safe to delete. This is also the list an image picker needs, and the list
   * {@link AssetMethods.getAssetIdByUrl} maps.
   */
  listAssets(options?: CursorListOptions): Promise<ContentCursorList<ContentAsset>>;

  /**
   * Delete an asset, row first and object second.
   *
   * @throws {@link ../errors.js | ContentApiError} `conflict` with `details.references` naming every
   * place it is used, in **both** views — an image only a draft references is still someone's work in
   * progress.
   * @remarks
   * `blobDeleted: false` means the row went and the object survived; that is work for the service's
   * GC CLI, not a failure. The order is deliberate: an orphaned object is recoverable garbage, while
   * a row pointing at deleted bytes is a broken image on a live site. There is no `force` here — an
   * editor bypassing the reference check would blank an image on their own site.
   */
  deleteAsset(id: string, options?: RequestOptions): Promise<DeleteResult>;

  /**
   * The asset id behind a resolved image URL.
   *
   * @param url - The `url` of a {@link ../fields/types.js | ContentImage}.
   * @returns The id, or `null` when the URL is not this site's or the lookup failed.
   * @remarks
   * Exists because of a genuine asymmetry: reading a content value gives you the resolved image and
   * **never its `assetId`**, but writing alt text back means writing `{ assetId, alt }`. A URL
   * identifies an asset uniquely, so the lookup is exact.
   *
   * It answers `null` rather than throwing, including when the read itself failed, because the
   * documented degradation is *"alt text is not editable right now"* — never failing the whole form
   * over it. Costs one paged read of the library; hold onto the result if you are mapping several.
   */
  getAssetIdByUrl(url: string, options?: RequestOptions): Promise<string | null>;
}

/**
 * Bind the asset methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindAssetMethods(cfg: ResolvedConfig): AssetMethods {
  const methods: AssetMethods = {
    createUploadToken: (request) =>
      call<UploadToken>(cfg, {
        method: "POST",
        path: "/v1/assets/upload-token",
        body: { filename: request.filename, content_type: request.contentType },
        read: { kind: "raw" },
        ...passInit(request),
      }),

    registerAsset: (registration) =>
      call<ContentAsset>(cfg, {
        method: "POST",
        path: "/v1/assets",
        // `blobPathname` becomes the wire's `pathname`: the rename is the whole guard.
        body: {
          pathname: registration.blobPathname,
          url: registration.url,
          content_type: registration.contentType,
          size: registration.size,
          ...(registration.width === undefined ? {} : { width: registration.width }),
          ...(registration.height === undefined ? {} : { height: registration.height }),
        },
        read: { kind: "raw" },
        ...passInit(registration),
      }),

    listAssets: (options = {}) =>
      callCursorList<ContentAsset>(cfg, {
        method: "GET",
        path: "/v1/assets",
        query: { limit: options.limit, cursor: options.cursor },
        ...passInit(options),
      }),

    deleteAsset: (id, options = {}) =>
      call<DeleteResult>(cfg, {
        method: "DELETE",
        path: `/v1/assets/${encodeURIComponent(id)}`,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async getAssetIdByUrl(url, options = {}) {
      try {
        // Walked by cursor, and the cursor is the only terminator: the asset library grows with
        // every upload, so it is keyset-paged and reports no `total` to count against.
        let cursor: string | undefined;
        do {
          const page = await methods.listAssets({ ...options, limit: pageSize, cursor });
          const found = page.items.find((asset) => asset.url === url);
          if (found) return found.public_id;
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined);
        return null;
      } catch {
        // The documented degradation, and the reason this returns null rather than throwing.
        return null;
      }
    },
  };

  return methods;
}

/** The documented maximum keyset page size, so the library is walked in as few reads as allowed. */
const pageSize = 200;
