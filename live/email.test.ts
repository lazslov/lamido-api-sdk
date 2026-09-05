import { createEmailClient, type EmailApiError } from "@lazslov/email";
import { describe, expect, it } from "vitest";
import { emailTarget, failure, skipReason } from "./config.js";

/**
 * email-service, live.
 *
 * @remarks
 * **Nothing here sends a message, ever.** There is no unsend, a queued message reaches a real
 * mailbox, and a `202` from a probe is a customer-visible email — so every case is a refusal the
 * knowledge base documents, and the assertion is about *which* refusal arrives. A success is a
 * finding, not a skip: `failure()` throws when the service accepts the request.
 *
 * The one write-shaped call, the OAuth start, is sent with a `return_url` the service must refuse
 * at the start — before any state is minted — so a `400` proves the check and creates nothing.
 */

/** An id that is well-formed and belongs to nobody. */
const strangerId = "0194c7a1-0000-7000-8000-000000000000";

describe.skipIf(!emailTarget.ready)("email-service live", () => {
  const client = (extra: Record<string, unknown> = {}) =>
    createEmailClient({
      baseUrl: emailTarget.baseUrl,
      apiKey: emailTarget.keys.api,
      ...extra,
    });

  it("rejects an unknown key with a 401", async () => {
    // An unknown key, a revoked key and a deactivated tenant are byte-identical, so nothing here
    // can — or tries to — tell them apart.
    const error = await failure<EmailApiError>(() =>
      client({ apiKey: "esk_YOUR_UNKNOWN_KEY_probe00" }).getMessage(strangerId),
    );

    expect(error.status).toBe(401);
    expect(error.type).toBe("unauthorized");
  });

  it("rejects a request carrying an Origin header BEFORE authenticating it", async () => {
    // The tripwire's *ordering* is the assertion, so this goes out with a deliberately wrong key: a
    // 403 proves Origin was checked first, and a 401 would prove it was not.
    const error = await failure<EmailApiError>(() =>
      client({
        apiKey: "esk_YOUR_WRONG_KEY_probe0000",
        defaultInit: { headers: { Origin: "https://attacker.example.com" } },
      }).getMessage(strangerId),
    );

    expect(error.status).toBe(403);
  });

  it("answers 404 for a message id this tenant does not own", async () => {
    // Another tenant's message is a 404, never a 403, so an id cannot be probed for existence —
    // which is why the SDK never maps a 404 here to null.
    const error = await failure<EmailApiError>(() => client().getMessage(strangerId));

    expect(error.status).toBe(404);
    expect(error.type).toBe("not-found");
    expect(error.message).toMatch(/different tenant/);
  });

  it("rejects an out-of-range limit with a 400, never a clamp", async () => {
    // A GET, so it creates nothing — and it proves the list validates rather than silently
    // clamping, which is what the SDK's doc comment promises.
    const error = await failure<EmailApiError>(() => client().listMessages({ limit: 0 }));

    expect(error.status).toBe(400);
    expect(error.type).toBe("validation");
  });

  it("refuses an OAuth start whose return_url is not under the service, at the start", async () => {
    // Validated here rather than at the callback, deliberately: the refusal reaches whoever typed
    // it while the flow is still theirs to fix. A 400 mints no state and connects nothing.
    const error = await failure<EmailApiError>(() =>
      client().startGoogleOauth({
        config_id: "sdk_live_probe",
        return_url: "https://attacker.example.com/connected",
      }),
    );

    expect(error.status).toBe(400);
    expect(error.type).toBe("validation");
  });
});

describe.skipIf(emailTarget.ready)("email-service live (skipped)", () => {
  it("reports why", () => {
    console.info(`  ${skipReason(emailTarget)}`);
    expect(emailTarget.ready).toBe(false);
  });
});
