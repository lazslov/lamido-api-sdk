import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { minorAmount } from "../src/amount.js";
import type { components } from "../src/generated/schema.js";
import type {
  CurrencyVariable,
  GeneratedMessageDetail,
  Message,
  MessageDetail,
  SendMessageInput,
} from "../src/types.js";
import { emailClient, fetchStub, jsonResponse, message, sendBody } from "./stubs/fetch.js";

/**
 * The assertions that must fail at **compile** time, not at runtime.
 *
 * @remarks
 * Each `@ts-expect-error` is the assertion: `tsc` fails if the line it precedes turns out to be
 * *legal*, so `pnpm typecheck` is what runs this suite. The runtime bodies exist so the file is also
 * a readable list of what the types forbid.
 */

describe("the send input has no body field", () => {
  it("rejects a body, html or text member", () => {
    const bad = {
      template: { key: "order.confirmation" },
      to: "guest@example.com",
      // @ts-expect-error — there is no raw-HTML path. Template-only sending is the control.
      html: "<b>hello</b>",
    } satisfies SendMessageInput;
    expect(bad.html).toBe("<b>hello</b>");
  });

  it("rejects the marketing stream, which the service refuses with 409 stream_closed", () => {
    const bad = {
      template: { key: "generic.notification" },
      to: "guest@example.com",
      // @ts-expect-error — the column, the quota and the identity exist; the feature does not.
      stream: "marketing",
    } satisfies SendMessageInput;
    expect(bad.stream).toBe("marketing");
  });

  it("rejects an array of recipients", () => {
    const bad = {
      template: { key: "order.confirmation" },
      // @ts-expect-error — exactly one recipient. No cc, no bcc, no arrays.
      to: ["a@example.com", "b@example.com"],
    } satisfies SendMessageInput;
    expect(bad.to).toHaveLength(2);
  });

  it("still fits the generated request type once the defaults are spelled out", () => {
    // The hand-written input omits what the service defaults and widens `variables`; this proves
    // its member names are the wire's. A renamed field upstream fails here.
    const wire = {
      stream: "transactional",
      template: { key: "order.confirmation", version: 1 },
      to: "guest@example.com",
      subject: "Your order",
      variables: {},
      attachments: [],
      metadata: {},
      headers: { "Reply-To": "help@example.com" },
    } satisfies SendMessageInput satisfies components["schemas"]["SendMessage"];
    expect(wire.to).toBe("guest@example.com");
  });
});

describe("a currency variable's amount is a branded string", () => {
  it("rejects a bare string", () => {
    // @ts-expect-error — "38100" must go through minorAmount(), so the unit is a visible decision.
    const bad: CurrencyVariable = { amount: "38100", currency: "HUF" };
    expect(bad.amount).toBe("38100");
  });

  it("rejects a number, which the service refuses with a 400", () => {
    // @ts-expect-error — a JSON number is a 400 since the service's 7cbff0e.
    const bad: CurrencyVariable = { amount: 38100, currency: "HUF" };
    expect(bad.amount).toBe(38100);
  });

  it("accepts what minorAmount produces", () => {
    const good: CurrencyVariable = { amount: minorAmount("38100"), currency: "HUF" };
    expect(good.amount).toBe("38100");
  });
});

describe("variables never come back on a read", () => {
  it("does not declare variables on a message", () => {
    const read = message() as unknown as Message;
    // @ts-expect-error — absent from every tenant read, as a security control. Keep your own copy.
    expect(read.variables).toBeUndefined();
  });

  it("keeps the read's key set equal to the generated response", () => {
    // `Message` widens `status` and nothing else; the detail alias must still name what the
    // contract names. Both directions, so a member added upstream fails here.
    type Keys<T> = keyof Required<T>;
    const same: [Keys<MessageDetail>] extends [Keys<GeneratedMessageDetail>]
      ? [Keys<GeneratedMessageDetail>] extends [Keys<MessageDetail>]
        ? true
        : never
      : never = true;
    expect(same).toBe(true);
  });
});

describe("a send cannot happen without an idempotency key", () => {
  const client = emailClient(fetchStub([jsonResponse(message(), 202)]));

  it("has no sendMessage overload without one", () => {
    // The argument list is on one line on purpose: an @ts-expect-error applies to the line that
    // follows it, so a formatter wrapping the call would move the error out from under the directive.
    // @ts-expect-error — the key is the second argument and there is no overload lacking it.
    const call = () => client.sendMessage(sendBody());
    expect(typeof call).toBe("function");
  });

  it("rejects a raw string as a key", () => {
    // @ts-expect-error — IdempotencyKey is branded: it must go through idempotencyKey().
    const call = () => client.sendMessage(sendBody(), "order-2026-0001");
    expect(typeof call).toBe("function");
  });

  it("accepts a validated key", () => {
    expect(typeof idempotencyKey("order-2026-0001")).toBe("string");
  });
});

describe("a list declares no total", () => {
  it("makes reading total a compile error rather than NaN pages", async () => {
    const page = await emailClient(
      fetchStub([jsonResponse({ data: [], next_cursor: null })]),
    ).listMessages();
    // @ts-expect-error — there is no total, anywhere, deliberately.
    expect(page.total).toBeUndefined();
    expect(page.nextCursor).toBeNull();
  });
});
