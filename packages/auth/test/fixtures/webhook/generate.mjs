// Regenerates packages/auth/test/fixtures/webhook/*.json.
//
//   node packages/auth/test/fixtures/webhook/generate.mjs
//
// Uses node:crypto deliberately: the fixtures must come from an implementation INDEPENDENT of the one
// under test, which reaches for crypto.subtle only. The algorithm mirrored here is the snippet
// auth-service publishes in webhooks.md §5, which that repository executes against its own signer's
// fixture — so these cases are the same shape as the ones it pins. The committed JSON is the artifact;
// this script is throwaway.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** HMAC-SHA-256 over `${timestamp}.${rawBody}`, hex, behind the prefix the service sends. */
const sign = (timestamp, rawBody) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;

/** A fixed "now", in Unix seconds. */
const now = 1_786_800_000;

/** The estate envelope every event from every Lamido service carries. */
const envelope = (
  eventId,
  eventType,
  occurredAt,
  accountId = "7c2e9f14-6b0a-4d21-9e83-5a1c7d0b2f46",
) => ({
  event_id: eventId,
  event_type: eventType,
  contract_version: 1,
  occurred_at: occurredAt,
  service: "auth-service",
  account_id: accountId,
  tenant: { kind: "organization", public_id: "019f0a10-0000-7000-8000-0000000000b2" },
  correlation_id: eventId,
  causation_id: null,
  hop: 0,
});

/** The documented example from webhooks.md §3, byte for byte in content. */
const subscriptionActivated = JSON.stringify({
  ...envelope(
    "019f0a10-0000-7000-8000-0000000000a1",
    "subscription.activated",
    "2026-08-14T09:14:31.204Z",
  ),
  data: {
    subscription: {
      public_id: "019f0a10-0000-7000-8000-0000000000c3",
      status: "active",
      plan: "starter",
      website: null,
      period_start: "2026-08-01T00:00:00.000Z",
      period_end: "2026-09-01T00:00:00.000Z",
    },
  },
});

/** A customer row appearing. `status` must be read, never assumed from the type. */
const customerCreated = JSON.stringify({
  ...envelope(
    "019f0a10-0000-7000-8000-0000000000a2",
    "customer.created",
    "2026-08-14T09:20:02.110Z",
  ),
  data: { customer: { public_id: "019f0a10-0000-7000-8000-0000000000d4", status: "active" } },
});

// An opted-in customer email with Hungarian accents: the UTF-8 byte length is where a naive HMAC
// diverges.
const accented = JSON.stringify({
  ...envelope(
    "019f0a10-0000-7000-8000-0000000000a3",
    "customer.created",
    "2026-08-14T09:21:45.000Z",
  ),
  data: {
    customer: {
      public_id: "019f0a10-0000-7000-8000-0000000000d5",
      status: "active",
      email: "árvíztűrő.tükörfúrógép@example.com",
    },
  },
});

/** The operator's test delivery: no catalogue, empty data, no account. Signed like a real one. */
const ping = JSON.stringify({
  ...envelope(
    "019f0a10-0000-7000-8000-0000000000a4",
    "webhook.ping",
    "2026-08-14T09:30:00.000Z",
    null,
  ),
  data: {},
});

const cases = [
  {
    name: "valid-subscription-activated",
    describes: "the documented delivery from webhooks.md",
    rawBody: subscriptionActivated,
    expect: { ok: true },
  },
  {
    name: "valid-customer-created",
    describes: "a customer.created, whose status must be read rather than assumed",
    rawBody: customerCreated,
    expect: { ok: true },
  },
  {
    name: "valid-non-ascii",
    describes: "a body with Hungarian accented characters in an opted-in email",
    rawBody: accented,
    expect: { ok: true },
  },
  {
    name: "valid-webhook-ping",
    describes: "the operator's test delivery, signed exactly like a real one",
    rawBody: ping,
    expect: { ok: true },
  },
  {
    name: "bad-signature-secret-without-prefix",
    describes:
      "the digest of the same body under the secret with its whsec_ prefix stripped — the prefix is key material, so this must NOT verify",
    rawBody: subscriptionActivated,
    signature: `sha256=${createHmac("sha256", secret.slice("whsec_".length))
      .update(`${now}.${subscriptionActivated}`, "utf8")
      .digest("hex")}`,
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "bad-signature-tampered-status",
    describes: "the signature of one body presented with another — the status was edited in flight",
    rawBody: subscriptionActivated.replace('"status":"active"', '"status":"canceled"'),
    signature: sign(String(now), subscriptionActivated),
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "stale-timestamp",
    describes: "a correctly signed delivery replayed 301 seconds later, one second past tolerance",
    rawBody: subscriptionActivated,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), subscriptionActivated),
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all",
    rawBody: subscriptionActivated,
    signature: null,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-timestamp",
    describes: "a timestamp that is not a run of digits",
    rawBody: subscriptionActivated,
    timestamp: "not-a-timestamp",
    signature: sign("not-a-timestamp", subscriptionActivated),
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
