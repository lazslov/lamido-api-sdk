import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBookingClient,
  createBookingPublicClient,
  tryCreateBookingClient,
  tryCreateBookingPublicClient,
} from "../src/client.js";
import {
  fetchStub,
  listResponse,
  testBaseUrl,
  testPublishableKey,
  testSecretKey,
} from "./stubs/fetch.js";

/** Pretend this code is running in a browser. */
function inBrowser(): void {
  vi.stubGlobal("window", {} as Window);
}

/** The variables the two constructors read, cleared so a case controls them entirely. */
const variables = [
  "BOOKING_SERVICE_BASE_URL",
  "BOOKING_SERVICE_PUBLISHABLE_KEY",
  "BOOKING_SERVICE_SECRET_KEY",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
  for (const name of variables) delete process.env[name];
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
});

describe("createBookingPublicClient", () => {
  it("does not throw in a browser with a bpk_ key, which is public by design", () => {
    inBrowser();
    expect(() =>
      createBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
    ).not.toThrow();
  });

  it("throws in a browser with a bsk_ key, and says to rotate it", () => {
    // A key that reached a bundle has been published to every visitor; hiding it now does nothing.
    inBrowser();
    expect(() =>
      createBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
    ).toThrow(/server-only/);
    expect(() =>
      createBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
    ).toThrow(/rotate it/);
    expect(() =>
      createBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
    ).toThrow(/BOOKING_SERVICE_SECRET_KEY/);
  });

  it("reads the publishable key variable, and does not fall back to the secret one", () => {
    // The knowledge base documents no bsk_ access to /v1/public/*, so a fallback would be a guess.
    process.env.BOOKING_SERVICE_BASE_URL = testBaseUrl;
    process.env.BOOKING_SERVICE_SECRET_KEY = testSecretKey;
    expect(() => createBookingPublicClient()).toThrow(/BOOKING_SERVICE_PUBLISHABLE_KEY/);

    process.env.BOOKING_SERVICE_PUBLISHABLE_KEY = testPublishableKey;
    expect(() => createBookingPublicClient()).not.toThrow();
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createBookingPublicClient()).toThrow(/BOOKING_SERVICE_BASE_URL/);
  });

  it("offers the twelve public endpoints and nothing else", () => {
    const client = createBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey });
    expect(Object.keys(client).sort()).toEqual([
      "cancelBooking",
      "confirmBooking",
      "createBooking",
      "createHold",
      "getAvailability",
      "getAvailabilityDays",
      "getBooking",
      "listEmployees",
      "listLocations",
      "listServices",
      "releaseHold",
      "rescheduleBooking",
    ]);
  });

  it("has no booking listing, because a token grants access to ONE booking", () => {
    const client = createBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey });
    expect(Object.keys(client).filter((name) => /^list.*Booking/i.test(name))).toEqual([]);
  });
});

