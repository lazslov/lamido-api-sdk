import { describe, expect, it } from "vitest";
import { createBookingWebhookHandler } from "../src/next/handler.js";

/**
 * The single most important design decision in the route handler, asserted at the type level: **the
 * handler cannot be constructed without the dedupe.**
 *
 * @remarks
 * Delivery is at-least-once, and the SDK owns no storage — so it cannot dedupe on a consumer's behalf.
 * What it can do is make forgetting it a compile error rather than a doubled confirmation email
 * discovered from a customer's complaint.
 *
 * Each `@ts-expect-error` is the assertion: `pnpm typecheck` fails if the line it precedes turns out to
 * be legal.
 */

const onEvent = async () => {};
const alreadyProcessed = async () => false;
const markProcessed = async () => {};

describe("the dedupe callbacks are required", () => {
  it("cannot be constructed with no options at all", () => {
    // @ts-expect-error — three required members, and two of them are the dedupe.
    const call = () => createBookingWebhookHandler({});
    expect(typeof call).toBe("function");
  });

  it("cannot be constructed without alreadyProcessed", () => {
    // @ts-expect-error — "this is the dedupe, and it is not optional".
    const call = () => createBookingWebhookHandler({ markProcessed, onEvent });
    expect(typeof call).toBe("function");
  });

  it("cannot be constructed without markProcessed", () => {
    // @ts-expect-error — reading the set without writing to it dedupes nothing.
    const call = () => createBookingWebhookHandler({ alreadyProcessed, onEvent });
    expect(typeof call).toBe("function");
  });

  it("cannot be constructed without onEvent", () => {
    // @ts-expect-error — a handler that verifies and dedupes and then does nothing is a 200 machine.
    const call = () => createBookingWebhookHandler({ alreadyProcessed, markProcessed });
    expect(typeof call).toBe("function");
  });

  it("is constructible with all three, and the secret stays optional", () => {
    const handler = createBookingWebhookHandler({ alreadyProcessed, markProcessed, onEvent });
    expect(typeof handler).toBe("function");
  });
});

describe("the handler is a plain Web handler", () => {
  it("takes a Request and answers a Response, with no framework type in the signature", () => {
    // Which is why this package declares no `next` peer dependency: nothing here imports Next.
    const handler: (request: Request) => Promise<Response> = createBookingWebhookHandler({
      alreadyProcessed,
      markProcessed,
      onEvent,
    });
    expect(typeof handler).toBe("function");
  });
});
