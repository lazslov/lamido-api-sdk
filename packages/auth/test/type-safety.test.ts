import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import type { components } from "../src/generated/schema.js";
import type {
  AuthorizationDecision,
  AuthorizeInput,
  CustomerSessionVerdict,
  LoginStatus,
  Subscription,
} from "../src/types.js";
import type { AuthWebhookEvent } from "../src/webhook.js";
import { authClient, collection, fetchStub, subscription } from "./stubs/fetch.js";

/**
 * The assertions that must fail at **compile** time, not at runtime.
 *
 * @remarks
 * Each `@ts-expect-error` is the assertion: `tsc` fails if the line it precedes turns out to be
 * *legal*, so `pnpm typecheck` is what runs this suite. The runtime bodies exist so the file is also a
 * readable list of what the types forbid. The directive applies to the **following line**, so these
 * expressions are kept short enough that the formatter cannot wrap them out from under it.
 */

describe("the decision cannot grow", () => {
  it("accepts allow and deny", () => {
    const allow: AuthorizationDecision = "allow";
    const deny: AuthorizationDecision = "deny";
    expect([allow, deny]).toEqual(["allow", "deny"]);
  });

  it("rejects any third value, unlike every other status union here", () => {
    // @ts-expect-error — an unrecognised decision is an outcome you cannot determine; it must fail closed.
    const widened: AuthorizationDecision = "maybe";
    expect(widened).toBe("maybe");
  });
});

describe("the principal has one form", () => {
  it("rejects the removed { kind, public_id } form", () => {
    const input = {
      // @ts-expect-error — the id form let a key holder obtain a decision for anyone, with no session.
      principal: { kind: "user", public_id: "019f" },
      organization_id: "019f",
      permission: "p",
    } satisfies AuthorizeInput;
    expect(input.organization_id).toBe("019f");
  });
});

describe("the poll answer", () => {
  it("types poll_interval_ms as a number or null, never absent", () => {
    // @ts-expect-error — a terminal status carries null, a non-terminal one a number; absent is neither.
    const absent: LoginStatus = { status: "approved", exchange_code: "xc" };
    expect(absent.status).toBe("approved");
  });

  it("types exchange_code as optional, because it is absent while pending", () => {
    const pending: LoginStatus = { status: "pending", poll_interval_ms: 2000 };
    expect(pending.exchange_code).toBeUndefined();
  });
});

describe("the customer session verdict", () => {
  it("narrows on valid, so customer is only reachable on a true verdict", () => {
    const verdict: CustomerSessionVerdict = { valid: false, customer: null, expires_at: null };
    // Inside a function nobody calls: the assertion is the compile error, and the line itself
    // would throw at runtime because the customer really is `null`.
    // @ts-expect-error — on a false verdict the customer is null, and reading a member of it is a bug.
    const read = () => verdict.customer.public_id;
    expect(typeof read).toBe("function");
  });
});

describe("a list carries no total", () => {
  it("is a compile error to read one", async () => {
    const page = await authClient(fetchStub([collection([])])).listPlans();
    // @ts-expect-error — there is no total, service-wide. Math.ceil(total / limit) would be NaN.
    const pages = page.total;
    expect(pages).toBeUndefined();
  });
});

describe("the website key mint cannot happen without an idempotency key", () => {
  const client = authClient(fetchStub([collection([])]));

  it("has no overload without one", () => {
    // @ts-expect-error — the plaintext is unrecoverable, so a retry without a reservation mints twice.
    const call = () => client.mintWebsiteKey("session", "website");
    expect(typeof call).toBe("function");
  });

  it("rejects a raw string as a key", () => {
    // @ts-expect-error — IdempotencyKey is branded: it must go through idempotencyKey().
    const call = () => client.mintWebsiteKey("session", "website", "2026-08-26-key");
    expect(typeof call).toBe("function");
  });

  it("accepts a validated key", () => {
    expect(typeof idempotencyKey("2026-08-26-acme-shop-key")).toBe("string");
  });
});

describe("the session-bearing routes take the session first", () => {
  it("cannot call getMe without a session token", () => {
    const client = authClient(fetchStub());
    // @ts-expect-error — the key alone is a 401 on this route; the session is a required argument.
    const call = () => client.getMe();
    expect(typeof call).toBe("function");
  });
});

describe("the hand-written shapes still match the generated contract", () => {
  it("accepts every Subscription the generated schema can describe", () => {
    // Hand-written because the generated one marks every member optional while the documented example
    // carries all ten. The assignment runs the other way round from the obvious one, and that is the
    // point: `status` is deliberately **wider** here than the generated closed union, so a service
    // that ships a new status does not break a client (conventions §6, the unknown-enum rule). A
    // `satisfies` against the generated type would therefore fail on a widening that is correct.
    // What this still catches is what it exists to catch: a member the service renamed, removed or
    // retyped no longer fits the hand-written shape.
    const wire = subscription() as Required<components["schemas"]["Subscription"]>;
    const local: Subscription = wire;
    expect(local.plan).toBe("starter");
  });

  it("keeps the decision equal to the generated enum", () => {
    const generated: components["schemas"]["AuthorizeDecision"]["decision"] = "allow";
    const local: AuthorizationDecision = generated;
    expect(local).toBe("allow");
  });

  it("keeps the false verdict assignable to the generated one", () => {
    const local: CustomerSessionVerdict = { valid: false, customer: null, expires_at: null };
    const generated = local satisfies components["schemas"]["CustomerSessionVerdict"];
    expect(generated.valid).toBe(false);
  });
});

describe("the webhook union", () => {
  it("makes reading data.subscription on an unknown arm a compile error", () => {
    const event = {} as AuthWebhookEvent;
    // Deferred for the same reason as the verdict above: the cast makes `data` undefined at runtime.
    // @ts-expect-error — only a subscription.* arm carries the block; narrow with isSubscriptionEvent first.
    const read = () => event.data.subscription;
    expect(typeof read).toBe("function");
  });
});
