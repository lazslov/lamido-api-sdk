// Regenerates packages/booking/test/fixtures/webhook/*.json.
//
//   node packages/booking/test/fixtures/webhook/generate.mjs
//
// Uses node:crypto deliberately: the fixtures must come from an implementation INDEPENDENT of the one
// under test, which reaches for crypto.subtle only. The algorithm mirrored here is the snippet
// booking-service publishes in webhooks.md, which that repository extracts and executes against its
// own signature fixture on every build — so these cases are the same shape as the ones it pins. The
// committed JSON is the artifact; this script is throwaway.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** HMAC-SHA-256 over `${timestamp}.${rawBody}`, hex, behind the prefix the service sends. */
const sign = (timestamp, rawBody) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;

/** A fixed "now", in Unix seconds. */
const now = 1_789_000_000;

/** The `data` block webhooks.md documents for a booking event, minus the opt-in customer block. */
const dataBlock = {
  booking: {
    public_id: "019e5c31-0000-7000-8000-000000000106",
    status: "confirmed",
    pending_reason: null,
    starts_at: "2026-09-14T08:00:00.000Z",
    ends_at: "2026-09-14T08:45:00.000Z",
    timezone: "Europe/Budapest",
    cancellation_reason: null,
    rescheduled_from_id: null,
  },
  location: { public_id: "019e5c31-0000-7000-8000-000000000101" },
  service: {
    public_id: "019e5c31-0000-7000-8000-000000000102",
    price_minor: "4500",
    currency: "HUF",
  },
  employee: { public_id: "019e5c31-0000-7000-8000-000000000103" },
};

/** The estate envelope every event from every Lamido service carries. */
const envelope = (eventId, eventType, occurredAt) => ({
  event_id: eventId,
  event_type: eventType,
  contract_version: 1,
  occurred_at: occurredAt,
  service: "booking-service",
  account_id: "acct_EXAMPLE",
  tenant: { kind: "tenant", public_id: "019e5c31-0000-7000-8000-000000000100" },
  correlation_id: eventId,
  causation_id: null,
  hop: 0,
});

const bookingConfirmed = JSON.stringify({
  ...envelope(
    "019e5c31-0000-7000-8000-0000000001a0",
    "booking.confirmed",
    "2026-09-14T07:02:00.000Z",
  ),
  data: dataBlock,
});

// A canceled-by-expiry event, with the customer block an `include_customer: true` endpoint receives.
const bookingCanceledWithCustomer = JSON.stringify({
  ...envelope(
    "019e5c31-0000-7000-8000-0000000001a1",
    "booking.canceled",
    "2026-09-14T07:10:00.000Z",
  ),
  data: {
    ...dataBlock,
    booking: {
      ...dataBlock.booking,
      status: "canceled",
      cancellation_reason: "system_pending_expired",
    },
    customer: {
      public_id: "019e5c31-0000-7000-8000-000000000104",
      name: "Anna Kovács",
      email: "anna@example.com",
      phone: "+36301234567",
    },
  },
});

// A customer name with Hungarian accents: the UTF-8 byte length is where a naive HMAC diverges.
const accented = JSON.stringify({
  ...envelope(
    "019e5c31-0000-7000-8000-0000000001a2",
    "booking.reminder_reached",
    "2026-09-13T08:00:00.000Z",
  ),
  data: {
    ...dataBlock,
    customer: {
      public_id: "019e5c31-0000-7000-8000-000000000104",
      name: "Árvíztűrő Tükörfúrógép",
      email: "arvizturo@example.com",
      phone: null,
    },
  },
});

const cases = [
  {
    name: "valid-booking-confirmed",
    describes: "the ordinary delivery",
    rawBody: bookingConfirmed,
    expect: { ok: true },
  },
  {
    name: "valid-booking-canceled-with-customer",
    describes:
      "a pending expiry, which arrives as booking.canceled with system_pending_expired, carrying the opt-in customer block",
    rawBody: bookingCanceledWithCustomer,
    expect: { ok: true },
  },
  {
    name: "valid-non-ascii",
    describes: "a body with Hungarian accented characters",
    rawBody: accented,
    expect: { ok: true },
  },
  {
    name: "bad-signature-secret-without-prefix",
    describes:
      "the digest of the same body under the secret with its whsec_ prefix stripped — the prefix is key material, so this must NOT verify",
    rawBody: bookingConfirmed,
    signature: `sha256=${createHmac("sha256", secret.slice("whsec_".length))
      .update(`${now}.${bookingConfirmed}`, "utf8")
      .digest("hex")}`,
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "bad-signature-tampered-status",
    describes: "the signature of one body presented with another — the status was edited in flight",
    rawBody: JSON.stringify({
      ...envelope(
        "019e5c31-0000-7000-8000-0000000001a0",
        "booking.confirmed",
        "2026-09-14T07:02:00.000Z",
      ),
      data: { ...dataBlock, booking: { ...dataBlock.booking, status: "canceled" } },
    }),
    signature: sign(String(now), bookingConfirmed),
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "stale-timestamp",
    describes: "a correctly signed delivery replayed 301 seconds later, one second past tolerance",
    rawBody: bookingConfirmed,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), bookingConfirmed),
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all",
    rawBody: bookingConfirmed,
    signature: null,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-timestamp",
    describes: "a timestamp that is not a run of digits",
    rawBody: bookingConfirmed,
    timestamp: "not-a-timestamp",
    signature: sign("not-a-timestamp", bookingConfirmed),
    expect: { ok: false, reason: "malformed_timestamp" },
  },
];

const dir = path.dirname(fileURLToPath(import.meta.url));

for (const testCase of cases) {
  const timestamp = testCase.timestamp ?? String(now);
  const fixture = {
    name: testCase.name,
    describes: testCase.describes,
    secret,
    rawBody: testCase.rawBody,
    timestamp,
    signature:
      testCase.signature === undefined ? sign(timestamp, testCase.rawBody) : testCase.signature,
    nowSeconds: now,
    expect: testCase.expect,
  };
  writeFileSync(
    path.join(dir, `${testCase.name}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8",
  );
}