describe("createBookingClient", () => {
  it("throws in a browser, and names rotation rather than hiding", () => {
    // The service refuses a browser-shaped request on /v1/* before authentication and presumes the
    // key burned. This fires earlier, at construction.
    inBrowser();
    expect(() => createBookingClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow(
      /rotate it/,
    );
    expect(() => createBookingClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow(
      /BOOKING_SERVICE_SECRET_KEY/,
    );
  });

  it("reads its two documented variables", () => {
    process.env.BOOKING_SERVICE_BASE_URL = testBaseUrl;
    process.env.BOOKING_SERVICE_SECRET_KEY = testSecretKey;
    expect(() => createBookingClient()).not.toThrow();
  });

  it("names the variable to set when nothing is configured", () => {
    expect(() => createBookingClient()).toThrow(/BOOKING_SERVICE_BASE_URL/);
    process.env.BOOKING_SERVICE_BASE_URL = testBaseUrl;
    expect(() => createBookingClient()).toThrow(/BOOKING_SERVICE_SECRET_KEY/);
  });

  it("offers the tenant surface minus key management", () => {
    const client = createBookingClient({ baseUrl: testBaseUrl, apiKey: testSecretKey });
    expect(Object.keys(client).sort()).toEqual(
      [
        "getMe",
        "getSettings",
        "listLocations",
        "createLocation",
        "getLocation",
        "updateLocation",
        "listServices",
        "createService",
        "getService",
        "updateService",
        "listEmployees",
        "createEmployee",
        "getEmployee",
        "updateEmployee",
        "listEmployeeServices",
        "assignService",
        "unassignService",
        "listEmployeeLocations",
        "assignLocation",
        "unassignLocation",
        "authorizeCalendar",
        "getCalendarConnection",
        "disconnectCalendar",
        "listRules",
        "createRule",
        "updateRule",
        "deleteRule",
        "listExceptions",
        "createException",
        "deleteException",
        "createHold",
        "releaseHold",
        "listBookings",
        "createBooking",
        "getBooking",
        "confirmBooking",
        "completeBooking",
        "markNoShow",
        "rescheduleBooking",
        "cancelBooking",
        "mintConfirmationToken",
        "mintManagementToken",
        "listEventTypes",
        "listWebhookEndpoints",
        "createWebhookEndpoint",
        "getWebhookEndpoint",
        "updateWebhookEndpoint",
        "deleteWebhookEndpoint",
        "enableWebhookEndpoint",
        "disableWebhookEndpoint",
        "rotateWebhookSecret",
        "testWebhookEndpoint",
        "listWebhookEvents",
        "listWebhookDeliveries",
        "redeliverWebhook",
      ].sort(),
    );
  });

  it("has no key management and no admin surface", () => {
    // Minting, rotating and revoking a credential is an operator's ceremony, not a backend's call.
    const client = createBookingClient({ baseUrl: testBaseUrl, apiKey: testSecretKey });
    expect(Object.keys(client).filter((name) => /key|admin|tenant|job|audit/i.test(name))).toEqual(
      [],
    );
  });
});

describe("the try* constructors", () => {
  it("answer null with no environment at all, so a site still boots", () => {
    expect(tryCreateBookingPublicClient()).toBeNull();
    expect(tryCreateBookingClient()).toBeNull();
  });

  it("answer null when only half the configuration is present", () => {
    process.env.BOOKING_SERVICE_BASE_URL = testBaseUrl;
    expect(tryCreateBookingPublicClient()).toBeNull();
    expect(tryCreateBookingClient()).toBeNull();
  });

  it("still throw for a leaked key, because that is not a missing configuration", () => {
    inBrowser();
    expect(() =>
      tryCreateBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
    ).toThrow();
    expect(() => tryCreateBookingClient({ baseUrl: testBaseUrl, apiKey: testSecretKey })).toThrow();
  });

  it("answer a working client once configured", async () => {
    process.env.BOOKING_SERVICE_BASE_URL = testBaseUrl;
    process.env.BOOKING_SERVICE_PUBLISHABLE_KEY = testPublishableKey;
    process.env.BOOKING_SERVICE_SECRET_KEY = testSecretKey;

    const publicStub = fetchStub([listResponse([])]);
    await tryCreateBookingPublicClient({ fetch: publicStub.fetch })?.listLocations();
    expect(publicStub.lastUrl()).toBe(`${testBaseUrl}/v1/public/locations`);
    expect(publicStub.lastHeaders().authorization).toBe(`Bearer ${testPublishableKey}`);

    const tenantStub = fetchStub();
    await tryCreateBookingClient({ fetch: tenantStub.fetch })?.getMe();
    expect(tenantStub.lastUrl()).toBe(`${testBaseUrl}/v1/me`);
    expect(tenantStub.lastHeaders().authorization).toBe(`Bearer ${testSecretKey}`);
  });
});

describe("a client never reveals its credential", () => {
  const clients = () => [
    createBookingPublicClient({ baseUrl: testBaseUrl, apiKey: testPublishableKey }),
    createBookingClient({ baseUrl: testBaseUrl, apiKey: testSecretKey }),
  ];

  it.each(["JSON.stringify", "String", "util.inspect"])(
    "is absent from %s of the client",
    (how) => {
      for (const client of clients()) {
        const rendered =
          how === "JSON.stringify"
            ? JSON.stringify(client)
            : how === "String"
              ? String(client)
              : inspect(client);
        expect(rendered ?? "").not.toContain("bsk_");
        expect(rendered ?? "").not.toContain("bpk_");
      }
    },
  );

  it("is absent from a caught error", async () => {
    const stub = fetchStub([
      new Response(
        JSON.stringify({ type: "urn:booking-service:problem:unauthorized", detail: "no" }),
        { status: 401 },
      ),
    ]);
    const caught = await createBookingClient({
      baseUrl: testBaseUrl,
      apiKey: testSecretKey,
      fetch: stub.fetch,
    })
      .getMe()
      .catch((error: unknown) => error);

    expect(JSON.stringify(caught)).not.toContain("bsk_");
    expect(inspect(caught)).not.toContain("bsk_");
  });
});
