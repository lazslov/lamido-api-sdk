import { describe, expect, it } from "vitest";
import { AuthApiError } from "../src/errors.js";
import { isTerminalLoginStatus } from "../src/login-status.js";
import type { LoginStatus } from "../src/types.js";
import {
  emptyResponse,
  fetchStub,
  jsonResponse,
  problemResponse,
  publicClient,
  testBaseUrl,
  testPublishableKey,
  testSessionToken,
} from "./stubs/fetch.js";

/**
 * The browser tier: both sign-in surfaces, and the two places they answer differently.
 *
 * @remarks
 * The platform exchange is `200` with a body; the customer exchange is `204` with nothing but a
 * `Set-Cookie`. Everything else is the same four requests under two prefixes.
 */

const requested = {
  login_request: "lr_handle",
  matching_code: "481920",
  expires_at: "2026-08-26T10:14:22.481Z",
  poll_interval_ms: 2000,
};

const platformCookie =
  "__Host-lamido_platform_session=tok_platform; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000";
const customerCookie =
  "__Host-lamido_customer_session=tok_customer; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800";

describe("the platform surface", () => {
  it("asks for a magic link with the publishable key and no session header", async () => {
    const stub = fetchStub([jsonResponse(requested, 202)]);
    const answer = await publicClient(stub).requestMagicLink({ email: "person@example.com" });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/auth/magic-link`);
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testPublishableKey}`);
    expect(stub.lastHeaders()["x-session-token"]).toBeUndefined();
    expect(stub.lastBody()).toEqual({ email: "person@example.com" });
    // The two things the browser must keep and must display.
    expect(answer.login_request).toBe("lr_handle");
    expect(answer.matching_code).toBe("481920");
  });

  it("polls the handle's status, URL-encoding the handle", async () => {
    const stub = fetchStub([jsonResponse({ status: "pending", poll_interval_ms: 2000 })]);
    const poll = await publicClient(stub).getMagicLinkStatus("a/b");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/auth/magic-link/a%2Fb/status`);
    expect(poll.status).toBe("pending");
    expect(poll.exchange_code).toBeUndefined();
  });

  it("exchanges for a 200 body and exposes the Set-Cookie header", async () => {
    const stub = fetchStub([
      jsonResponse(
        { user: { email: "person@example.com" }, session: { public_id: "019f-session" } },
        200,
        { "set-cookie": platformCookie },
      ),
    ]);
    const result = await publicClient(stub).exchangeMagicLink({
      login_request: "lr_handle",
      exchange_code: "xc_once",
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/auth/magic-link/exchange`);
    expect(stub.lastBody()).toEqual({ login_request: "lr_handle", exchange_code: "xc_once" });
    expect(result.user.email).toBe("person@example.com");
    expect(result.session.public_id).toBe("019f-session");
    expect(result.setCookie).toBe(platformCookie);
  });

  it("reports a withheld Set-Cookie as null, which is what a browser sees", async () => {
    const stub = fetchStub([jsonResponse({ user: {}, session: { public_id: "s" } })]);
    const result = await publicClient(stub).exchangeMagicLink({
      login_request: "lr_handle",
      exchange_code: "xc_once",
    });
    expect(result.setCookie).toBeNull();
  });

  it("surfaces token_invalid on the exchange, which there means not approved yet", async () => {
    const stub = fetchStub([
      problemResponse(409, "conflict", {
        code: "token_invalid",
        detail: "This login request has not been approved yet.",
      }),
    ]);
    const caught = await publicClient(stub)
      .exchangeMagicLink({ login_request: "lr_handle", exchange_code: "xc" })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AuthApiError);
    expect((caught as AuthApiError).code).toBe("token_invalid");
    expect((caught as AuthApiError).type).toBe("conflict");
  });

  it("starts Google with an optional return_url, sending an empty body when none is given", async () => {
    const stub = fetchStub([
      jsonResponse({ authorization_url: "https://accounts.example.com/o/oauth2/v2/auth?state=x" }),
    ]);
    const start = await publicClient(stub).startGoogle();

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/auth/google/start`);
    expect(stub.lastBody()).toEqual({});
    expect(start.authorization_url).toContain("state=x");

    await publicClient(stub).startGoogle({ return_url: "https://shop.example.com/account" });
    expect(stub.lastBody()).toEqual({ return_url: "https://shop.example.com/account" });
  });
});

describe("the customer surface", () => {
  it("uses the customers prefix for the request and the poll", async () => {
    const stub = fetchStub([
      jsonResponse(requested, 202),
      jsonResponse({ status: "approved", exchange_code: "xc", poll_interval_ms: null }),
    ]);
    const client = publicClient(stub);

    await client.requestCustomerMagicLink({ email: "shopper@example.com" });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/customers/auth/magic-link`);

    const poll = await client.getCustomerMagicLinkStatus("lr_handle");
    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/public/customers/auth/magic-link/lr_handle/status`,
    );
    expect(poll.exchange_code).toBe("xc");
  });

  it("exchanges for a 204 with no body, and answers only the Set-Cookie header", async () => {
    // The T-24 smoke runner assumed a JSON body here and crashed. Nothing is read from the body.
    const stub = fetchStub([emptyResponse({ "set-cookie": customerCookie })]);
    const result = await publicClient(stub).exchangeCustomerMagicLink({
      login_request: "lr_handle",
      exchange_code: "xc_once",
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/customers/auth/magic-link/exchange`);
    expect(result).toEqual({ setCookie: customerCookie });
  });

  it("answers null for the cookie when the runtime withheld it", async () => {
    const stub = fetchStub([emptyResponse()]);
    const result = await publicClient(stub).exchangeCustomerMagicLink({
      login_request: "lr_handle",
      exchange_code: "xc_once",
    });
    expect(result.setCookie).toBeNull();
  });

  it("starts Google against the customers prefix", async () => {
    const stub = fetchStub([jsonResponse({ authorization_url: "https://accounts.example.com/x" })]);
    await publicClient(stub).startCustomerGoogle({ return_url: "https://shop.example.com/a" });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/customers/auth/google/start`);
  });

  it("surfaces login_method_disabled as a 422 that is not retryable", async () => {
    const stub = fetchStub([problemResponse(422, "conflict", { code: "login_method_disabled" })]);
    await expect(
      publicClient(stub).requestCustomerMagicLink({ email: "shopper@example.com" }),
    ).rejects.toMatchObject({ code: "login_method_disabled", retryable: false });
  });
});

describe("invitations", () => {
  it("reads a preview with the key alone", async () => {
    const stub = fetchStub([jsonResponse({ role: "member" })]);
    await publicClient(stub).getInvitation("tok/en");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/invitations/tok%2Fen`);
    expect(stub.lastHeaders()["x-session-token"]).toBeUndefined();
  });

  it("accepts and declines with the person's session in X-Session-Token", async () => {
    const stub = fetchStub([jsonResponse({})]);
    const client = publicClient(stub);

    await client.acceptInvitation("token", testSessionToken);
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/invitations/token/accept`);
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastHeaders()["x-session-token"]).toBe(testSessionToken);
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testPublishableKey}`);

    await client.declineInvitation("token", testSessionToken);
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/public/invitations/token/decline`);
    expect(stub.lastHeaders()["x-session-token"]).toBe(testSessionToken);
  });

  it("surfaces the three invitation codes distinctly", async () => {
    for (const code of ["invitation_consumed", "invitation_revoked", "invitation_expired"]) {
      const stub = fetchStub([problemResponse(409, "conflict", { code })]);
      await expect(publicClient(stub).getInvitation("token")).rejects.toMatchObject({
        code,
        retryable: false,
      });
    }
  });
});

describe("isTerminalLoginStatus", () => {
  it("is false while pending, whatever the interval", () => {
    expect(isTerminalLoginStatus({ status: "pending", poll_interval_ms: 2000 })).toBe(false);
    expect(isTerminalLoginStatus({ status: "pending", poll_interval_ms: 0 })).toBe(false);
  });

  it("is true for every terminal status, because each carries a null interval", () => {
    for (const status of ["approved", "consumed", "expired"]) {
      expect(isTerminalLoginStatus({ status, poll_interval_ms: null })).toBe(true);
    }
  });

  it("stops on a status it has never heard of when the interval is null", () => {
    // data-model.md: treat an unrecognised value as unknown, and stop polling.
    expect(isTerminalLoginStatus({ status: "revoked", poll_interval_ms: null })).toBe(true);
  });

  it("does not read an absent interval as null", () => {
    // The customer surface once omitted the field on approval. `undefined === null` is false, and a
    // predicate that said "stop" here would be asserting something the service did not say.
    const omitted = { status: "approved", exchange_code: "xc" } as unknown as LoginStatus;
    expect(isTerminalLoginStatus(omitted)).toBe(false);
  });
});
