import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { BookingApiError } from "../src/errors.js";
import { bookingTokenHeader } from "../src/public/bookings.js";
import {
  createBody,
  fetchStub,
  hold,
  ids,
  jsonResponse,
  listResponse,
  noContent,
  problemResponse,
  publicBooking,
  publicClient,
  testBaseUrl,
  testPublishableKey,
  tokens,
} from "./stubs/fetch.js";

/**
 * The twelve `/v1/public/*` endpoints, driven through the real transport.
 *
 * @remarks
 * What matters here is what reaches the wire: the path, the method, which header a capability token
 * travels in, and that the `Idempotency-Key` is on every create. And what does *not* reach it — no
 * `mode`, no invented default.
 */

const key = idempotencyKey("booking-form-8842-attempt-1");

describe("the catalogue", () => {
  it("lists locations as bare rows, because the endpoint takes no pagination parameter", async () => {
    const stub = fetchStub([listResponse([{ public_id: ids.location, name: "Belváros" }])]);
    const locations = await publicClient(stub).listLocations();

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/locations`);
    expect(stub.lastMethod()).toBe("GET");
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testPublishableKey}`);
    expect(locations).toEqual([{ public_id: ids.location, name: "Belváros" }]);
  });

  it("lists a location's services", async () => {
    const stub = fetchStub([listResponse([{ public_id: ids.service, price_minor: "4500" }])]);
    const services = await publicClient(stub).listServices(ids.location);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/locations/${ids.location}/services`);
    // The amount stays the string it arrived as. 4500 Ft — HUF is zero-decimal.
    expect(services[0]?.price_minor).toBe("4500");
  });

  it("lists a service's employees", async () => {
    const stub = fetchStub([listResponse([{ public_id: ids.employee, name: "Béla" }])]);
    await publicClient(stub).listEmployees(ids.service);
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/services/${ids.service}/employees`);
  });

  it("encodes a path segment", async () => {
    const stub = fetchStub([listResponse([])]);
    await publicClient(stub).listServices("a/b");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/locations/a%2Fb/services`);
  });
});

describe("availability", () => {
  it("sends the window and the service as query parameters", async () => {
    const stub = fetchStub([jsonResponse({ slots: [] })]);
    await publicClient(stub).getAvailability({
      service_id: ids.service,
      from: "2026-09-14",
      until: "2026-09-15",
    });

    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/public/availability?service_id=${ids.service}&from=2026-09-14&until=2026-09-15`,
    );
  });

  it("narrows to one employee only when asked", async () => {
    const stub = fetchStub([jsonResponse({ slots: [] })]);
    await publicClient(stub).getAvailability({
      service_id: ids.service,
      from: "2026-09-14",
      until: "2026-09-15",
      employee_id: ids.employee,
    });
    expect(stub.lastUrl()).toContain(`&employee_id=${ids.employee}`);
  });

  it("reads the per-day summary from its own path", async () => {
    const stub = fetchStub([jsonResponse({ days: [] })]);
    await publicClient(stub).getAvailabilityDays({
      service_id: ids.service,
      from: "2026-09-01",
      until: "2026-10-01",
    });
    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/public/availability/days?service_id=${ids.service}&from=2026-09-01&until=2026-10-01`,
    );
  });

  it("surfaces an unparseable window as a 400 with its field errors", async () => {
    const stub = fetchStub([
      problemResponse(400, "validation", {
        errors: [{ pointer: "#/query/from", detail: "Invalid date" }],
      }),
    ]);
    await expect(
      publicClient(stub).getAvailability({
        service_id: ids.service,
        from: "next-tuesday",
        until: "2026-09-15",
      }),
    ).rejects.toMatchObject({ status: 400, type: "validation", retryable: false });
  });
});

describe("holds", () => {
  const holdBody = {
    service_id: ids.service,
    employee_id: ids.employee,
    starts_at: "2026-09-14T08:00:00Z",
    nonce: "a-random-string-you-generated",
  };

  it("posts the hold body to the public path", async () => {
    const stub = fetchStub([jsonResponse(hold(), 201)]);
    const created = await publicClient(stub).createHold(holdBody);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/holds`);
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastBody()).toEqual(holdBody);
    expect(created.hold_id).toBe(ids.hold);
  });

  it("releases with the nonce as a query parameter and answers nothing on a 204", async () => {
    const stub = fetchStub([noContent()]);
    const answer = await publicClient(stub).releaseHold(ids.hold, "a-random-string-you-generated");

    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/public/holds/${ids.hold}?nonce=a-random-string-you-generated`,
    );
    expect(stub.lastMethod()).toBe("DELETE");
    expect(answer).toBeUndefined();
  });

  it("loses a slot cleanly as a non-retryable 409 slot_taken", async () => {
    const stub = fetchStub([problemResponse(409, "conflict", { code: "slot_taken" })]);
    await expect(publicClient(stub).createHold(holdBody)).rejects.toMatchObject({
      code: "slot_taken",
      retryable: false,
    });
  });
});

describe("createBooking", () => {
  it("posts the body with the idempotency key as a header", async () => {
    const stub = fetchStub([jsonResponse({ ...publicBooking(), ...tokens }, 201)]);
    await publicClient(stub).createBooking(createBody(), key);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/bookings`);
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastHeaders()["idempotency-key"]).toBe("booking-form-8842-attempt-1");
    expect(stub.lastBody()).toEqual(createBody());
  });

  it("carries both tokens on a 201, discriminated as not replayed", async () => {
    const stub = fetchStub([jsonResponse({ ...publicBooking(), ...tokens }, 201)]);
    const result = await publicClient(stub).createBooking(createBody(), key);

    expect(result.replayed).toBe(false);
    if (result.replayed) throw new Error("expected a fresh create");
    expect(result.booking.management_token).toBe(tokens.management_token);
    expect(result.booking.confirmation_token).toBe(tokens.confirmation_token);
  });

  it("reports a replay from the 200 and from the header alike", async () => {
    const byStatus = fetchStub([jsonResponse({ ...publicBooking(), ...tokens }, 200)]);
    expect((await publicClient(byStatus).createBooking(createBody(), key)).replayed).toBe(true);

    // A proxy that rewrites the status cannot hide a replay.
    const byHeader = fetchStub([
      jsonResponse({ ...publicBooking(), ...tokens }, 201, { "idempotent-replay": "true" }),
    ]);
    expect((await publicClient(byHeader).createBooking(createBody(), key)).replayed).toBe(true);
  });

  it("tolerates a replay of a recovered create, which carries no tokens", async () => {
    // The tokens were minted by the attempt that died and never reached anyone. The replay arm
    // types them optional, so the caller has to look before sending a link.
    const stub = fetchStub([jsonResponse(publicBooking(), 200)]);
    const result = await publicClient(stub).createBooking(createBody(), key);

    expect(result.replayed).toBe(true);
    expect(result.booking.management_token).toBeUndefined();
  });

  it("sends the body as given, arrays in order, with no defaults added", async () => {
    // The idempotency hash covers the body: a tidy-up here would turn a replay into a mismatch.
    const stub = fetchStub([jsonResponse({ ...publicBooking(), ...tokens }, 201)]);
    await publicClient(stub).createBooking(
      { ...createBody(), metadata: { tags: "c,a,b", n: 2 } },
      key,
    );
    expect(stub.lastBodyText()).toContain('"tags":"c,a,b","n":2');
    expect(stub.lastBody()).not.toHaveProperty("hold_id");
    expect(stub.lastBody()).not.toHaveProperty("pending_reason");
  });

  it("passes a caller's init through, and sets no fetch mode", async () => {
    const controller = new AbortController();
    const stub = fetchStub([jsonResponse({ ...publicBooking(), ...tokens }, 201)]);
    await publicClient(stub).createBooking(createBody(), key, {
      init: { signal: controller.signal },
    });

    expect(stub.calls.at(-1)?.init.signal).toBe(controller.signal);
    expect(stub.calls.at(-1)?.init.mode).toBeUndefined();
  });

  it("surfaces the opt-in gate as 422 public_create_disabled, not retryable", async () => {
    const stub = fetchStub([problemResponse(422, "conflict", { code: "public_create_disabled" })]);
    await expect(publicClient(stub).createBooking(createBody(), key)).rejects.toMatchObject({
      status: 422,
      code: "public_create_disabled",
      retryable: false,
    });
  });

  it("marks an in-flight 409 retryable with the same key", async () => {
    const stub = fetchStub([problemResponse(409, "conflict", { code: "idempotency_in_flight" })]);
    const caught = await publicClient(stub)
      .createBooking(createBody(), key)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(BookingApiError);
    expect(caught).toMatchObject({ code: "idempotency_in_flight", retryable: true });
    expect((caught as BookingApiError).message).toMatch(/SAME key/);
  });
});

