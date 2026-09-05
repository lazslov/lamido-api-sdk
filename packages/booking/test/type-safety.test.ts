import type { CursorPage } from "@lazslov/api-core";
import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import type { components } from "../src/generated/schema.js";
import type {
  Booking,
  BookingListRow,
  BookingStatus,
  CancellationReason,
  CreateBookingResult,
  CreatedPublicBooking,
  PublicBookingWithWindows,
} from "../src/types.js";
import {
  booking,
  createBody,
  fetchStub,
  jsonResponse,
  publicBooking,
  publicClient,
  tenantClient,
  tokens,
} from "./stubs/fetch.js";

/**
 * The assertions that must fail at **compile** time, not at runtime.
 *
 * @remarks
 * Each `@ts-expect-error` is the assertion: `tsc` fails if the line it precedes turns out to be
 * *legal*, so `pnpm typecheck` is what runs this suite. The runtime bodies exist so the file is also a
 * readable list of what the types forbid.
 *
 * The directive applies to the **following line**, so each call is kept short enough that the
 * formatter cannot wrap it out from under the directive.
 */

describe("the capability tokens are reachable from a create and from nowhere else", () => {
  it("is a compile error on a booking read from getBooking", () => {
    const read: Booking = booking() as Booking;
    // @ts-expect-error — no read returns the tokens. Rendering one from a GET is the documented
    // silent failure: it type-checks and produces a link with `undefined` in it.
    const wrong = read.management_token;
    expect(wrong).toBeUndefined();
  });

  it("is a compile error on the public read too, windows or not", () => {
    const read = { ...publicBooking(), windows: {} } as PublicBookingWithWindows;
    // @ts-expect-error — the management token opened this read; it is not in the answer.
    const wrong = read.confirmation_token;
    expect(wrong).toBeUndefined();
  });

  it("is a compile error on a list row, which carries no customer either", () => {
    const row = booking() as BookingListRow;
    // @ts-expect-error — GET /v1/bookings rows carry no customer object at all.
    const wrong = row.customer;
    expect(wrong).toBeDefined();
  });

  it("type-checks on a fresh create, once replayed is narrowed to false", async () => {
    const client = tenantClient(fetchStub([jsonResponse({ ...booking(), ...tokens }, 201)]));
    const result: CreateBookingResult = await client.createBooking(createBody(), key());
    // @ts-expect-error — before narrowing, a replay may have carried no tokens.
    const unchecked: string = result.booking.management_token;
    expect(unchecked).toBe(tokens.management_token);

    if (result.replayed) throw new Error("expected a fresh create");
    const checked: string = result.booking.management_token;
    expect(checked).toBe(tokens.management_token);
  });
});

describe("a create cannot happen without an idempotency key", () => {
  const publicOne = publicClient(fetchStub([jsonResponse({ ...publicBooking(), ...tokens }, 201)]));
  const tenantOne = tenantClient(fetchStub([jsonResponse({ ...booking(), ...tokens }, 201)]));
  const body = createBody();

  it("has no public createBooking overload without one", () => {
    // @ts-expect-error — the key is the second argument and there is no overload lacking it.
    const call = () => publicOne.createBooking(body);
    expect(typeof call).toBe("function");
  });

  it("has no tenant createBooking overload without one", () => {
    // @ts-expect-error — same rule on the tenant tier.
    const call = () => tenantOne.createBooking(body);
    expect(typeof call).toBe("function");
  });

  it("has no reschedule overload without one, because a reschedule is a create", () => {
    // @ts-expect-error — the new booking is created; the key is required.
    const call = () => tenantOne.rescheduleBooking("019e", { starts_at: "2026-09-15T09:00:00Z" });
    expect(typeof call).toBe("function");
  });

  it("rejects a raw string as a key", () => {
    // @ts-expect-error — IdempotencyKey is branded: it must go through idempotencyKey().
    const call = () => tenantOne.createBooking(body, "order-1");
    expect(typeof call).toBe("function");
  });

  it("accepts a validated key", () => {
    expect(typeof key()).toBe("string");
  });
});

describe("the enums stay open", () => {
  it("accepts a booking status this SDK has never seen", () => {
    // The knowledge base's rule: treat an unknown member as unknown, not as an error. A client that
    // throws on one breaks on a Tuesday for no reason.
    const known: BookingStatus = "confirmed";
    const unknown: BookingStatus = "waitlisted";
    expect([known, unknown]).toEqual(["confirmed", "waitlisted"]);
  });

  it("accepts a cancellation reason this SDK has never seen, and null", () => {
    const reasons: CancellationReason[] = ["customer", "system_pending_expired", "merged", null];
    expect(reasons).toHaveLength(4);
  });
});

describe("a list carries no total", () => {
  it("is a compile error to read one", () => {
    const page: CursorPage<BookingListRow> = { items: [], nextCursor: null };
    // @ts-expect-error — keyset pagination has no total. Math.ceil(total / limit) would be NaN.
    const pages = page.total;
    expect(pages).toBeUndefined();
  });
});

describe("the public client has no booking listing", () => {
  it("is a compile error to call one", () => {
    const client = publicClient(fetchStub());
    // @ts-expect-error — a token grants access to ONE booking. There is no public listing.
    const call = () => client.listBookings();
    expect(typeof call).toBe("function");
  });
});

describe("the hand-written types still match the generated contract", () => {
  it("accepts a generated BookingWithTokens as a CreatedPublicBooking", () => {
    // The public create's 201 is what the contract calls BookingWithTokens. The SDK's type widens two
    // enums and moves the tokens onto their own interface; this is what keeps the two in step.
    const wire = { ...publicBooking(), ...tokens } as components["schemas"]["BookingWithTokens"];
    const sdk: CreatedPublicBooking = wire;
    expect(sdk.management_token).toBe(tokens.management_token);
  });

  it("accepts a generated Booking as the SDK's Booking", () => {
    const wire = booking() as components["schemas"]["Booking"];
    const sdk: Booking = wire;
    expect(sdk.customer.email).toBe("anna@example.com");
  });
});

/** A validated key, built where it is used so the type-only cases above stay one line each. */
function key() {
  return idempotencyKey("order-8842-attempt-1");
}
