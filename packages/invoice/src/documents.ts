/**
 * The two PDF paths this package calls, and the one it deliberately does not.
 *
 * @remarks
 * `getInvoicePdf` fetches the bytes with the client key; `createDownloadLink` mints a public URL for
 * an end customer. The third path — `GET /api/public/invoices/:id/pdf?token=…` — is unauthenticated and
 * is **not** implemented here: it is a URL to hand to a browser or paste into an email, and fetching it
 * server-side through an authenticated client is pointless.
 *
 * PDFs are not stored. Every call re-fetches from the provider, so a provider outage means no PDF even
 * for an old invoice — do not build a "download all invoices" feature that assumes availability.
 */

import type { BytesBody, ResolvedConfig } from "@lamido/api-core";
import { call, callWithMeta, invoicePath, passInit, type RequestOptions } from "./call.js";
import type { DownloadLink, InvoicePdf } from "./types.js";

/** The document half of a client. */
export interface DocumentMethods {
  /**
   * Download an invoice's PDF.
   *
   * @param id - The invoice's `id`.
   * @param options - `init` only.
   * @returns The bytes, and the filename the service named.
   * @throws {@link ./errors.js | InvoiceNotDownloadableError} when the invoice is not `created` —
   * **including a cancelled one**, whose document still exists at the provider but is not served here.
   * Mint a link before cancelling if the customer will still need it.
   * @throws {@link ./errors.js | InvoiceApiError} on a `404`, or a `502` when the provider is
   * unreachable.
   * @remarks
   * Re-fetched from the provider on every call, so this is not a cheap read and it is **not** a way to
   * check status — poll `getInvoice` for that.
   *
   * A browser cannot link here: the endpoint needs the `isk_` key. Serving a PDF to a signed-in user
   * means a route of your own that authenticates the session, calls this, and streams the bytes back —
   * or `createDownloadLink`, for someone with no session at all.
   */
  getInvoicePdf(id: string, options?: RequestOptions): Promise<InvoicePdf>;

  /**
   * Mint a public, signed URL for the PDF.
   *
   * @param id - The invoice's `id`.
   * @param options - `init` only.
   * @returns The URL and its expiry.
   * @throws {@link ./errors.js | InvoiceNotDownloadableError} when the invoice is not `created`.
   * @remarks
   * For sending an invoice to the end customer without exposing the API key. The TTL is **exactly 7
   * days** and is not configurable, and the token is bound to this one invoice.
   *
   * **A link cannot be revoked.** Anyone holding the URL can fetch the PDF until it expires; there is
   * no way to kill one link, and no way to shorten or extend one already minted. Revoking them all at
   * once means an operator changing the service's link-signing key. So treat the URL as a bearer
   * capability: send it to the customer, do not post it publicly, do not log it — a link handed to the
   * wrong recipient has no undo.
   *
   * Calling this again mints a *new* token; the old ones stay valid until they expire. Mint on demand
   * rather than storing the URL, since a stored one silently stops working after a week.
   */
  createDownloadLink(id: string, options?: RequestOptions): Promise<DownloadLink>;
}

/**
 * Bind the document methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindDocumentMethods(cfg: ResolvedConfig): DocumentMethods {
  return {
    async getInvoicePdf(id, options = {}) {
      // With meta, because the filename is in a response header rather than in the body.
      const answer = await callWithMeta<BytesBody>(cfg, {
        method: "GET",
        path: `${invoicePath(id)}/pdf`,
        read: { kind: "bytes" },
        ...passInit(options),
      });

      return {
        bytes: answer.value.bytes,
        filename: filenameFrom(answer.headers.get("content-disposition"), id),
      };
    },

    createDownloadLink: (id, options = {}) =>
      call<DownloadLink>(cfg, {
        method: "GET",
        path: `${invoicePath(id)}/download-link`,
        read: { kind: "data" },
        ...passInit(options),
      }),
  };
}

/** `filename*=UTF-8''…`, which takes precedence when both forms are present. */
const extendedFilename = /filename\*=\s*[^']*'[^']*'([^;]+)/i;

/** `filename="…"` or `filename=…`. */
const plainFilename = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i;

/**
 * Read the filename out of a `Content-Disposition`.
 *
 * @param header - The header value, or `null` when the service sent none.
 * @param id - The invoice id, for the fallback.
 * @returns A bare filename — the invoice number for szamlazz, the document id for Billingo.
 * @remarks
 * Reduced to its last path segment before being returned. The value originates at the provider and
 * ends up in a `Content-Disposition` of the consumer's own, or in a filename on disk; a `../` in it
 * would be a traversal, and neither this service nor the provider promises it is clean.
 */
function filenameFrom(header: string | null, id: string): string {
  const fallback = `invoice-${id}.pdf`;
  if (!header) return fallback;

  const extended = extendedFilename.exec(header)?.[1];
  const match = extended ?? plainFilename.exec(header)?.[1] ?? plainFilename.exec(header)?.[2];
  if (match === undefined) return fallback;

  const decoded = extended === undefined ? match.trim() : safeDecode(extended.trim());
  const bare = decoded.split(/[\\/]/).pop()?.trim();
  return bare === undefined || bare === "" || bare === "." || bare === ".." ? fallback : bare;
}

/** A percent-encoded `filename*` that is not valid UTF-8 is used as-is rather than throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
