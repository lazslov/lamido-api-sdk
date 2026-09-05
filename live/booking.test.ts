import {
  type BookingApiError,
  createBookingClient,
  createBookingPublicClient,
} from "@lazslov/booking";
import { describe, expect, it } from "vitest";
import { bookingTarget, failure, skipReason } from "./config.js";

/**
 * booking-service, live.
 *
 * @remarks
 * **Nothing here creates anything** — no hold, no booking, no reschedule, no cancellation. A
 * booking is an appointment in a real diary, a hold takes a slot away from a real customer for ten
 * minutes, and neither has an undo that leaves no trace. So every case is a refusal the knowledge
 * base documents, and the assertion is about *which* refusal arrives. A success is a finding, not a
 * skip: `failure()` throws when the service accepts the request.
 *
 * The four cases are the ones a keyless build cannot prove: that an unknown key is refused, that
 * the browser tripwire runs **before** authentication, that another tenant's booking is invisible
 * rather than forbidden, and that a malformed window is refused rather than coerced.
 */

/** An id that is well-formed and belongs to nobody. */
const strangerId = "0194c7a1-0000-7000-8000-000000000000";

describe.skipIf(!bookingTarget.ready)("booking-service live", () => {
  const tenant = (extra: Record<string, unknown> = {}) =>
    createBookingClient({
      baseUrl: bookingTarget.baseUrl,
      apiKey: bookingTarget.keys.secret,
      ...extra,
    });

  const browser = () =>
    createBookingPublicClient({
      baseUrl: bookingTarget.baseUrl,
      apiKey: bookingTarget.keys.publishable,
    });

  it("rejects an unknown secret key with a 401", async () => {
    // `getMe` is a credential check that touches nothing. A revoked key and a deactivated tenant
    // answer byte-identically, deliberately, so nothing here can — or tries to — tell them apart.
    const error = await failure<BookingApiError>(() =>
      tenant({ apiKey: "bsk_YOUR_UNKNOWN_KEY_probe00" }).getMe(),
    );

    expect(error.status).toBe(401);
    expect(error.type).toBe("unauthorized");
  });

  it("rejects a tenant-tier request carrying an Origin header BEFORE authenticating it", async () => {
    // The tripwire's *ordering* is the assertion, so this goes out with a deliberately wrong key: a
    // 403 proves Origin was checked first, and a 401 would prove it was not. The service presumes a
    // `bsk_` seen in a browser is burned, which is only worth doing if the check precedes the key.
    const error = await failure<BookingApiError>(() =>
      tenant({
        apiKey: "bsk_YOUR_WRONG_KEY_probe0000",
        defaultInit: { headers: { Origin: "https://attacker.example.com" } },
      }).getMe(),
    );

    expect(error.status).toBe(403);
  });

  it("answers 404 for a booking id this tenant does not own", async () => {
    // Every read is scoped to the key's tenant inside the query, so another tenant's booking is a
    // 404 and never a 403 — an id cannot be probed for existence. That is why the SDK maps a 404
    // here to an error and never to null.
    const error = await failure<BookingApiError>(() => tenant().getBooking(strangerId));

    expect(error.status).toBe(404);
    expect(error.type).toBe("not-found");
  });

  it("rejects an unparseable availability window with a 400, never a coercion", async () => {
    // A GET on the public tier, so it holds nothing and books nothing. The window is validated
    // before the service is looked up, so an id that belongs to nobody still yields the 400 this
    // case is about rather than a 404 about the service.
    const error = await failure<BookingApiError>(() =>
      browser().getAvailability({
        service_id: strangerId,
        from: "14-09-2026",
        until: "2026-09-15",
      }),
    );

    expect(error.status).toBe(400);
    expect(error.type).toBe("validation");
  });
});

describe.skipIf(bookingTarget.ready)("booking-service live (skipped)", () => {
  it("reports why", () => {
    console.info(`  ${skipReason(bookingTarget)}`);
    expect(bookingTarget.ready).toBe(false);
  });
});
