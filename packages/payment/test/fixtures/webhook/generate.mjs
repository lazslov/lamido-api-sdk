// Regenerates packages/payment/test/fixtures/webhook/*.json.
//
//   node packages/payment/test/fixtures/webhook/generate.mjs
//
// Uses node:crypto deliberately: the fixtures must come from an implementation INDEPENDENT of the one
// under test, which reaches for crypto.subtle only. The algorithm mirrored here is the snippet
// payment-service publishes in merchant-api.md, which that repository drift-tests against its own
// signer — so these cases are the same shape as the ones it pins. The committed JSON is the artifact;
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
const now = 1_785_168_000;

const paymentBlock = {
  public_id: "019e4a91-0000-7000-8000-000000000003",
  merchant_payment_ref: "order-12345",
  status: "succeeded",
  amount_minor: "1000",
  currency: "HUF",
  provider: "barion",
};

/** The estate envelope every event from every Lamido service carries. */
const envelope = (eventId, eventType, occurredAt) => ({
  event_id: eventId,
  event_type: eventType,
  contract_version: 1,
  occurred_at: occurredAt,
  service: "payment-service",
  account_id: "7c2e9f14-6b0a-4d21-9e83-5a1c7d0b2f46",
  tenant: { kind: "merchant", public_id: "019e4a91-0000-7000-8000-000000000002" },
  correlation_id: eventId,
  causation_id: null,
  hop: 0,
});

const paymentSucceeded = JSON.stringify({
  ...envelope(
    "019e4a91-0000-7000-8000-000000000001",
    "payment.succeeded",
    "2026-01-21T12:53:20.000Z",
  ),
  data: { payment: paymentBlock },
});

const refundSucceeded = JSON.stringify({
  ...envelope(
    "019e4a95-0000-7000-8000-000000000004",
    "refund.succeeded",
    "2026-01-21T13:02:11.140Z",
  ),
  data: {
    payment: { ...paymentBlock, status: "partially_refunded" },
    refund: {
      public_id: "019e4a95-77c1-7a02-8f31-9b0c4d5e6f70",
      status: "succeeded",
      amount_minor: "400",
      currency: "HUF",
    },
  },
});

// A merchant reference with Hungarian accents: the UTF-8 byte length is where a naive HMAC diverges.
const accented = JSON.stringify({
  ...envelope("019e4a91-0000-7000-8000-000000000005", "payment.failed", "2026-01-21T12:53:20.000Z"),
  data: {
    payment: {
      ...paymentBlock,
      merchant_payment_ref: "Árvíztűrő tükörfúrógép — 12345",
      status: "failed",
    },
  },
});

const cases = [
  {
    name: "valid-payment-succeeded",
    describes: "the ordinary delivery",
    rawBody: paymentSucceeded,
    expect: { ok: true },
  },
  {
    name: "valid-refund-succeeded",
    describes: "a refund event, which carries the extra refund block and the payment's NEW status",
    rawBody: refundSucceeded,
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
    rawBody: paymentSucceeded,
    signature: `sha256=${createHmac("sha256", secret.slice("whsec_".length))
      .update(`${now}.${paymentSucceeded}`, "utf8")
      .digest("hex")}`,
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "bad-signature-tampered-amount",
    describes: "the signature of one body presented with another — the amount was edited in flight",
    rawBody: JSON.stringify({
      ...envelope(
        "019e4a91-0000-7000-8000-000000000001",
        "payment.succeeded",
        "2026-01-21T12:53:20.000Z",
      ),
      data: { payment: { ...paymentBlock, amount_minor: "100000" } },
    }),
    signature: sign(String(now), paymentSucceeded),
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "stale-timestamp",
    describes: "a correctly signed delivery replayed 301 seconds later, one second past tolerance",
    rawBody: paymentSucceeded,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), paymentSucceeded),
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all",
    rawBody: paymentSucceeded,
    signature: null,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-timestamp",
    describes: "a timestamp that is not a run of digits",
    rawBody: paymentSucceeded,
    timestamp: "not-a-timestamp",
    signature: sign("not-a-timestamp", paymentSucceeded),
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
