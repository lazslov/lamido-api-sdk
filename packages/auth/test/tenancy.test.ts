import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import {
  authClient,
  collection,
  emptyResponse,
  fetchStub,
  jsonResponse,
  problemResponse,
  testApplicationKey,
  testBaseUrl,
  testSessionToken,
} from "./stubs/fetch.js";

/**
 * The tenancy routes: the ones that take the `ask_` key AND a person's session.
 *
 * @remarks
 * Every case here asserts both credentials reached `fetch`: `Authorization` with the key, and
 * `X-Session-Token` with the session. A session alone is the `401` every first integration hits.
 */

const organizationId = "019f0a10-0000-7000-8000-0000000000b2";
const websiteId = "019f0a10-0000-7000-8000-0000000000e5";

/** Both credentials, on the most recent call. */
function expectBothCredentials(stub: ReturnType<typeof fetchStub>): void {
  expect(stub.lastHeaders().authorization).toBe(`Bearer ${testApplicationKey}`);
  expect(stub.lastHeaders()["x-session-token"]).toBe(testSessionToken);
}

describe("me and sessions", () => {
  it("reads /v1/auth/me with both credentials", async () => {
    const stub = fetchStub([
      jsonResponse({
        user: { email: "person@example.com" },
        memberships: [],
        active_organization: null,
        session: { public_id: "019f-session" },
      }),
    ]);
    const me = await authClient(stub).getMe(testSessionToken);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/auth/me`);
    expectBothCredentials(stub);
    expect(me.active_organization).toBeNull();
    expect(me.memberships).toEqual([]);
  });

  it("logs out with a POST that expects no body", async () => {
    const stub = fetchStub([emptyResponse()]);
    await expect(authClient(stub).logout(testSessionToken)).resolves.toBeUndefined();

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/auth/logout`);
    expect(stub.lastMethod()).toBe("POST");
    expectBothCredentials(stub);
  });

  it("lists sessions as a page and revokes one by public id", async () => {
    const stub = fetchStub([collection([{ public_id: "s1" }]), jsonResponse({})]);
    const client = authClient(stub);

    const page = await client.listSessions(testSessionToken, { limit: 20 });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/sessions?limit=20`);
    expect(page.items).toEqual([{ public_id: "s1" }]);

    await client.revokeSession(testSessionToken, "s1");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/sessions/s1`);
    expect(stub.lastMethod()).toBe("DELETE");
    expectBothCredentials(stub);
  });
});

