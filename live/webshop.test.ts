import { createWebshopClient, type WebshopApiError } from "@lazslov/webshop";
import { describe, expect, it } from "vitest";
import { failure, skipReason, webshopTarget } from "./config.js";

/**
 * webshop-service, live.
 *
 * @remarks
 * **Nothing here creates a cart and nothing here checks out, ever.** A checkout commits an order
 * that holds real stock, and a `429` or a `502` from it commits one *as well* — so even a probe
 * that fails can take a shop's last unit off the shelf until the next daily sweep returns it. Every
 * case below is a `GET` or a refusal the knowledge base documents, and the assertion is about
 * *which* refusal arrives. A success is a finding, not a skip: `failure()` throws when the service
 * accepts the request.
 *
 * The two `403` cases are the pair worth having. One proves the browser tripwire runs **before**
 * the key lookup; the other proves the path names the credential. Together they say a `403` on this
 * service is always "provably identified, wrong door".
 */

/** An id that is well-formed and belongs to nobody. */
const strangerId = "0194c7a1-0000-7000-8000-000000000000";

describe.skipIf(!webshopTarget.ready)("webshop-service live", () => {
  const client = (extra: Record<string, unknown> = {}) =>
    createWebshopClient({
      baseUrl: webshopTarget.baseUrl,
      apiKey: webshopTarget.keys.secret,
      ...extra,
    });

  it("rejects an unknown key with a 401", async () => {
    // An unknown key, a revoked key and a suspended shop are byte-identical here — the service
    // refuses to be a key-validity oracle — so nothing tries to tell them apart.
    const error = await failure<WebshopApiError>(() =>
      client({ apiKey: "wsk_YOUR_UNKNOWN_KEY_probe0" }).getOrder(strangerId),
    );

    expect(error.status).toBe(401);
    expect(error.type).toBe("unauthorized");
  });

  it("rejects a request carrying an Origin header BEFORE authenticating it", async () => {
    // The tripwire's *ordering* is the assertion, so this goes out with a deliberately wrong key: a
    // 403 proves Origin was checked first, and a 401 would prove it was not.
    const error = await failure<WebshopApiError>(() =>
      client({
        apiKey: "wsk_YOUR_WRONG_KEY_probe000",
        defaultInit: { headers: { Origin: "https://attacker.example.com" } },
      }).getOrder(strangerId),
    );

    expect(error.status).toBe(403);
  });

  it("refuses a publishable key on the storefront tier with a 403, not a 401", async () => {
    // The path names the credential. This key is real and valid, so the 403 also proves the guard
    // order the other way round: the lookup succeeded and the tier check is what refused.
    const error = await failure<WebshopApiError>(() =>
      client({ apiKey: webshopTarget.keys.publishable }).getMe(),
    );

    expect(error.status).toBe(403);
    expect(error.type).toBe("forbidden");
  });

  it("answers 404 for an order id this shop does not own", async () => {
    // Another shop's row is a 404, never a 403 — a 403 would confirm the row exists — which is why
    // the SDK never maps a 404 here to null, and why the advice names the key.
    const error = await failure<WebshopApiError>(() => client().getOrder(strangerId));

    expect(error.status).toBe(404);
    expect(error.type).toBe("not-found");
    expect(error.message).toMatch(/WEBSHOP_SECRET_KEY/);
  });

  it("rejects a loose date filter with a 400, never a widened window", async () => {
    // A GET, so it creates nothing. `?from=2026` was a silently widened window before the service's
    // `18c4a9a`; it is now a documented 400, and this is the case that notices if it ever loosens
    // again — a query that answers 200 here is reading a range nobody asked for.
    const error = await failure<WebshopApiError>(() => client().listOrders({ from: "2026" }));

    expect(error.status).toBe(400);
    expect(error.type).toBe("validation");
  });
});

describe.skipIf(webshopTarget.ready)("webshop-service live (skipped)", () => {
  it("reports why", () => {
    console.info(`  ${skipReason(webshopTarget)}`);
    expect(webshopTarget.ready).toBe(false);
  });
});
