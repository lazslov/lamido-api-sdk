import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingWebhookHandler } from "../src/next/handler.js";
import { type BookingWebhookEvent, isKnownEvent } from "../src/webhook.js";
import { eventBody, eventData, eventRequest, testWebhookSecret } from "./stubs/delivery.js";

/**
 * The booking webhook route handler — where a mistake means two confirmation emails, or none.
 *
 * @remarks
 * Delivery is at-least-once, so every case here is about the ordering: dedupe, then work, then mark.
 * A crash anywhere in that sequence must produce a redelivery rather than a silently dropped event or
 * a doubled email.
 */

let savedSecret: string | undefined;
let savedNodeEnv: string | undefined;

beforeEach(() => {
  savedSecret = process.env.BOOKING_SERVICE_WEBHOOK_SECRET;
  savedNodeEnv = process.env.NODE_ENV;
  delete process.env.BOOKING_SERVICE_WEBHOOK_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.BOOKING_SERVICE_WEBHOOK_SECRET;
  else process.env.BOOKING_SERVICE_WEBHOOK_SECRET = savedSecret;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  vi.restoreAllMocks();
});

/** A handler over an in-memory processed-event set, plus the log of what happened. */
function harness(
  overrides: Partial<Parameters<typeof createBookingWebhookHandler>[0]> = {},
  seed: string[] = [],
) {
  const processed = new Set(seed);
  const handled: BookingWebhookEvent[] = [];

  const handler = createBookingWebhookHandler({
    secret: testWebhookSecret,
    alreadyProcessed: async (id) => processed.has(id),
    markProcessed: async (id) => void processed.add(id),
    onEvent: async (event) => void handled.push(event),
    ...overrides,
  });

  return { handler, processed, handled };
}

describe("a valid, first-time delivery", () => {
  it("enqueues, marks processed, and answers 200", async () => {
    const { handler, processed, handled } = harness();
    const response = await handler(eventRequest());

    expect(response.status).toBe(200);
    expect(handled).toHaveLength(1);
    const first = handled[0];
    expect(first && isKnownEvent(first) && first.data.booking.public_id).toBe(
      "019e5c31-0000-7000-8000-000000000106",
    );
    expect([...processed]).toEqual(["019e5c31-0000-7000-8000-0000000001a0"]);
  });

  it("marks processed only after onEvent resolves", async () => {
    const order: string[] = [];
    const { handler } = harness({
      onEvent: async () => {
        await Promise.resolve();
        order.push("onEvent");
      },
      markProcessed: async () => void order.push("markProcessed"),
    });

    await handler(eventRequest());
    expect(order).toEqual(["onEvent", "markProcessed"]);
  });

  it("reads the secret from the environment when none is passed", async () => {
    process.env.BOOKING_SERVICE_WEBHOOK_SECRET = testWebhookSecret;
    const response = await createBookingWebhookHandler({
      alreadyProcessed: async () => false,
      markProcessed: async () => {},
      onEvent: async () => {},
    })(eventRequest());

    expect(response.status).toBe(200);
  });

  it("hands an unknown event type to onEvent and still answers 200", async () => {
    // New members ship inside contract_version 1. A receiver that refuses one dead-letters it.
    const { handler, handled } = harness();
    const response = await handler(
      eventRequest({ body: eventBody({ event_type: "booking.waitlisted" }) }),
    );

    expect(response.status).toBe(200);
    expect(handled[0]?.event_type).toBe("booking.waitlisted");
  });

  it("carries the customer block through where the endpoint opted in", async () => {
    const body = eventBody({
      event_type: "booking.canceled",
      data: eventData({
        customer: {
          public_id: "019e5c31-0000-7000-8000-000000000104",
          name: "Anna Kovács",
          email: "anna@example.com",
          phone: null,
        },
      }),
    });
    const { handler, handled } = harness();
    await handler(eventRequest({ body }));

    const event = handled[0];
    expect(event && isKnownEvent(event) && event.data.customer?.name).toBe("Anna Kovács");
  });
});