describe("organizations", () => {
  it("lists, creates, reads and switches", async () => {
    const organization = { public_id: organizationId, name: "Acme Retail" };
    const stub = fetchStub([
      collection([organization]),
      jsonResponse(organization, 201),
      jsonResponse(organization),
      jsonResponse({ active_organization: organization }),
    ]);
    const client = authClient(stub);

    await client.listOrganizations(testSessionToken);
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/organizations`);
    expectBothCredentials(stub);

    await client.createOrganization(testSessionToken, { name: "Acme Retail" });
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastBody()).toEqual({ name: "Acme Retail" });
    expect(stub.lastHeaders()["idempotency-key"]).toBeUndefined();

    await client.getOrganization(testSessionToken, organizationId);
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/organizations/${organizationId}`);

    const switched = await client.switchOrganization(testSessionToken, {
      organization_id: organizationId,
    });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/organizations/switch`);
    expect(stub.lastBody()).toEqual({ organization_id: organizationId });
    expect(switched.active_organization?.name).toBe("Acme Retail");
  });

  it("sends null to the switch to clear the active organization", async () => {
    const stub = fetchStub([jsonResponse({ active_organization: null })]);
    await authClient(stub).switchOrganization(testSessionToken, { organization_id: null });
    expect(stub.lastBody()).toEqual({ organization_id: null });
  });

  it("forwards an idempotency key on a create when the caller supplies one", async () => {
    const stub = fetchStub([jsonResponse({ public_id: organizationId, name: "Acme" }, 201)]);
    await authClient(stub).createOrganization(
      testSessionToken,
      { name: "Acme" },
      { idempotencyKey: idempotencyKey("acme-org-attempt-1") },
    );
    expect(stub.lastHeaders()["idempotency-key"]).toBe("acme-org-attempt-1");
  });

  it("answers a 404, not a 403, for an organization the person is not a member of", async () => {
    const stub = fetchStub([problemResponse(404, "not-found")]);
    await expect(
      authClient(stub).getOrganization(testSessionToken, organizationId),
    ).rejects.toMatchObject({ status: 404, type: "not-found", retryable: false });
  });
});

describe("invitations", () => {
  it("lists, invites and revokes under the organization", async () => {
    const stub = fetchStub([
      collection([{ public_id: "inv", status: "pending" }]),
      jsonResponse({ public_id: "inv", status: "pending" }, 201),
      jsonResponse({}),
    ]);
    const client = authClient(stub);
    const base = `${testBaseUrl}/v1/organizations/${organizationId}/invitations`;

    await client.listInvitations(testSessionToken, organizationId, { cursor: "c" });
    expect(stub.lastUrl()).toBe(`${base}?cursor=c`);

    await client.createInvitation(testSessionToken, organizationId, {
      email: "second@example.com",
      role: "member",
    });
    expect(stub.lastUrl()).toBe(base);
    expect(stub.lastBody()).toEqual({ email: "second@example.com", role: "member" });
    expectBothCredentials(stub);

    await client.revokeInvitation(testSessionToken, organizationId, "inv");
    expect(stub.lastUrl()).toBe(`${base}/inv`);
    expect(stub.lastMethod()).toBe("DELETE");
  });

  it("surfaces a mail-provider 502 as retryable, so the caller can read the listing first", async () => {
    const stub = fetchStub([
      problemResponse(502, "internal", {
        code: "provider_unavailable",
        provider_error: "status_401",
      }),
    ]);
    await expect(
      authClient(stub).createInvitation(testSessionToken, organizationId, {
        email: "second@example.com",
        role: "member",
      }),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      providerError: "status_401",
      retryable: true,
    });
  });
});

describe("websites", () => {
  const website = {
    public_id: websiteId,
    name: "Acme Shop",
    organization: organizationId,
    domains: [],
  };
  const base = `${testBaseUrl}/v1/websites/${websiteId}`;

  it("lists, creates, reads and patches", async () => {
    const stub = fetchStub([
      collection([website]),
      jsonResponse(website, 201),
      jsonResponse(website),
      jsonResponse({ ...website, name: "Acme Shop (EU)" }),
    ]);
    const client = authClient(stub);

    await client.listWebsites(testSessionToken);
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/websites`);
    expectBothCredentials(stub);

    await client.createWebsite(testSessionToken, { name: "Acme Shop" });
    // No organization anywhere in the body or the path: it comes from the session's active one.
    expect(stub.lastBody()).toEqual({ name: "Acme Shop" });

    await client.getWebsite(testSessionToken, websiteId);
    expect(stub.lastUrl()).toBe(base);

    await client.updateWebsite(testSessionToken, websiteId, { name: "Acme Shop (EU)" });
    expect(stub.lastMethod()).toBe("PATCH");
    expect(stub.lastBody()).toEqual({ name: "Acme Shop (EU)" });
  });

  it("surfaces no_active_organization as a 422 that is not retryable", async () => {
    const stub = fetchStub([problemResponse(422, "conflict", { code: "no_active_organization" })]);
    await expect(authClient(stub).listWebsites(testSessionToken)).rejects.toMatchObject({
      code: "no_active_organization",
      retryable: false,
    });
  });

  it("adds, verifies and removes a domain", async () => {
    const domain = {
      public_id: "dom",
      status: "pending",
      verification_record: "_lamido-verify.shop.example.com",
      verification_token: "lamido-verify-EXAMPLE",
      verified_at: null,
      last_checked_at: null,
    };
    const stub = fetchStub([
      collection([domain]),
      jsonResponse(domain, 201),
      jsonResponse({ ...domain, last_checked_at: "2026-08-26T10:00:00.000Z" }),
      jsonResponse({}),
    ]);
    const client = authClient(stub);

    const domains = await client.listDomains(testSessionToken, websiteId);
    expect(stub.lastUrl()).toBe(`${base}/domains`);
    expect(domains).toEqual([domain]);

    await client.addDomain(testSessionToken, websiteId, { domain: "shop.example.com" });
    expect(stub.lastBody()).toEqual({ domain: "shop.example.com" });

    const checked = await client.verifyDomain(testSessionToken, websiteId, "dom");
    expect(stub.lastUrl()).toBe(`${base}/domains/dom/verify`);
    expect(stub.lastMethod()).toBe("POST");
    // A check that found nothing is a 200 with status unchanged, not an error.
    expect(checked.status).toBe("pending");

    await client.removeDomain(testSessionToken, websiteId, "dom");
    expect(stub.lastUrl()).toBe(`${base}/domains/dom`);
    expect(stub.lastMethod()).toBe("DELETE");
  });

  it("mints a key with a required Idempotency-Key and no body, lists, and revokes", async () => {
    const stub = fetchStub([
      jsonResponse(
        { public_id: "k1", last4: "cTf-D", fingerprint: "fp", key: "apk_YOUR_MINTED_KEY_EXAMPLE" },
        201,
      ),
      collection([{ public_id: "k1", last4: "cTf-D", fingerprint: "fp" }]),
      jsonResponse({}),
    ]);
    const client = authClient(stub);

    const minted = await client.mintWebsiteKey(
      testSessionToken,
      websiteId,
      idempotencyKey("2026-08-26-acme-shop-key"),
    );
    expect(stub.lastUrl()).toBe(`${base}/keys`);
    expect(stub.lastMethod()).toBe("POST");
    expect(stub.lastHeaders()["idempotency-key"]).toBe("2026-08-26-acme-shop-key");
    expect(stub.calls.at(-1)?.init.body).toBeUndefined();
    expectBothCredentials(stub);
    expect(minted.key).toBe("apk_YOUR_MINTED_KEY_EXAMPLE");

    const keys = await client.listWebsiteKeys(testSessionToken, websiteId);
    expect(keys).toEqual([{ public_id: "k1", last4: "cTf-D", fingerprint: "fp" }]);

    await client.revokeWebsiteKey(testSessionToken, websiteId, "k1");
    expect(stub.lastUrl()).toBe(`${base}/keys/k1`);
    expect(stub.lastMethod()).toBe("DELETE");
  });

  it("reads and patches login settings and branding", async () => {
    const settings = {
      magic_link_enabled: true,
      google_enabled: false,
      google_client_id: null,
      google_client_secret_last4: null,
      google_client_secret_fingerprint: null,
      redirect_urls: [],
      session_ttl_seconds: null,
    };
    const branding = { sender_name: null, reply_to: null };
    const stub = fetchStub([
      jsonResponse(settings),
      jsonResponse({ ...settings, google_enabled: true }),
      jsonResponse(branding),
      jsonResponse({ sender_name: "Acme Shop", reply_to: "support@example.com" }),
    ]);
    const client = authClient(stub);

    await client.getLoginSettings(testSessionToken, websiteId);
    expect(stub.lastUrl()).toBe(`${base}/login-settings`);

    await client.updateLoginSettings(testSessionToken, websiteId, {
      google_enabled: true,
      google_client_id: "acme-shop.apps.example.com",
      google_client_secret: "GOCSPX-EXAMPLE",
      redirect_urls: ["https://shop.example.com/account"],
    });
    expect(stub.lastMethod()).toBe("PATCH");
    expect(stub.lastBody()).toMatchObject({ google_client_secret: "GOCSPX-EXAMPLE" });

    await client.getBranding(testSessionToken, websiteId);
    expect(stub.lastUrl()).toBe(`${base}/branding`);

    await client.updateBranding(testSessionToken, websiteId, {
      sender_name: "Acme Shop",
      reply_to: "support@example.com",
    });
    expect(stub.lastBody()).toEqual({ sender_name: "Acme Shop", reply_to: "support@example.com" });
    expectBothCredentials(stub);
  });
});
