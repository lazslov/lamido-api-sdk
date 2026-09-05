import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthWebhookHandler } from "../src/next/handler.js";
import { type AuthWebhookEvent, isSubscriptionEvent } from "../src/webhook.js";
import { eventBody, eventRequest, testWebhookSecret } from "./stubs/delivery.js";

/**
 * The auth webhook route handler.
 *
 * @remarks
 * Delivery is at-least-once, so every case here is about the ordering: dedupe, then work, then mark. A
 * crash anywhere in that sequence must produce a redelivery rather than a silently dropped event or a
 * doubled provisioning.
 */

let savedSecret: string | undefined;
let savedNodeEnv: string | undefined;

beforeEach(() => {
  savedSecret = process.env.AUTH_SERVICE_WEBHOOK_SECRET;
  savedNodeEnv = process.env.NODE_ENV;
  delete process.env.AUTH_SERVICE_WEBHOOK_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SERVICE_WEBHOOK_SECRET;
  else process.env.AUTH_SERVICE_WEBHOOK_SECRET = savedSecret;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  vi.restoreAllMocks();
});

/** A handler over an in-memory processed-event set, plus the log of what happened. */
function harness(
  overrides: Partial<Parameters<typeof createAuthWebhookHandler>[0]> = {},
  seed: string[] = [],
) {
  const processed = new Set(seed);
  const handled: AuthWebhookEvent[] = [];

  const handler = createAuthWebhookHandler({
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
    expect(first && isSubscriptionEvent(first) && first.data.subscription.public_id).toBe(
      "019f0a10-0000-7000-8000-0000000000c3",
    );
    expect([...processed]).toEqual(["019f0a10-0000-7000-8000-0000000000a1"]);
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
    process.env.AUTH_SERVICE_WEBHOOK_SECRET = testWebhookSecret;
    const response = await createAuthWebhookHandler({
      alreadyProcessed: async () => false,
      markProcessed: async () => {},
      onEvent: async () => {},
    })(eventRequest());

    expect(response.status).toBe(200);
  });

  it("acknowledges a webhook.ping and an unrecognised type with a 200", async () => {
    // Item 5 of the receiver checklist: an unknown type is a normal delivery, not a malformed one.
    const { handler, handled } = harness();
    const ping = eventBody({ event_type: "webhook.ping", account_id: null, data: {} });
    const novel = eventBody({ event_type: "organization.renamed", data: { organization: {} } });

    expect((await handler(eventRequest({ body: ping }))).status).toBe(200);
    expect((await handler(eventRequest({ body: novel, eventId: "novel" }))).status).toBe(200);
    expect(handled.map((event) => event.event_type)).toEqual([
      "webhook.ping",
      "organization.renamed",
    ]);
  });
});

describe("the dedupe, which is the point of the signature", () => {
  it("answers 200 for a duplicate without calling onEvent", async () => {
    // A duplicate is a success — the sender's job is done. Anything else asks for the retry that
    // produced it.
    const { handler, handled } = harness({}, ["019f0a10-0000-7000-8000-0000000000a1"]);
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

  it("does not dedupe on X-Delivery-Id, which is per attempt", async () => {
    // Deduping on the delivery id would process the same event up to eight times.
    const seen: string[] = [];
    const { handler } = harness({ alreadyProcessed: async (id) => !!seen.push(id) && false });

    await handler(eventRequest({ eventId: "stable-event-id", deliveryId: "attempt-3" }));
    expect(seen).toEqual(["stable-event-id"]);
  });

  it("falls back to the payload's own event_id when the header is absent", async () => {
    const seen: string[] = [];
    const { handler } = harness({ alreadyProcessed: async (id) => !!seen.push(id) && false });

    await handler(eventRequest({ eventId: null }));
    expect(seen).toEqual(["019f0a10-0000-7000-8000-0000000000a1"]);
  });

  it("processes the second delivery of a DIFFERENT event", async () => {
    const { handler, handled } = harness();
    await handler(eventRequest());
    await handler(
      eventRequest({ body: eventBody({ event_id: "019f0a10-0000-7000-8000-00000000000f" }) }),
    );

    expect(handled).toHaveLength(2);
  });
});

describe("a thrown onEvent", () => {
  it("answers 500 and does not mark the event processed", async () => {
    // An event marked handled after a failed enqueue is one that never happens again, so the sender
    // must be told to retry. A crash between the two yields a redelivery, which is the safe direction.
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
    const response = await handler(eventRequest({ body: '{"event_type":"customer.created"}' }));

    expect(response.status).toBe(400);
    expect(handled).toEqual([]);
  });
});

describe("an unconfigured deployment", () => {
  it("answers 500 naming the variable, rather than throwing on import", async () => {
    const response = await createAuthWebhookHandler({
      alreadyProcessed: async () => false,
      markProcessed: async () => {},
      onEvent: async () => {},
    })(eventRequest());

    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/AUTH_SERVICE_WEBHOOK_SECRET/);
  });
});

describe("the slow-onEvent warning", () => {
  it("warns once, outside production, when onEvent runs long", async () => {
    // The production symptom is dead-lettering days later, which is a terrible way to find out.
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
