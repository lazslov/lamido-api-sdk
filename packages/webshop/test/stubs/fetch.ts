/**
 * A stub `fetch`, and clients wired to it.
 *
 * @remarks
 * Every suite drives the real client through the real transport and asserts on what reached `fetch`.
 * Stubbing higher up would test the stub.
 */

import type { ServiceConfig } from "@lazslov/api-core";
import { createWebshopClient, type WebshopClient } from "../../src/client.js";
import { createWebshopPublicClient, type WebshopPublicClient } from "../../src/public-client.js";

/** One recorded call. */
export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A stub `fetch` plus the log of what it was called with. */
export interface FetchStub {
  readonly fetch: typeof fetch;
  readonly calls: RecordedCall[];
  lastUrl(): string;
  /** The most recent call's body, as text — so key order can be asserted, not just the values. */
  lastBodyText(): string;
  lastBody(): unknown;
  lastHeaders(): Record<string, string>;
}

/**
 * Build a `fetch` that answers from a queue and records every call.
 *
 * @param responses - One response per call, in order. The last repeats once exhausted.
 */
export function fetchStub(responses: Response[] = [jsonResponse({})]): FetchStub {
  const calls: RecordedCall[] = [];
  let index = 0;

  return {
    fetch: (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return (response ?? jsonResponse({})).clone();
    }) as unknown as typeof fetch,
    calls,
    lastUrl() {
      return calls.at(-1)?.url ?? "";
    },
    lastBodyText() {
      const body = calls.at(-1)?.init.body;
      return typeof body === "string" ? body : "";
    },
    lastBody() {
      const body = calls.at(-1)?.init.body;
      return typeof body === "string" ? JSON.parse(body) : undefined;
    },
    lastHeaders() {
      const headers = (calls.at(-1)?.init.headers ?? {}) as Record<string, string>;
      return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
    },
  };
}

/** A success response. A single resource is the body, unwrapped; a list is `{ data, next_cursor }`. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A list envelope. `next_cursor` is always present, `null` on the last page. */
export function listResponse(
  data: unknown[],
  nextCursor: string | null = null,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse({ data, next_cursor: nextCursor }, 200, headers);
}

