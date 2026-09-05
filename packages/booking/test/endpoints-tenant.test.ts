import { collectAllCursor, idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import type { BookingClient } from "../src/client.js";
import { BookingApiError } from "../src/errors.js";
import {
  booking,
  createBody,
  fetchStub,
  hold,
  ids,
  jsonResponse,
  listResponse,
  noContent,
  problemResponse,
  tenantClient,
  testBaseUrl,
  testSecretKey,
  tokens,
  webhookEndpoint,
} from "./stubs/fetch.js";

/**
 * The tenant tier, driven through the real transport.
 *
 * @remarks
 * Fifty-five methods. The path-and-method table covers every one of them, so a route that drifts
 * fails here by name; the cases below it cover the behaviour that a path alone cannot show — which
 * lists page, which reads answer `null`, where the idempotency key goes.
 */

const key = idempotencyKey("order-8842-attempt-1");
const base = testBaseUrl;

/** Every method, the call that exercises it, and the request it must produce. */
const routes: readonly [
  name: keyof BookingClient,
  call: (client: BookingClient) => Promise<unknown>,
  method: string,
  path: string,
][] = [
  ["getMe", (c) => c.getMe(), "GET", "/v1/me"],
  ["getSettings", (c) => c.getSettings(), "GET", "/v1/settings"],
  ["listLocations", (c) => c.listLocations(), "GET", "/v1/locations"],
  ["createLocation", (c) => c.createLocation({ name: "B", slug: "b" }), "POST", "/v1/locations"],
  ["getLocation", (c) => c.getLocation(ids.location), "GET", `/v1/locations/${ids.location}`],
  [
    "updateLocation",
    (c) => c.updateLocation(ids.location, { name: "C" }),
    "PATCH",
    `/v1/locations/${ids.location}`,
  ],
  [
    "listServices",
    (c) => c.listServices(ids.location),
    "GET",
    `/v1/locations/${ids.location}/services`,
  ],
  [
    "createService",
    (c) => c.createService(ids.location, { name: "H", slug: "h", duration_minutes: 45 }),
    "POST",
    `/v1/locations/${ids.location}/services`,
  ],
  ["getService", (c) => c.getService(ids.service), "GET", `/v1/services/${ids.service}`],
  [
    "updateService",
    (c) => c.updateService(ids.service, { price_minor: "5000" }),
    "PATCH",
    `/v1/services/${ids.service}`,
  ],
  ["listEmployees", (c) => c.listEmployees(), "GET", "/v1/employees"],
  [
    "createEmployee",
    (c) => c.createEmployee({ name: "Béla", email: "bela@example.com" }),
    "POST",
    "/v1/employees",
  ],
  ["getEmployee", (c) => c.getEmployee(ids.employee), "GET", `/v1/employees/${ids.employee}`],
  [
    "updateEmployee",
    (c) => c.updateEmployee(ids.employee, { active: false }),
    "PATCH",
    `/v1/employees/${ids.employee}`,
  ],
  [
    "listEmployeeServices",
    (c) => c.listEmployeeServices(ids.employee),
    "GET",
    `/v1/employees/${ids.employee}/services`,
  ],
  [
    "assignService",
    (c) => c.assignService(ids.employee, ids.service),
    "PUT",
    `/v1/employees/${ids.employee}/services/${ids.service}`,
  ],
  [
    "unassignService",
    (c) => c.unassignService(ids.employee, ids.service),
    "DELETE",
    `/v1/employees/${ids.employee}/services/${ids.service}`,
  ],
  [
    "listEmployeeLocations",
    (c) => c.listEmployeeLocations(ids.employee),
    "GET",
    `/v1/employees/${ids.employee}/locations`,
  ],
  [
    "assignLocation",
    (c) => c.assignLocation(ids.employee, ids.location),
    "PUT",
    `/v1/employees/${ids.employee}/locations/${ids.location}`,
  ],
  [
    "unassignLocation",
    (c) => c.unassignLocation(ids.employee, ids.location),
    "DELETE",
    `/v1/employees/${ids.employee}/locations/${ids.location}`,
  ],
  [
    "authorizeCalendar",
    (c) => c.authorizeCalendar(ids.employee, { return_url: "https://acme.example.com/settings" }),
    "POST",
    `/v1/employees/${ids.employee}/calendar/authorize`,
  ],
  [
    "getCalendarConnection",
    (c) => c.getCalendarConnection(ids.employee),
    "GET",
    `/v1/employees/${ids.employee}/calendar`,
  ],
  [
    "disconnectCalendar",
    (c) => c.disconnectCalendar(ids.employee),
    "DELETE",
    `/v1/employees/${ids.employee}/calendar`,
  ],
  [
    "listRules",
    (c) => c.listRules(ids.employee),
    "GET",
    `/v1/availability/rules?employee_id=${ids.employee}`,
  ],
  [
    "createRule",
    (c) =>
      c.createRule({
        employee_id: ids.employee,
        location_id: ids.location,
        day_of_week: 0,
        starts_time: "09:00",
        ends_time: "17:00",
      }),
    "POST",
    "/v1/availability/rules",
  ],
  [
    "updateRule",
    (c) => c.updateRule(ids.rule, { ends_time: "18:00" }),
    "PATCH",
    `/v1/availability/rules/${ids.rule}`,
  ],
  ["deleteRule", (c) => c.deleteRule(ids.rule), "DELETE", `/v1/availability/rules/${ids.rule}`],
  [
    "listExceptions",
    (c) => c.listExceptions(ids.employee),
    "GET",
    `/v1/availability/exceptions?employee_id=${ids.employee}`,
  ],
  [
    "createException",
    (c) => c.createException({ employee_id: ids.employee, date: "2026-12-24", kind: "closed" }),
    "POST",
    "/v1/availability/exceptions",
  ],
  [
    "deleteException",
    (c) => c.deleteException(ids.exception),
    "DELETE",
    `/v1/availability/exceptions/${ids.exception}`,
  ],
  [
    "createHold",
    (c) =>
      c.createHold({
        service_id: ids.service,
        employee_id: ids.employee,
        starts_at: "2026-09-14T08:00:00Z",
        nonce: "server-nonce",
      }),
    "POST",
    "/v1/holds",
  ],
  [
    "releaseHold",
    (c) => c.releaseHold(ids.hold, "server-nonce"),
    "DELETE",
    `/v1/holds/${ids.hold}?nonce=server-nonce`,
  ],
  ["listBookings", (c) => c.listBookings(), "GET", "/v1/bookings"],
  ["createBooking", (c) => c.createBooking(createBody(), key), "POST", "/v1/bookings"],
  ["getBooking", (c) => c.getBooking(ids.booking), "GET", `/v1/bookings/${ids.booking}`],
  [
    "confirmBooking",
    (c) => c.confirmBooking(ids.booking),
    "POST",
    `/v1/bookings/${ids.booking}/confirm`,
  ],
  [
    "completeBooking",
    (c) => c.completeBooking(ids.booking),
    "POST",
    `/v1/bookings/${ids.booking}/complete`,
  ],
  ["markNoShow", (c) => c.markNoShow(ids.booking), "POST", `/v1/bookings/${ids.booking}/no-show`],
  [
    "rescheduleBooking",
    (c) => c.rescheduleBooking(ids.booking, { starts_at: "2026-09-15T09:00:00Z" }, key),
    "POST",
    `/v1/bookings/${ids.booking}/reschedule`,
  ],
  [
    "cancelBooking",
    (c) => c.cancelBooking(ids.booking, { reason: "Staff illness" }),
    "POST",
    `/v1/bookings/${ids.booking}/cancel`,
  ],
  [
    "mintConfirmationToken",
    (c) => c.mintConfirmationToken(ids.booking),
    "POST",
    `/v1/bookings/${ids.booking}/confirmation-token`,
  ],
  [
    "mintManagementToken",
    (c) => c.mintManagementToken(ids.booking),
    "POST",
    `/v1/bookings/${ids.booking}/management-token`,
  ],
  ["listEventTypes", (c) => c.listEventTypes(), "GET", "/v1/event-types"],
  ["listWebhookEndpoints", (c) => c.listWebhookEndpoints(), "GET", "/v1/webhook-endpoints"],
  [
    "createWebhookEndpoint",
    (c) => c.createWebhookEndpoint({ url: "https://acme.example.com/hooks/booking" }),
    "POST",
    "/v1/webhook-endpoints",
  ],
  [
    "getWebhookEndpoint",
    (c) => c.getWebhookEndpoint(ids.endpoint),
    "GET",
    `/v1/webhook-endpoints/${ids.endpoint}`,
  ],
  [
    "updateWebhookEndpoint",
    (c) => c.updateWebhookEndpoint(ids.endpoint, { subscribed_events: null }),
    "PATCH",
    `/v1/webhook-endpoints/${ids.endpoint}`,
  ],
  [
    "deleteWebhookEndpoint",
    (c) => c.deleteWebhookEndpoint(ids.endpoint),
    "DELETE",
    `/v1/webhook-endpoints/${ids.endpoint}`,
  ],
  [
    "enableWebhookEndpoint",
    (c) => c.enableWebhookEndpoint(ids.endpoint),
    "POST",
    `/v1/webhook-endpoints/${ids.endpoint}/enable`,
  ],
  [
    "disableWebhookEndpoint",
    (c) => c.disableWebhookEndpoint(ids.endpoint),
    "POST",
    `/v1/webhook-endpoints/${ids.endpoint}/disable`,
  ],
  [
    "rotateWebhookSecret",
    (c) => c.rotateWebhookSecret(ids.endpoint),
    "POST",
    `/v1/webhook-endpoints/${ids.endpoint}/rotate-secret`,
  ],
  [
    "testWebhookEndpoint",
    (c) => c.testWebhookEndpoint(ids.endpoint),
    "POST",
    `/v1/webhook-endpoints/${ids.endpoint}/test`,
  ],
  ["listWebhookEvents", (c) => c.listWebhookEvents(), "GET", "/v1/webhook-events"],
  ["listWebhookDeliveries", (c) => c.listWebhookDeliveries(), "GET", "/v1/webhook-deliveries"],
  [
    "redeliverWebhook",
    (c) => c.redeliverWebhook(ids.delivery),
    "POST",
    `/v1/webhook-deliveries/${ids.delivery}/redeliver`,
  ],
];

describe("every tenant method reaches its documented route", () => {
  it("covers the whole client, so a method added without a row fails here", () => {
    const client = tenantClient(fetchStub());
    expect(routes.map(([name]) => name).sort()).toEqual(Object.keys(client).sort());
  });

  it.each(routes)("%s → %s %s", async (_name, invoke, method, path) => {
    // One stub answers every shape: a 204 for the bodiless ones, an envelope for the lists, a
    // resource for the rest. What is asserted is the request, not the parse.
    const stub = fetchStub([
      method === "DELETE" || method === "PUT" ? noContent() : listResponse([]),
    ]);
    await invoke(tenantClient(stub));

    expect(stub.lastMethod()).toBe(method);
    expect(stub.lastUrl()).toBe(`${base}${path}`);
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testSecretKey}`);
    expect(stub.calls.at(-1)?.init.mode).toBeUndefined();
  });

  it("names no admin, provider, cron or key-management route", () => {
    for (const [, , , path] of routes) {
      expect(path).not.toMatch(/\/v1\/admin|\/v1\/providers|\/api\/cron|\/v1\/keys/);
    }
  });
});

describe("the keyset lists", () => {
  it("answer items and nextCursor, and pass the cursor back verbatim", async () => {
    const stub = fetchStub([
      listResponse([booking()], "eyJjcmVhdGVkX2F0Ijoi"),
      listResponse([booking({ public_id: "second" })], null),
    ]);
    const rows = await collectAllCursor(({ limit, cursor }) =>
      tenantClient(stub).listBookings({ limit, cursor, status: "confirmed" }),
    );

    expect(rows).toHaveLength(2);
    expect(stub.calls[0]?.url).toBe(`${base}/v1/bookings?limit=50&status=confirmed`);
    expect(stub.calls[1]?.url).toBe(
      `${base}/v1/bookings?limit=50&cursor=eyJjcmVhdGVkX2F0Ijoi&status=confirmed`,
    );
  });

  it("carry no total, because keyset pagination has none", async () => {
    const page = await tenantClient(fetchStub([listResponse([])])).listLocations();
    expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    expect(page.nextCursor).toBeNull();
  });

  it("send every documented filter, and nothing for an omitted one", async () => {
    const stub = fetchStub([listResponse([])]);
    const client = tenantClient(stub);

    await client.listLocations({ active: true, limit: 10 });
    expect(stub.lastUrl()).toBe(`${base}/v1/locations?limit=10&active=true`);

    await client.listBookings({
      from: "2026-09-01T00:00:00Z",
      until: "2026-10-01T00:00:00Z",
    });
    expect(stub.lastUrl()).toBe(
      `${base}/v1/bookings?from=2026-09-01T00%3A00%3A00Z&until=2026-10-01T00%3A00%3A00Z`,
    );

    await client.listWebhookEndpoints({ enabled: false });
    expect(stub.lastUrl()).toBe(`${base}/v1/webhook-endpoints?enabled=false`);

    await client.listWebhookEvents({ event_type: "booking.confirmed", limit: 50 });
    expect(stub.lastUrl()).toBe(`${base}/v1/webhook-events?limit=50&event_type=booking.confirmed`);

    await client.listWebhookDeliveries({ status: "dead_lettered", endpoint: ids.endpoint });
    expect(stub.lastUrl()).toBe(
      `${base}/v1/webhook-deliveries?status=dead_lettered&endpoint=${ids.endpoint}`,
    );
  });

  it("answer the unpaginated ones as bare rows", async () => {
    const client = tenantClient(fetchStub([listResponse([{ event_type: "booking.created" }])]));
    expect(await client.listEventTypes()).toEqual([{ event_type: "booking.created" }]);
  });
});

describe("createBooking", () => {
  it("posts the body with the idempotency key as a header, and discriminates a fresh create", async () => {
    const stub = fetchStub([jsonResponse({ ...booking(), ...tokens }, 201)]);
    const result = await tenantClient(stub).createBooking(
      { ...createBody(), pending_reason: "awaiting_payment", metadata: { campaign: "x" } },
      key,
    );

    expect(stub.lastHeaders()["idempotency-key"]).toBe("order-8842-attempt-1");
    expect(stub.lastBody()).toMatchObject({ pending_reason: "awaiting_payment" });
    expect(result.replayed).toBe(false);
    if (result.replayed) throw new Error("expected a fresh create");
    expect(result.booking.management_token).toBe(tokens.management_token);
    expect(result.booking.customer.email).toBe("anna@example.com");
  });

  it("reports a 200 as a replay, tokens optional", async () => {
    const stub = fetchStub([jsonResponse(booking(), 200, { "idempotent-replay": "true" })]);
    const result = await tenantClient(stub).createBooking(createBody(), key);
    expect(result.replayed).toBe(true);
    expect(result.booking.confirmation_token).toBeUndefined();
  });

  it("surfaces the freebusy pre-check's 502 as retryable, with the provider's message attached", async () => {
    // Nothing was written — the pre-check runs after the local guards and outside the transaction.
    const stub = fetchStub([
      problemResponse(502, "internal", { provider_error: "Google: deadline exceeded" }),
    ]);
    const caught = await tenantClient(stub)
      .createBooking(createBody(), key)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(BookingApiError);
    expect(caught).toMatchObject({ status: 502, type: "internal", retryable: true });
    expect((caught as BookingApiError).providerError).toBe("Google: deadline exceeded");
  });
});

describe("the lifecycle transitions", () => {
  it("send no body on confirm, complete and no-show", async () => {
    const stub = fetchStub([jsonResponse(booking({ status: "confirmed" }))]);
    const client = tenantClient(stub);

    await client.confirmBooking(ids.booking);
    expect(stub.calls.at(-1)?.init.body).toBeUndefined();
    expect(stub.lastHeaders()["content-type"]).toBeUndefined();

    await client.completeBooking(ids.booking);
    await client.markNoShow(ids.booking);
    expect(stub.calls.every((call) => call.init.body === undefined)).toBe(true);
  });

  it("refuse to leave a terminal status, and say a retry is hopeless", async () => {
    const stub = fetchStub([problemResponse(422, "conflict", { code: "booking_terminal" })]);
    await expect(tenantClient(stub).completeBooking(ids.booking)).rejects.toMatchObject({
      code: "booking_terminal",
      retryable: false,
    });
  });

  it("reschedule with an idempotency key and answer the new booking", async () => {
    const stub = fetchStub([jsonResponse(booking({ public_id: "new" }), 201)]);
    const result = await tenantClient(stub).rescheduleBooking(
      ids.booking,
      { starts_at: "2026-09-15T09:00:00Z", employee_id: ids.employee },
      key,
    );

    expect(stub.lastHeaders()["idempotency-key"]).toBe("order-8842-attempt-1");
    expect(stub.lastBody()).toEqual({
      starts_at: "2026-09-15T09:00:00Z",
      employee_id: ids.employee,
    });
    expect(result).toEqual({
      booking: expect.objectContaining({ public_id: "new" }),
      replayed: false,
    });
  });

  it("cancel with an empty body when no reason is given", async () => {
    const stub = fetchStub([jsonResponse(booking({ status: "canceled" }))]);
    await tenantClient(stub).cancelBooking(ids.booking);
    expect(stub.lastBody()).toEqual({});
  });

  it("re-mint each token from its own route", async () => {
    const stub = fetchStub([jsonResponse({ confirmation_token: "fresh" })]);
    const minted = await tenantClient(stub).mintConfirmationToken(ids.booking);
    expect(minted.confirmation_token).toBe("fresh");
    expect(stub.calls.at(-1)?.init.body).toBeUndefined();
  });
});

describe("getBooking", () => {
  it("throws on a 404 rather than answering null", async () => {
    // Another tenant's id reads as a 404 too, so `null` here would hide a wrong-key deployment.
    const stub = fetchStub([problemResponse(404, "not-found")]);
    await expect(tenantClient(stub).getBooking(ids.booking)).rejects.toMatchObject({
      status: 404,
      type: "not-found",
    });
  });
});

describe("the calendar connection", () => {
  it("answers null on a 404, the one documented normal absence", async () => {
    const stub = fetchStub([problemResponse(404, "not-found")]);
    expect(await tenantClient(stub).getCalendarConnection(ids.employee)).toBeNull();
  });

  it("still throws for any other status", async () => {
    const stub = fetchStub([problemResponse(401, "unauthorized")]);
    await expect(tenantClient(stub).getCalendarConnection(ids.employee)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("requires a return_url body on authorize", async () => {
    const stub = fetchStub([
      jsonResponse({ authorize_url: "https://accounts.example.com/o/auth" }),
    ]);
    const answer = await tenantClient(stub).authorizeCalendar(ids.employee, {
      return_url: "https://acme.example.com/settings/calendar",
    });
    expect(stub.lastBody()).toEqual({ return_url: "https://acme.example.com/settings/calendar" });
    expect(answer.authorize_url).toMatch(/^https:/);
  });
});

describe("the webhook surface", () => {
  it("returns the secret on create and on rotate, and nowhere else", async () => {
    const stub = fetchStub([
      jsonResponse({ ...webhookEndpoint(), secret: "whsec_EXAMPLE_MINTED_SECRET_000000" }, 201),
      jsonResponse({ ...webhookEndpoint(), secret: "whsec_EXAMPLE_ROTATED_SECRET_00000" }),
      jsonResponse(webhookEndpoint()),
    ]);
    const client = tenantClient(stub);

    const created = await client.createWebhookEndpoint({
      url: "https://acme.example.com/hooks/booking",
      subscribed_events: ["booking.confirmed", "booking.canceled"],
      include_customer: false,
    });
    expect(created.secret).toMatch(/^whsec_/);
    expect(stub.lastBody()).toEqual({
      url: "https://acme.example.com/hooks/booking",
      subscribed_events: ["booking.confirmed", "booking.canceled"],
      include_customer: false,
    });

    const rotated = await client.rotateWebhookSecret(ids.endpoint);
    expect(rotated.secret).toMatch(/^whsec_/);

    const read = await client.getWebhookEndpoint(ids.endpoint);
    expect(read).not.toHaveProperty("secret");
  });

  it("sends no body on disable — the contract declares none", async () => {
    const stub = fetchStub([jsonResponse(webhookEndpoint({ enabled: false }))]);
    await tenantClient(stub).disableWebhookEndpoint(ids.endpoint);
    expect(stub.calls.at(-1)?.init.body).toBeUndefined();
  });

  it("surfaces the endpoint cap as a non-retryable 409", async () => {
    const stub = fetchStub([problemResponse(409, "conflict", { code: "endpoint_limit_reached" })]);
    await expect(
      tenantClient(stub).createWebhookEndpoint({ url: "https://acme.example.com/hooks/booking" }),
    ).rejects.toMatchObject({ code: "endpoint_limit_reached", retryable: false });
  });

  it("reads the redelivery reset off the 202", async () => {
    const stub = fetchStub([
      jsonResponse({ public_id: ids.delivery, status: "pending", attempt: 0, error: null }, 202),
    ]);
    const row = await tenantClient(stub).redeliverWebhook(ids.delivery);
    expect(row).toMatchObject({ status: "pending", attempt: 0, error: null });
  });
});

describe("holds on the tenant tier", () => {
  it("use the tenant prefix, not the public one", async () => {
    const stub = fetchStub([jsonResponse(hold(), 201)]);
    await tenantClient(stub).createHold({
      service_id: ids.service,
      employee_id: ids.employee,
      starts_at: "2026-09-14T08:00:00Z",
      nonce: "server-nonce",
    });
    expect(stub.lastUrl()).toBe(`${base}/v1/holds`);
  });
});
