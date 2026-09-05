// Regenerates packages/webshop/test/fixtures/webhook/*.json.
//
//   node packages/webshop/test/fixtures/webhook/generate.mjs
//
// Uses node:crypto deliberately: the fixtures must come from an implementation INDEPENDENT of the one
// under test, which reaches for crypto.subtle only. The algorithm mirrored here is the snippet
// webshop-service publishes in webhooks.md §5, which the service's own suite executes against the same
// fixture its signer is held to — so these cases are the same shape as the ones it pins. The committed
// JSON is the artifact; this script is throwaway.
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

/** The order block webhooks.md §3 documents, verbatim. */
const orderBlock = {
  public_id: "019f1c40-0000-7000-8000-0000000000c3",
  status: "confirmed",
  currency: "HUF",
  subtotal: "12000",
  discount_total: "0",
  shipping_total: "1490",
  tax_total: "2854",
  grand_total: "13490",
  shipping_method_name: "Házhoz szállítás",
  shipping_method_price: "1490",
  coupon_code: null,
  coupon_discount: null,
  items: [
    {
      product_public_id: "019f1c40-0000-7000-8000-0000000000d4",
      variant_public_id: "019f1c40-0000-7000-8000-0000000000e5",
      product_name: "Kávébab, 1 kg",
      variant_name: "Sötét pörkölés",
      sku: "COF-DARK-1KG",
      quantity: 1,
      unit_price: "12000",
      discount_total: "0",
      total: "12000",
      currency: "HUF",
    },
  ],
  created_at: "2026-08-17T09:12:02.881Z",
};

/** The estate envelope every event from every Lamido service carries. */
const envelope = (eventId, eventType, occurredAt, chain = {}) => ({
  event_id: eventId,
  event_type: eventType,
  contract_version: 1,
  occurred_at: occurredAt,
  service: "webshop-service",
  account_id: "7c2e9f14-6b0a-4d21-9e83-5a1c7d0b2f46",
  tenant: { kind: "shop", public_id: "019f1c40-0000-7000-8000-0000000000b2" },
  correlation_id: eventId,
  causation_id: null,
  hop: 0,
  ...chain,
});

// The documented example: caused by a payment-service event, so the chain says so.
const orderConfirmed = JSON.stringify({
  ...envelope(
    "019f1c40-0000-7000-8000-0000000000a1",
    "order.confirmed",
    "2026-08-17T09:14:31.204Z",
    {
      correlation_id: "019f1c31-0000-7000-8000-00000000f0a1",
      causation_id: "019f1c31-0000-7000-8000-00000000f0a1",
      hop: 1,
    },
  ),
  data: { order: orderBlock },
});

// The observation: "created" is not a status, so the block's status must be read.
const orderCreated = JSON.stringify({
  ...envelope("019f1c40-0000-7000-8000-0000000000a2", "order.created", "2026-08-17T09:12:02.881Z"),
  data: { order: { ...orderBlock, status: "pending" } },
});

// A product name with Hungarian accents: the UTF-8 byte length is where a naive HMAC diverges.
const accented = JSON.stringify({
  ...envelope("019f1c40-0000-7000-8000-0000000000a3", "order.canceled", "2026-08-17T10:01:00.000Z"),
  data: {
    order: {
      ...orderBlock,
      status: "canceled",
      items: [{ ...orderBlock.items[0], product_name: "Árvíztűrő tükörfúrógép — 1 kg" }],
    },
  },
});

const cases = [
  {
    name: "valid-order-confirmed",
    describes: "the documented delivery, caused by a payment-service event",
    rawBody: orderConfirmed,
    expect: { ok: true },
  },
  {
    name: "valid-order-created",
    describes: "the observation event, whose data.order.status must be read rather than assumed",
    rawBody: orderCreated,
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
    rawBody: orderConfirmed,
    signature: `sha256=${createHmac("sha256", secret.slice("whsec_".length))
      .update(`${now}.${orderConfirmed}`, "utf8")
      .digest("hex")}`,
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "bad-signature-tampered-total",
    describes:
      "the signature of one body presented with another — grand_total was edited in flight",
    rawBody: JSON.stringify({
      ...envelope(
        "019f1c40-0000-7000-8000-0000000000a1",
        "order.confirmed",
        "2026-08-17T09:14:31.204Z",
      ),
      data: { order: { ...orderBlock, grand_total: "1349000" } },
    }),
    signature: sign(String(now), orderConfirmed),
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "stale-timestamp",
    describes: "a correctly signed delivery replayed 301 seconds later, one second past tolerance",
    rawBody: orderConfirmed,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), orderConfirmed),
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all",
    rawBody: orderConfirmed,
    signature: null,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-timestamp",
    describes: "a timestamp that is not a run of digits",
    rawBody: orderConfirmed,
    timestamp: "not-a-timestamp",
    signature: sign("not-a-timestamp", orderConfirmed),
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
