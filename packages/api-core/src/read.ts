/**
 * How to read a response body.
 *
 * @remarks
 * An explicit parameter on every call, never a default, because there is no correct default.
 * A single `unwrap(body.data)` helper compiles, returns the right rows, and silently discards
 * sibling metadata: a time series without its `interval` cannot be labelled, and a stuck list
 * without its `cutoff` cannot say what it filtered on.
 */
export type ReadKind =
  /** Unwrap `data`, for envelopes that carry nothing else. */
  | "data"
  /** Return `{ data, …siblings }` whole, for envelopes whose siblings are meaningful. */
  | "envelope"
  /** The parsed body untouched — payment-service has no envelope, and `/api/health`. */
  | "raw"
  /** `ArrayBuffer` plus content type — invoice-service answers `application/pdf`. */
  | "bytes"
  /** Nothing to read: a 204, or a webhook acknowledgement. */
  | "none";

/** A read path, optionally asking for the status and headers alongside the value. */
export interface ReadMode {
  readonly kind: ReadKind;
  /**
   * Return {@link ResponseMeta} instead of the bare value.
   *
   * @remarks
   * Used by exactly the two idempotent creates, where the status code *is* the contract:
   * invoice-service answers `201` for a newly issued invoice and `200` for an idempotent
   * replay, and payment-service adds an `Idempotent-Replay: true` header. A transport that
   * returned only the body would throw away the one distinction idempotency exists to express.
   * Everywhere else the plain value is returned, because an envelope on every call is noise.
   */
  readonly withMeta?: boolean;
}

/** A value together with the parts of the response that carry contract meaning. */
export interface ResponseMeta<T> {
  readonly value: T;
  readonly status: number;
  readonly headers: Headers;
}

/** A binary body, as returned for {@link ReadKind} `"bytes"`. */
export interface BytesBody {
  readonly bytes: ArrayBuffer;
  readonly contentType: string | null;
}

/**
 * Parse a JSON body without ever throwing.
 *
 * @returns The parsed body, or `null` when it is empty or not JSON.
 * @remarks
 * Used on the error path too. The error envelope is where `code` and `details` live, so a
 * transport that reads the body only on success discards the one thing a caller can act on —
 * but a malformed error body must not replace the real failure with a parse error.
 */
export async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text.length === 0 ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read a successful response according to its read mode.
 *
 * @param response - A 2xx response.
 * @param kind - Which read path to take.
 * @returns The value, whose type the caller asserts.
 */
export async function readBody(response: Response, kind: ReadKind): Promise<unknown> {
  switch (kind) {
    case "none":
      return undefined;
    case "bytes":
      return {
        bytes: await response.arrayBuffer(),
        contentType: response.headers.get("content-type"),
      } satisfies BytesBody;
    case "data": {
      const body = await parseJsonSafe(response);
      return (body as { data?: unknown } | null)?.data;
    }
    case "envelope":
    case "raw":
      return await parseJsonSafe(response);
  }
}
