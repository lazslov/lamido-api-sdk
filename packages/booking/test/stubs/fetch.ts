/**
 * A stub `fetch`, and the two clients wired to it.
 *
 * @remarks
 * Every suite drives the real client through the real transport and asserts on what reached `fetch`
 * — the URL, the method, the headers and the body. Stubbing higher up would test the stub.
 */

import type { ServiceConfig } from "@lazslov/api-core";
import {
  type BookingClient,
  type BookingPublicClient,
  createBookingClient,
  createBookingPublicClient,
} from "../../src/client.js";

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
  lastMethod(): string | undefined;
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
    lastMethod() {
      return calls.at(-1)?.init.method;
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

/** A success response. A single resource is the resource, unwrapped. */
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

/** A list response, in the one envelope every list on the service answers with. */
export function listResponse(items: unknown[], nextCursor: string | null = null): Response {
  return jsonResponse({ data: items, next_cursor: nextCursor });
}

/** A `204`, as every delete and every assignment answers. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** An RFC 9457 problem document, as every failure is served. */
export function problemResponse(
  status: number,
  slug: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `urn:booking-service:problem:${slug}`,
      title: titleFor(status),
      status,
      detail: `stub detail for ${status}`,
      instance: "/v1/bookings",
      request_id: "019e5c31-0000-7000-8000-0000000000ff",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** `title` summarises the status, not the type — which is exactly why nothing branches on it. */
function titleFor(status: number): string {
  return status === 422 ? "Unprocessable Entity" : status === 409 ? "Conflict" : "Error";
}

/** A test publishable key. Not a credential, and shaped so the repository's leak guard tolerates it. */
export const testPublishableKey = "bpk_YOUR_PUBLISHABLE_KEY_test0";

/** A test secret key. Likewise. */
export const testSecretKey = "bsk_YOUR_SECRET_KEY_test000";

/** A documentation host, so no real deployment name lands in a test. */
export const testBaseUrl = "https://booking.example.com";

/** A public client talking through `stub`. */
export function publicClient(stub: FetchStub, overrides: ServiceConfig = {}): BookingPublicClient {
  return createBookingPublicClient({
    baseUrl: testBaseUrl,
    apiKey: testPublishableKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** A tenant client talking through `stub`. */
export function tenantClient(stub: FetchStub, overrides: ServiceConfig = {}): BookingClient {
  return createBookingClient({
    baseUrl: testBaseUrl,
    apiKey: testSecretKey,
    fetch: stub.fetch,
    ...overrides,
  });
}

/** Well-formed ids that belong to nobody. */
export const ids = {
  location: "019e5c31-0000-7000-8000-000000000101",
  service: "019e5c31-0000-7000-8000-000000000102",
  employee: "019e5c31-0000-7000-8000-000000000103",
  customer: "019e5c31-0000-7000-8000-000000000104",
  hold: "019e5c31-0000-7000-8000-000000000105",
  booking: "019e5c31-0000-7000-8000-000000000106",
  endpoint: "019e5c31-0000-7000-8000-000000000201",
  delivery: "019e5c31-0000-7000-8000-000000000202",
  rule: "019e5c31-0000-7000-8000-000000000301",
  exception: "019e5c31-0000-7000-8000-000000000302",
} as const;

/** The members every booking view shares. */
function bookingCommon(overrides: Record<string, unknown> = {}) {
  return {
    public_id: ids.booking,
    status: "pending",
    location_id: ids.location,
    service_id: ids.service,
    service_name: "Hajvágás",
    employee_id: ids.employee,
    employee_name: "Béla",
    starts_at: "2026-09-14T08:00:00.000Z",
    ends_at: "2026-09-14T08:45:00.000Z",
    timezone: "Europe/Budapest",
    pending_reason: null,
    expires_at: "2026-09-14T07:10:00.000Z",
    confirmed_at: null,
    canceled_at: null,
    completed_at: null,
    cancellation_reason: null,
    rescheduled_from_id: null,
    rescheduled_to_id: null,
    created_at: "2026-09-14T07:00:00.000Z",
    updated_at: "2026-09-14T07:00:00.000Z",
    ...overrides,
  };
}

/** A booking as the public tier returns it. */
export function publicBooking(overrides: Record<string, unknown> = {}) {
  return bookingCommon({ customer: { name: "Anna Kovács" }, ...overrides });
}

/** A booking as the tenant tier returns it. */
export function booking(overrides: Record<string, unknown> = {}) {
  return bookingCommon({
    customer: {
      public_id: ids.customer,
      name: "Anna Kovács",
      email: "anna@example.com",
      phone: "+36301234567",
      external_ref: "crm-8842",
    },
    metadata: { campaign: "autumn-2026" },
    ...overrides,
  });
}

/** The capability tokens a create carries. Placeholders, not credentials. */
export const tokens = {
  management_token: "mgmt-token-example",
  confirmation_token: "confirm-token-example",
} as const;

/** A hold. */
export function hold(overrides: Record<string, unknown> = {}) {
  return {
    hold_id: ids.hold,
    service_id: ids.service,
    employee_id: ids.employee,
    starts_at: "2026-09-14T08:00:00.000Z",
    ends_at: "2026-09-14T08:45:00.000Z",
    expires_at: "2026-09-14T07:10:00.000Z",
    ...overrides,
  };
}

/** A minimal valid create body, on either tier. */
export function createBody() {
  return {
    service_id: ids.service,
    employee_id: ids.employee,
    starts_at: "2026-09-14T08:00:00Z",
    customer: { email: "anna@example.com", name: "Anna Kovács" },
  } as const;
}

/** A registered webhook endpoint. */
export function webhookEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    public_id: ids.endpoint,
    url: "https://acme.example.com/hooks/booking",
    description: "Production receiver",
    subscribed_events: null,
    contract_version: 1,
    enabled: true,
    disabled_reason: null,
    consecutive_failures: 0,
    secret_last4: "0123",
    secret_fingerprint: "deadbeef",
    include_customer: false,
    created_at: "2026-09-14T07:00:00.000Z",
    updated_at: "2026-09-14T07:00:00.000Z",
    ...overrides,
  };
}
