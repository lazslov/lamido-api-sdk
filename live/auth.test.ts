import {
  type AuthApiError,
  createAuthClient,
  createAuthPublicClient,
  type Principal,
} from "@lazslov/auth";
import { describe, expect, it } from "vitest";
import { authTarget, failure, skipReason } from "./config.js";

/**
 * auth-service, live.
 *
 * @remarks
 * **Nothing here signs anybody in, and nothing here asks for a magic link.** A link goes to a real
 * mailbox and each request spends the per-address budget of five per fifteen minutes *whether or not
 * anything is sent* — so a probe that asks for one costs a real person their next sign-in. There is
 * also no way to obtain a session token from this API, so an `allow` decision cannot be rehearsed at
 * all; every case here is a refusal the knowledge base documents, and the assertion is about *which*
 * refusal arrives. A success is a finding, not a skip: `failure()` throws when the service accepts
 * the request.
 *
 * Both keys are exercised — the `apk_` browser tier and the `ask_` client tier — because the two are
 * separate credential systems and a suite that only proved one would not notice the other's tenant
 * moving.
 */

/** A well-formed UUIDv7 that belongs to nobody. */
const strangerId = "0194c7a1-0000-7000-8000-000000000000";

/**
 * A login handle that matches nothing.
 *
 * @remarks
 * Shaped like the real thing — 24 bytes of CSPRNG output, base64url — so the `404` is the lookup's
 * answer rather than a format check's.
 */
const strangerHandle = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * The principal form the service removed on 2026-08-24.
 *
 * @remarks
 * `Principal` declares `session_token` and nothing else, so this shape is a compile error by design —
 * `test/type-safety.test.ts` asserts that. The cast is what lets the live suite prove the *service*
 * still refuses it, which is the half a type cannot check.
 */
const removedPrincipalForm = {
  kind: "user",
  public_id: strangerId,
} as unknown as Principal;

describe.skipIf(!authTarget.ready)("auth-service live", () => {
  const client = (extra: Record<string, unknown> = {}) =>
    createAuthClient({
      baseUrl: authTarget.baseUrl,
      apiKey: authTarget.keys.application,
      ...extra,
    });

  const browser = (extra: Record<string, unknown> = {}) =>
    createAuthPublicClient({
      baseUrl: authTarget.baseUrl,
      apiKey: authTarget.keys.publishable,
      ...extra,
    });

  it("rejects an unknown application key with a 401", async () => {
    // A GET, so nothing is created even if the key were somehow accepted. An unknown key, a revoked
    // key and a deactivated tenant are byte-identical here, so nothing tries to tell them apart.
    const error = await failure<AuthApiError>(() =>
      client({ apiKey: "ask_YOUR_UNKNOWN_KEY_probe00" }).listPlans(),
    );

    expect(error.status).toBe(401);
    expect(error.type).toBe("unauthorized");
    // Every 401 body is byte-identical and carries no `code`. A code appearing here would mean the
    // service had started to explain which credential failed, which is the oracle it refuses to be.
    expect(error.code).toBeUndefined();
  });

  it("rejects a request carrying an Origin header BEFORE authenticating it", async () => {
    // The tripwire's *ordering* is the assertion, so this goes out with a deliberately wrong key: a
    // 403 proves Origin was checked first, and a 401 would prove it was not.
    const error = await failure<AuthApiError>(() =>
      client({
        apiKey: "ask_YOUR_WRONG_KEY_probe0000",
        defaultInit: { headers: { Origin: "https://attacker.example.com" } },
      }).listPlans(),
    );

    expect(error.status).toBe(403);
    expect(error.type).toBe("forbidden");
  });

  it("answers 404 for a customer id this key's organization does not own", async () => {
    // Another organization's customer is a 404, never a 403, so an id cannot be probed for
    // existence — which is why the SDK never maps a 404 here to null. The advice on the error is
    // what stops "not found" being read as "not created yet".
    const error = await failure<AuthApiError>(() =>
      client().getCustomer(strangerId, { website: strangerId }),
    );

    expect(error.status).toBe(404);
    expect(error.type).toBe("not-found");
    expect(error.message).toMatch(/another tenant/);
  });

  it("answers 404 for a login handle minted on another website", async () => {
    // The browser tier, with the real `apk_` key. A handle is scoped to the website whose key minted
    // it, so polling one with a different website's key matches nothing — and since 2026-08-27 that
    // is a 404 rather than a `pending` that never ends. A 400 here would mean the handle's format is
    // validated before the lookup, which is a finding rather than a flake.
    const error = await failure<AuthApiError>(() => browser().getMagicLinkStatus(strangerHandle));

    expect(error.status).toBe(404);
    expect(error.type).toBe("not-found");
  });

  it("refuses the removed { kind, public_id } principal with a 400 that decides nothing", async () => {
    // The form let any holder of the `ask_` key obtain a decision for any principal in the
    // organization with no proof of a session. It is a 400 naming `public_id` rather than a `deny`,
    // because a deny would suggest the permission model changed. The request writes nothing and
    // resolves no principal, so it is safe to send against a real tenant.
    const error = await failure<AuthApiError>(() =>
      client().authorize({
        principal: removedPrincipalForm,
        organization_id: strangerId,
        permission: "sdk.live.probe",
      }),
    );

    expect(error.status).toBe(400);
    expect(error.type).toBe("validation");
  });
});

describe.skipIf(authTarget.ready)("auth-service live (skipped)", () => {
  it("reports why", () => {
    console.info(`  ${skipReason(authTarget)}`);
    expect(authTarget.ready).toBe(false);
  });
});
