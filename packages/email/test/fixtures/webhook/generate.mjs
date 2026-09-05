// Regenerates packages/email/test/fixtures/webhook/*.json.
//
//   node packages/email/test/fixtures/webhook/generate.mjs
//
// Uses node:crypto deliberately: the fixtures must come from an implementation INDEPENDENT of the one
// under test, which reaches for crypto.subtle only. The algorithm mirrored here is the snippet
// email-service publishes in webhooks.md §3 — HMAC-SHA-256 over `${timestamp}.${raw body}`, the whole
// `whsec_` secret as the key, a 300-second window. The envelope and the data block follow the example
// in webhooks.md §2. The committed JSON is the artifact; this script is throwaway.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** HMAC-SHA-256 over `${timestamp}.${rawBody}`, hex, behind the prefix the service sends. */
const sign = (timestamp, rawBody) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;

/** A fixed "now", in Unix seconds. */
const now = 1_785_168_000;

/** The message block, as webhooks.md §2 shows it. `to` is absent: the endpoint did not opt in. */
const messageBlock = {
  public_id: "0194c7a1-0000-7000-8000-000000000002",
  status: "delivered",
  template: { key: "order.confirmation", version: 1 },
  metadata: { order_id: "A-2291" },
};

/** The estate envelope every event from every Lamido service carries. */
const envelope = (eventId, eventType, occurredAt) => ({
  schema_version: 1,
  event_id: eventId,
  event_type: eventType,
  occurred_at: occurredAt,
  service: "email-service",
  account_id: "acct_EXAMPLE",
  correlation_id: "0194c7a1-0000-7000-8000-000000000001",
  hop: 0,
});

const messageDelivered = JSON.stringify({
  ...envelope(
    "0194c7a1-8f3e-7a2b-9c4d-1e5f6a7b8c9d",
    "message.delivered",
    "2026-08-09T09:14:09.412Z",
  ),
  data: messageBlock,
});

// An endpoint that opted in to the recipient address, on a bounce that also wrote a suppression.
const messageBounced = JSON.stringify({
  ...envelope(
    "0194c7a2-0000-7000-8000-000000000003",
    "message.bounced",
    "2026-08-09T09:20:00.000Z",
  ),
  data: { ...messageBlock, status: "bounced", to: "guest@example.com" },
});

// The connectivity test: an operator's `POST …/test`, carrying no message.
const ping = JSON.stringify({
  ...envelope("0194c7a3-0000-7000-8000-000000000004", "webhook.ping", "2026-08-09T09:00:00.000Z"),
  data: {},
});

// Metadata with Hungarian accents: the UTF-8 byte length is where a naive HMAC diverges.
const accented = JSON.stringify({
  ...envelope("0194c7a4-0000-7000-8000-000000000005", "message.sent", "2026-08-09T09:14:05.882Z"),
  data: {
    ...messageBlock,
    status: "sent",
    metadata: { order_id: "A-2291", note: "Árvíztűrő tükörfúrógép — 12345" },
  },
});

const cases = [
  {
    name: "valid-message-delivered",
    describes: "the ordinary delivery",
    rawBody: messageDelivered,
    expect: { ok: true },
  },
  {
    name: "valid-message-bounced-with-recipient",
    describes: "a bounce, from an endpoint that opted in to the recipient address",
    rawBody: messageBounced,
    expect: { ok: true },
  },
  {
    name: "valid-webhook-ping",
    describes: "the connectivity test, which carries no message",
    rawBody: ping,
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
    rawBody: messageDelivered,
    signature: `sha256=${createHmac("sha256", secret.slice("whsec_".length))
      .update(`${now}.${messageDelivered}`, "utf8")
      .digest("hex")}`,
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "bad-signature-tampered-status",
    describes: "the signature of one body presented with another — the status was edited in flight",
    rawBody: JSON.stringify({
      ...envelope(
        "0194c7a1-8f3e-7a2b-9c4d-1e5f6a7b8c9d",
        "message.delivered",
        "2026-08-09T09:14:09.412Z",
      ),
      data: { ...messageBlock, status: "bounced" },
    }),
    signature: sign(String(now), messageDelivered),
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "stale-timestamp",
    describes: "a correctly signed delivery replayed 301 seconds later, one second past tolerance",
    rawBody: messageDelivered,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), messageDelivered),
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all",
    rawBody: messageDelivered,
    signature: null,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-timestamp",
    describes: "a timestamp that is not a run of digits",
    rawBody: messageDelivered,
    timestamp: "not-a-timestamp",
    signature: sign("not-a-timestamp", messageDelivered),
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