/** A `304`, as the public tier answers a matching `If-None-Match`. Empty body, headers kept. */
export function notModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: { etag, "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}

/** An RFC 9457 problem document, as every failure is served. */
export function problemResponse(
  status: number,
  type: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type,
      title: titleFor(status),
      status,
      detail: `stub detail for ${status}`,
      instance: "/v1/carts",
      request_id: "0191f3c5-1a02-7d11-b8c0-5e7a9d4f22b1",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** `title` summarises the status, not the type — which is exactly why nothing branches on it. */
function titleFor(status: number): string {
  return status === 422 ? "Unprocessable Entity" : status === 409 ? "Conflict" : "Error";
}

/** A test secret key. Not a credential, and shaped so the repository's leak guard tolerates it. */
export const testSecretKey = "wsk_YOUR_SECRET_KEY_test000";

/** A test publishable key. */
export const testPublishableKey = "wpk_YOUR_PUBLISHABLE_KEY_test0";

/** A documentation host, so no real deployment name lands in a test. */
export const testBaseUrl = "https://webshop.example.com";

/** A storefront client talking through `stub`. */
export function webshopClient(stub: FetchStub, overrides: ServiceConfig = {}): WebshopClient {
  return createWebshopClient({
    baseUrl: testBaseUrl,
    apiKey: testSecretKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A public catalog client talking through `stub`. */
export function publicClient(stub: FetchStub, overrides: ServiceConfig = {}): WebshopPublicClient {
  return createWebshopPublicClient({
    baseUrl: testBaseUrl,
    apiKey: testPublishableKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A published product, as both catalog tiers serve it. */
export function product(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "0191f3b2-1d55-7e03-b4a2-8c0e5f1b7d92",
    slug: "espresso_beans",
    name: "Espresso Beans",
    description: "A dark roast, 1 kg.",
    product_type: "physical",
    variants: [
      {
        public_id: "0191f3b2-2e01-7f14-9b63-4a2d7e0c8f31",
        name: "1 kg whole bean",
        sku: "ESP-1000-WB",
        price: "4990",
        compare_at_price: "5990",
        currency: "HUF",
      },
    ],
    updated_at: "2026-08-10T14:21:07.512Z",
    ...overrides,
  };
}

/** A cart, priced, with one line. */
export function cart(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "0191f3c4-8b21-7c4e-9a55-2f6b0d3e91aa",
    status: "open",
    currency: "HUF",
    customer_id: null,
    session_id: "sess_7f3a91",
    items: [
      {
        public_id: "0191f3c4-9f10-7a02-8d31-1b5e2c7f04aa",
        variant_public_id: "0191f3b2-2e01-7f14-9b63-4a2d7e0c8f31",
        product_public_id: "0191f3b1-9a03-7c22-8e40-2f5d1c3b7a91",
        product_slug: "espresso-beans",
        product_name: "Espresso Beans",
        variant_name: "1 kg whole bean",
        quantity: 2,
        unit_price: "4990",
        line_total: "9980",
        discount_total: "0",
        unavailable: false,
      },
    ],
    coupon_code: "SUMMER10",
    coupon_applied: true,
    shipping_method_id: "0191f3b8-5d02-7e11-9c40-7a2b1e0d5f83",
    subtotal: "9980",
    discount_total: "998",
    shipping_total: "1490",
    tax_total: "2225",
    grand_total: "10472",
    has_unavailable_items: false,
    expires_at: "2026-09-10T09:14:22.017Z",
    created_at: "2026-08-11T09:14:22.017Z",
    updated_at: "2026-08-11T09:20:41.663Z",
    ...overrides,
  };
}

/** An order, as every order read returns it. */
export function order(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "0191f3d0-1122-7a33-b4c5-6d7e8f901234",
    status: "pending",
    currency: "HUF",
    customer_id: "0191e2a0-77c1-7b31-9f02-4d8e1a3c66b2",
    guest_email: null,
    items: [
      {
        product_id: "0191f3b2-1d55-7e03-b4a2-8c0e5f1b7d92",
        variant_id: "0191f3b2-2e01-7f14-9b63-4a2d7e0c8f31",
        product_name: "Espresso Beans",
        variant_name: "1 kg whole bean",
        sku: "ESP-1000-WB",
        unit_price: "4990",
        quantity: 2,
        discount_total: "0",
        total: "9980",
        currency: "HUF",
      },
    ],
    subtotal: "9980",
    discount_total: "998",
    shipping_total: "1490",
    tax_total: "2225",
    grand_total: "10472",
    shipping_method_name: "Courier, next day",
    shipping_method_price: "1490",
    coupon_code: "SUMMER10",
    coupon_discount: "998",
    shipping_address: {
      name: "Ada Lovelace",
      line1: "Kossuth Lajos utca 12",
      line2: null,
      city: "Budapest",
      postal_code: "1053",
      country: "HU",
      phone: null,
    },
    billing_address: null,
    payment_ref: null,
    created_at: "2026-08-11T09:31:55.204Z",
    updated_at: "2026-08-11T09:31:55.204Z",
    ...overrides,
  };
}

/** What checkout answers: the order plus its `payment` block. */
export function checkoutOrder(overrides: Record<string, unknown> = {}) {
  return order({
    payment_ref: "0191f4d2-9a44-7c02-8e51-11b3f6a7c920",
    payment: {
      public_id: "0191f4d2-9a44-7c02-8e51-11b3f6a7c920",
      status: "pending",
      gateway_url: "https://pay.example.com/s/0191f4d29a44",
    },
    ...overrides,
  });
}

/** One carriage option. */
export function shippingOption(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "0191f3b8-5d02-7e11-9c40-7a2b1e0d5f83",
    name: "Courier, next day",
    description: "Delivered within one working day.",
    price: "1490",
    currency: "HUF",
    ...overrides,
  };
}

/** `GET /v1/me`. */
export function identity() {
  return {
    shop: {
      public_id: "0191f3b1-4c02-7a10-9d3e-6b1c0f2a55d7",
      slug: "acme_store",
      name: "Acme Store",
      currency: "HUF",
      locale: "hu-HU",
    },
    key: {
      public_id: "0191f3b1-9a44-7c22-8e51-3d7b2e0c19f4",
      kind: "secret",
      label: "acme storefront backend",
      secret_last4: "9xQ2",
      fingerprint: "3f9a1c0d",
      last_used_at: "2026-08-11T09:12:04.881Z",
      revoked_at: null,
      created_at: "2026-08-04T11:02:19.334Z",
    },
  };
}

/** A minimal valid checkout body. */
export function checkoutBody() {
  return {
    guest_email: "ada@example.com",
    shipping_address: {
      name: "Ada Lovelace",
      line1: "Kossuth Lajos utca 12",
      city: "Budapest",
      postal_code: "1053",
      country: "HU",
    },
  } as const;
}