describe("the dedupe, which is the point of the signature", () => {
  it("answers 200 for a duplicate without calling onEvent", async () => {
    // A duplicate is a success — the sender's job is done. Anything else asks for the retry that
    // produced it.
    const { handler, handled } = harness({}, ["019e5c31-0000-7000-8000-0000000001a0"]);
    const response = await handler(eventRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("duplicate");
    expect(handled).toEqual([]);
  });

  it("dedupes on X-Event-Id, which is stable across retries and redeliveries", async () => {
    const seen: string[] = [];
    const { handler } = harness({ alreadyProcessed: async (id) => !!seen.push(id) && false });

    await handler(eventRequest({ eventId: "stable-event-id" }));
    expect(seen).toEqual(["stable-event-id"]);
  });

  it("does not dedupe on X-Delivery-Id, which is a fresh id per attempt", async () => {
    const seen: string[] = [];
    const { handler } = harness({ alreadyProcessed: async (id) => !!seen.push(id) && false });

    await handler(eventRequest({ eventId: "stable-event-id", deliveryId: "attempt-3" }));
    expect(seen).toEqual(["stable-event-id"]);
  });

  it("falls back to the payload's own event_id when the header is absent", async () => {
    // Same value: the payload is frozen at emission and delivered verbatim afterwards.
    const seen: string[] = [];
    const { handler } = harness({ alreadyProcessed: async (id) => !!seen.push(id) && false });

    await handler(eventRequest({ eventId: null }));
    expect(seen).toEqual(["019e5c31-0000-7000-8000-0000000001a0"]);
  });

  it("processes the second delivery of a DIFFERENT event", async () => {
    const { handler, handled } = harness();
    await handler(eventRequest());
    await handler(
      eventRequest({ body: eventBody({ event_id: "019e5c31-0000-7000-8000-0000000001af" }) }),
    );

    expect(handled).toHaveLength(2);
  });
});

describe("a thrown onEvent", () => {
  it("answers 500 and does not mark the event processed", async () => {
    // An event marked handled after a failed enqueue is one that never happens again — and here
    // that is a confirmation email nobody ever receives.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, processed } = harness({
      onEvent: async () => {
        throw new Error("the queue is down");
      },
    });

    const response = await handler(eventRequest());

    expect(response.status).toBe(500);
    expect([...processed]).toEqual([]);
  });

  it("logs the cause server-side, so a retried delivery is still diagnosable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler } = harness({
      onEvent: async () => {
        throw new Error("the queue is down");
      },
    });

    await handler(eventRequest());
    expect(error).toHaveBeenCalled();
  });
});

describe("a delivery that does not verify", () => {
  it("answers 401 naming the edge runtime, which is the likely cause", async () => {
    const { handler, handled } = harness();
    const response = await handler(eventRequest({ secret: "whsec_EXAMPLE_WRONG_SECRET_00000" }));

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain("bad_signature");
    expect(body).toMatch(/runtime = "nodejs"/);
    expect(handled).toEqual([]);
  });

  it("answers 401 for a body mutated after signing, naming the same cause", async () => {
    const original = eventBody();
    const signed = eventRequest({ body: original });
    const mutated = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      // A re-serialisation that reorders keys: semantically identical, different bytes.
      body: JSON.stringify({ data: JSON.parse(original).data, event_id: "x" }),
    });

    const { handler } = harness();
    const response = await handler(mutated);

    expect(response.status).toBe(401);
    expect(await response.text()).toMatch(/raw request body/);
  });

  it("answers 401 for a missing signature and for a stale timestamp", async () => {
    const { handler } = harness();
    expect((await handler(eventRequest({ signature: null }))).status).toBe(401);

    const stale = String(Math.floor(Date.now() / 1000) - 400);
    expect((await handler(eventRequest({ timestamp: stale }))).status).toBe(401);
  });

  it("never calls alreadyProcessed for an unverified delivery", async () => {
    const asked: string[] = [];
    const { handler } = harness({
      alreadyProcessed: async (id) => !!asked.push(id) && false,
      secret: testWebhookSecret,
    });

    await handler(eventRequest({ signature: null }));
    expect(asked).toEqual([]);
  });
});

describe("a body that verified but is not an event", () => {
  it("answers 400, because retrying will not change it", async () => {
    const { handler, handled } = harness();
    const response = await handler(eventRequest({ body: '{"event_type":"booking.invented"}' }));

    expect(response.status).toBe(400);
    expect(handled).toEqual([]);
  });
});

describe("an unconfigured deployment", () => {
  it("answers 500 naming the variable, rather than throwing on import", async () => {
    const response = await createBookingWebhookHandler({
      alreadyProcessed: async () => false,
      markProcessed: async () => {},
      onEvent: async () => {},
    })(eventRequest());

    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/BOOKING_SERVICE_WEBHOOK_SECRET/);
  });
});

describe("the slow-onEvent warning", () => {
  it("warns once, outside production, when onEvent runs long", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NODE_ENV = "development";

    const { handler } = harness({ slowEventWarningMs: 0 });
    await handler(eventRequest());
    await handler(eventRequest({ body: eventBody({ event_id: "second" }) }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/Enqueue the work/);
  });

  it("stays silent in production, where a warning per delivery is itself the problem", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NODE_ENV = "production";

    const { handler } = harness({ slowEventWarningMs: 0 });
    await handler(eventRequest());

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent for a fast onEvent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NODE_ENV = "development";

    const { handler } = harness();
    await handler(eventRequest());

    expect(warn).not.toHaveBeenCalled();
  });
});
