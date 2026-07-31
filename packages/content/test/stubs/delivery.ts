/**
 * Signed revalidation deliveries, built the way the service builds them.
 *
 * @remarks
 * The handler suites need a *live* timestamp rather than the pinned fixtures' fixed one, because the
 * handler does not accept an injectable clock — it is a route handler, and a test-only `nowSeconds`
 * parameter on it would be surface a consumer could reach. So these are signed here, with
 * `node:crypto`, deliberately a different implementation from the `crypto.subtle` one under test.
 *
 * The pinned fixtures in `test/fixtures/revalidation/` remain the drift guard for the *verifier*; this
 * only produces well-formed input for the *handler*.
 */

import { createHmac } from "node:crypto";
import { signatureHeader, timestampHeader } from "../../src/webhook.js";

/** The secret both sides of a test share. Not a credential, and shaped to pass the leak guard. */
export const testRevalidateSecret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** HMAC-SHA-256 over `${timestamp}.${rawBody}`, lowercase hex behind the prefix the service sends. */
export function sign(rawBody: string, timestamp: string, secret = testRevalidateSecret): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

/** One delivery body, as the service composes it. */
export function deliveryBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    site: "acme_foundation",
    type: "page",
    slug: "home",
    collection: null,
    version: 8,
    publishedAt: "2026-07-28T09:12:44.101Z",
    ...overrides,
  });
}

/** Options for {@link deliveryRequest}. */
export interface DeliveryOptions {
  /** Defaults to a page publish. */
  readonly body?: string;
  /** Defaults to now. Pass an old value to test the staleness window. */
  readonly timestamp?: string;
  /** Defaults to a correct signature over `body` and `timestamp`. */
  readonly signature?: string | null;
  /** Sign with a different secret, to produce a wrong-but-well-formed signature. */
  readonly secret?: string;
}

/**
 * A `POST` a route handler can be called with.
 *
 * @remarks
 * A real `Request`, not a stub: the handler reads `request.text()` and `request.headers`, and the
 * point of the suite is that those work.
 */
export function deliveryRequest(options: DeliveryOptions = {}): Request {
  const body = options.body ?? deliveryBody();
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature =
    options.signature === undefined ? sign(body, timestamp, options.secret) : options.signature;

  const headers = new Headers({ "content-type": "application/json" });
  headers.set(timestampHeader, timestamp);
  if (signature !== null) headers.set(signatureHeader, signature);

  return new Request("https://site.example.com/api/revalidate", {
    method: "POST",
    headers,
    body,
  });
}
