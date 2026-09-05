import { collectAllCursor } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { AuthApiError } from "../src/errors.js";
import {
  authClient,
  collection,
  customer,
  fetchStub,
  jsonResponse,
  problemResponse,
  subscription,
  testApplicationKey,
  testBaseUrl,
} from "./stubs/fetch.js";

/**
 * The client-tier routes that take the `ask_` key alone: the authorization decision, entitlements,
 * customers and session verification.
 */

const principal = { kind: "user", session_token: "tok_person" } as const;
const organizationId = "019f0a10-0000-7000-8000-0000000000b2";
const websiteId = "019f0a10-0000-7000-8000-0000000000e5";

describe("authorize", () => {
  it("posts the principal by session token, with the key and no session header", async () => {
    const stub = fetchStub([jsonResponse({ decision: "allow" })]);
    const answer = await authClient(stub).authorize({
      principal,
      organization_id: organizationId,
      permission: "shop.orders.refund",
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/authorize`);
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testApplicationKey}`);
    // A question ABOUT a person: the session is inside the body, never in the header.
    expect(stub.lastHeaders()["x-session-token"]).toBeUndefined();
    expect(stub.lastBody()).toEqual({
      principal: { kind: "user", session_token: "tok_person" },
      organization_id: organizationId,
      permission: "shop.orders.refund",
    });
    expect(answer).toEqual({ decision: "allow" });
  });

  it("passes website_id through when given and omits it when not", async () => {
    const stub = fetchStub([jsonResponse({ decision: "deny" })]);
    const client = authClient(stub);

    await client.authorize({ principal, organization_id: organizationId, permission: "p" });
    expect(stub.lastBody()).not.toHaveProperty("website_id");

    await client.authorize({
      principal,
      organization_id: organizationId,
      website_id: websiteId,
      permission: "p",
    });
    expect(stub.lastBody()).toMatchObject({ website_id: websiteId });
  });

  it("answers deny as deny, never as a throw", async () => {
    const stub = fetchStub([jsonResponse({ decision: "deny" })]);
    await expect(
      authClient(stub).authorize({ principal, organization_id: organizationId, permission: "p" }),
    ).resolves.toEqual({ decision: "deny" });
  });

  it("refuses a decision it does not know, because that enum cannot grow", async () => {
    // A third value is a request whose outcome you cannot determine. Widening the type would read it
    // as one of the two; refusing loudly fails closed.
    const stub = fetchStub([jsonResponse({ decision: "maybe" })]);
    await expect(
      authClient(stub).authorize({ principal, organization_id: organizationId, permission: "p" }),
    ).rejects.toThrow(/decision this SDK does not know/);
  });

  it("throws on a 404 for an organization that is not the key's own", async () => {
    // A fact about your configuration, not an answer about a principal — and the advice says so.
    const stub = fetchStub([problemResponse(404, "not-found")]);
    const caught = await authClient(stub)
      .authorize({ principal, organization_id: "someone-elses", permission: "p" })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AuthApiError);
    expect((caught as AuthApiError).status).toBe(404);
    expect((caught as AuthApiError).message).toMatch(/not this key's own/);
  });
});

describe("listPermissions", () => {
  it("posts the decision body minus permission and unwraps the envelope", async () => {
    const stub = fetchStub([collection([{ key: "shop.orders.refund" }])]);
    const permissions = await authClient(stub).listPermissions({
      principal,
      organization_id: organizationId,
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/permissions`);
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastBody()).toEqual({ principal, organization_id: organizationId });
    expect(permissions).toEqual([{ key: "shop.orders.refund" }]);
  });

  it("answers an empty set for a principal that does not resolve", async () => {
    const stub = fetchStub([collection([])]);
    await expect(
      authClient(stub).listPermissions({ principal, organization_id: organizationId }),
    ).resolves.toEqual([]);
  });
});

describe("entitlements", () => {
  it("lists subscriptions scoped by organization, as a cursor page", async () => {
    const stub = fetchStub([collection([subscription()], "cursor-2")]);
    const page = await authClient(stub).listSubscriptions({ organization_id: organizationId });

    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/subscriptions?organization_id=${organizationId}`,
    );
    expect(page.items[0]?.status).toBe("active");
    expect(page.nextCursor).toBe("cursor-2");
    expect(page).not.toHaveProperty("total");
  });

  it("passes website_id, limit and cursor through verbatim", async () => {
    const stub = fetchStub([collection([])]);
    await authClient(stub).listSubscriptions({
      organization_id: organizationId,
      website_id: websiteId,
      limit: 10,
      cursor: "opaque%3Dcursor",
    });
    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/subscriptions?organization_id=${organizationId}&website_id=${websiteId}&limit=10&cursor=opaque%253Dcursor`,
    );
  });

  it("follows a subscription list to the end with core's paginator", async () => {
    const stub = fetchStub([
      collection([subscription({ public_id: "one" })], "next"),
      collection([subscription({ public_id: "two" })]),
    ]);
    const client = authClient(stub);
    const all = await collectAllCursor(({ limit, cursor }) =>
      client.listSubscriptions({ organization_id: organizationId, limit, cursor }),
    );

    expect(all.map((row) => row.public_id)).toEqual(["one", "two"]);
    expect(stub.calls[1]?.url).toContain("cursor=next");
  });

  it("lists plans as a page and features as bare rows", async () => {
    const stub = fetchStub([
      collection([{ key: "starter" }]),
      collection([{ key: "shop.refunds" }]),
    ]);
    const client = authClient(stub);

    const plans = await client.listPlans();
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/plans`);
    expect(plans).toEqual({ items: [{ key: "starter" }], nextCursor: null });

    const features = await client.listFeatures({ organization_id: organizationId });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/features?organization_id=${organizationId}`);
    expect(features).toEqual([{ key: "shop.refunds" }]);
  });
});

describe("customers", () => {
  it("lists one website's customers and requires the website", async () => {
    const stub = fetchStub([collection([customer()])]);
    const page = await authClient(stub).listCustomers({ website: websiteId, limit: 5 });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/customers?website=${websiteId}&limit=5`);
    expect(page.items).toHaveLength(1);
  });

  it("reports created: true on a 201 and false on a 200", async () => {
    const body = { website: websiteId, email: "shopper@example.com", name: "Ada" };

    const fresh = fetchStub([jsonResponse(customer(), 201)]);
    const created = await authClient(fresh).createCustomer(body);
    expect(fresh.lastUrl()).toBe(`${testBaseUrl}/v1/customers`);
    // `website`, not `website_id`, exactly as given.
    expect(fresh.lastBody()).toEqual(body);
    expect(created.created).toBe(true);
    expect(created.customer.public_id).toBe(customer().public_id);

    const resolved = fetchStub([jsonResponse(customer(), 200)]);
    expect((await authClient(resolved).createCustomer(body)).created).toBe(false);
  });

  it("sends no Idempotency-Key on the create, which is idempotent by construction", async () => {
    const stub = fetchStub([jsonResponse(customer(), 201)]);
    await authClient(stub).createCustomer({ website: websiteId, email: "s@example.com" });
    expect(stub.lastHeaders()["idempotency-key"]).toBeUndefined();
  });

  it("reads one customer with the website in the query", async () => {
    const stub = fetchStub([jsonResponse(customer())]);
    await authClient(stub).getCustomer("019f-cust", { website: websiteId });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/customers/019f-cust?website=${websiteId}`);
  });

  it("throws on a 404 rather than answering null, and names the missing-website reading", async () => {
    const stub = fetchStub([problemResponse(404, "not-found")]);
    const caught = await authClient(stub)
      .getCustomer("019f-cust", { website: websiteId })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AuthApiError);
    expect((caught as AuthApiError).message).toMatch(/omitted its required `website`/);
  });
});

describe("verifyCustomerSession", () => {
  it("posts { website, token } and answers the verdict", async () => {
    const stub = fetchStub([
      jsonResponse({ valid: true, customer: customer(), expires_at: "2026-09-13T09:14:22.481Z" }),
    ]);
    const verdict = await authClient(stub).verifyCustomerSession({
      website: websiteId,
      token: "tok_customer",
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/customer-sessions/verify`);
    expect(stub.lastBody()).toEqual({ website: websiteId, token: "tok_customer" });
    expect(verdict.valid).toBe(true);
    if (verdict.valid) expect(verdict.customer.public_id).toBe(customer().public_id);
  });

  it("answers { valid: false } for an invalid session and never throws for it", async () => {
    // The request authenticated fine; the answer is no. A 200, not a 401.
    const stub = fetchStub([jsonResponse({ valid: false, customer: null, expires_at: null })]);
    await expect(
      authClient(stub).verifyCustomerSession({ website: websiteId, token: "stale" }),
    ).resolves.toEqual({ valid: false, customer: null, expires_at: null });
  });

  it("still throws for a 400, which is what { session_token } produces", async () => {
    const stub = fetchStub([
      problemResponse(400, "validation", {
        errors: [
          { pointer: "/website", code: "required" },
          { pointer: "/token", code: "required" },
          { pointer: "/session_token", code: "unknown_field" },
        ],
      }),
    ]);
    const caught = await authClient(stub)
      .verifyCustomerSession({ session_token: "x" } as never)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AuthApiError);
    expect((caught as AuthApiError).errors?.map((entry) => entry.pointer)).toEqual([
      "/website",
      "/token",
      "/session_token",
    ]);
  });
});

describe("every request", () => {
  it("passes a caller's init through, and sets no fetch mode", async () => {
    const controller = new AbortController();
    const stub = fetchStub([collection([])]);
    await authClient(stub).listPlans({ init: { signal: controller.signal } });

    expect(stub.calls.at(-1)?.init.signal).toBe(controller.signal);
    expect(stub.calls.at(-1)?.init.mode).toBeUndefined();
  });
});