describe("the capability-token operations", () => {
  it("reads a booking with the management token in X-Booking-Token", async () => {
    const stub = fetchStub([
      jsonResponse({ ...publicBooking(), windows: { cancel_until: null, reschedule_until: null } }),
    ]);
    const read = await publicClient(stub).getBooking(ids.booking, tokens.management_token);

    expect(bookingTokenHeader).toBe("X-Booking-Token");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/bookings/${ids.booking}`);
    expect(stub.lastHeaders()["x-booking-token"]).toBe(tokens.management_token);
    // A token never travels in the URL.
    expect(stub.lastUrl()).not.toContain(tokens.management_token);
    expect(read.windows.cancel_until).toBeNull();
  });

  it("confirms with the token in the body, never in the URL or a header", async () => {
    const stub = fetchStub([jsonResponse(publicBooking({ status: "confirmed" }))]);
    await publicClient(stub).confirmBooking(ids.booking, tokens.confirmation_token);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/bookings/${ids.booking}/confirm`);
    expect(stub.lastBody()).toEqual({ token: tokens.confirmation_token });
    expect(stub.lastHeaders()["x-booking-token"]).toBeUndefined();
  });

  it("treats a second confirm as the success it is", async () => {
    const stub = fetchStub([problemResponse(422, "conflict", { code: "already_confirmed" })]);
    const caught = await publicClient(stub)
      .confirmBooking(ids.booking, tokens.confirmation_token)
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({ code: "already_confirmed", retryable: false });
    expect((caught as BookingApiError).advice).toMatch(/Treat this as success/);
  });

  it("surfaces the wrong confirmation token as the one code that rides a 403", async () => {
    const stub = fetchStub([
      problemResponse(403, "forbidden", { code: "invalid_confirmation_token" }),
    ]);
    await expect(
      publicClient(stub).confirmBooking(ids.booking, "stale-token"),
    ).rejects.toMatchObject({ status: 403, code: "invalid_confirmation_token" });
  });

  it("reschedules with the token header AND an idempotency key, answering the new booking", async () => {
    const moved = publicBooking({
      public_id: "019e5c31-0000-7000-8000-000000000107",
      rescheduled_from_id: ids.booking,
    });
    const stub = fetchStub([jsonResponse(moved, 201)]);
    const result = await publicClient(stub).rescheduleBooking(
      ids.booking,
      tokens.management_token,
      { starts_at: "2026-09-15T08:00:00Z" },
      key,
    );

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/bookings/${ids.booking}/reschedule`);
    expect(stub.lastHeaders()["x-booking-token"]).toBe(tokens.management_token);
    expect(stub.lastHeaders()["idempotency-key"]).toBe("booking-form-8842-attempt-1");
    expect(stub.lastBody()).toEqual({ starts_at: "2026-09-15T08:00:00Z" });
    expect(result.replayed).toBe(false);
    // A new public_id, pointing back at the old booking.
    expect(result.booking.public_id).not.toBe(ids.booking);
    expect(result.booking.rescheduled_from_id).toBe(ids.booking);
  });

  it("cancels with the token header and an optional reason", async () => {
    const stub = fetchStub([
      jsonResponse(publicBooking({ status: "canceled", cancellation_reason: "customer" })),
    ]);
    const canceled = await publicClient(stub).cancelBooking(ids.booking, tokens.management_token, {
      reason: "Something came up",
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/bookings/${ids.booking}/cancel`);
    expect(stub.lastHeaders()["x-booking-token"]).toBe(tokens.management_token);
    expect(stub.lastBody()).toEqual({ reason: "Something came up" });
    expect(canceled.cancellation_reason).toBe("customer");
  });

  it("cancels with an empty body when no reason is given", async () => {
    const stub = fetchStub([jsonResponse(publicBooking({ status: "canceled" }))]);
    await publicClient(stub).cancelBooking(ids.booking, tokens.management_token);
    expect(stub.lastBody()).toEqual({});
  });

  it("throws on a 404 rather than answering null", async () => {
    // A booking whose token you hold exists. "Not found" is a bug, not an empty state.
    const stub = fetchStub([problemResponse(404, "not-found")]);
    await expect(
      publicClient(stub).getBooking(ids.booking, tokens.management_token),
    ).rejects.toBeInstanceOf(BookingApiError);
  });
});
