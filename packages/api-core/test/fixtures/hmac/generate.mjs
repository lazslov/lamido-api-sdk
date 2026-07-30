// Throwaway generator for packages/api-core/test/fixtures/hmac/*.json.
//
// Uses node:crypto deliberately: the fixtures must be produced by an implementation
// INDEPENDENT of the one under test (which uses crypto.subtle only). If both sides shared
// code, the fixtures would prove nothing.
import { createHmac } from "node:crypto";

const secret = "whsec_EXAMPLE_TEST_SECRET_0123456789";

/** The signed string both services use, and the header encoding they both expect. */
const sign = (timestamp, rawBody) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;

const asciiBody = JSON.stringify({ event: "page.published", slug: "about" });
const unicodeBody = JSON.stringify({
  event: "invoice.issued",
  buyer: "Árvíztűrő Tükörfúrógép Kft.",
  note: "Öt szép szűzlány őrült írót nyúz",
});

// A fixed "now" so every case is deterministic; timestamps are Unix seconds.
const now = 1_770_000_000;

const cases = [
  {
    name: "valid-ascii",
    describes: "the happy path",
    secret,
    rawBody: asciiBody,
    timestamp: String(now),
    signature: sign(String(now), asciiBody),
    nowSeconds: now,
    expect: { ok: true },
  },
  {
    name: "valid-unicode",
    describes:
      "a body with Hungarian accented characters — UTF-8 byte length is where a naive implementation diverges",
    secret,
    rawBody: unicodeBody,
    timestamp: String(now),
    signature: sign(String(now), unicodeBody),
    nowSeconds: now,
    expect: { ok: true },
  },
  {
    name: "valid-leading-zero-timestamp",
    describes:
      "a timestamp with a leading zero: it must enter the digest as the string it arrived as, not Number() re-stringified",
    secret,
    rawBody: asciiBody,
    timestamp: `0${now}`,
    signature: sign(`0${now}`, asciiBody),
    nowSeconds: now,
    expect: { ok: true },
  },
  {
    name: "missing-signature",
    describes: "no signature header at all",
    secret,
    rawBody: asciiBody,
    timestamp: String(now),
    signature: null,
    nowSeconds: now,
    expect: { ok: false, reason: "missing_signature" },
  },
  {
    name: "malformed-timestamp",
    describes: "a timestamp that is not a run of digits",
    secret,
    rawBody: asciiBody,
    timestamp: "not-a-timestamp",
    signature: sign("not-a-timestamp", asciiBody),
    nowSeconds: now,
    expect: { ok: false, reason: "malformed_timestamp" },
  },
  {
    name: "stale-timestamp-past",
    describes: "a correctly signed body replayed 301 seconds later — one second past tolerance",
    secret,
    rawBody: asciiBody,
    timestamp: String(now - 301),
    signature: sign(String(now - 301), asciiBody),
    nowSeconds: now,
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "stale-timestamp-future",
    describes: "skew in the other direction, which must be rejected just as firmly",
    secret,
    rawBody: asciiBody,
    timestamp: String(now + 301),
    signature: sign(String(now + 301), asciiBody),
    nowSeconds: now,
    expect: { ok: false, reason: "stale_timestamp" },
  },
  {
    name: "bad-signature-one-byte",
    describes: "a valid signature with a single hex digit changed",
    secret,
    rawBody: asciiBody,
    timestamp: String(now),
    signature: (() => {
      const valid = sign(String(now), asciiBody);
      const last = valid.at(-1);
      return valid.slice(0, -1) + (last === "0" ? "1" : "0");
    })(),
    nowSeconds: now,
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "bad-signature-tampered-body",
    describes: "the signature of one body presented with another",
    secret,
    rawBody: JSON.stringify({ event: "page.published", slug: "pricing" }),
    timestamp: String(now),
    signature: sign(String(now), asciiBody),
    nowSeconds: now,
    expect: { ok: false, reason: "bad_signature" },
  },
  {
    name: "bad-signature-truncated-secret",
    describes:
      "the digest of the same body under the secret with its whsec_ prefix stripped — the prefix is key material, so this must NOT verify",
    secret,
    rawBody: asciiBody,
    timestamp: String(now),
    signature: `sha256=${createHmac("sha256", secret.slice("whsec_".length))
      .update(`${now}.${asciiBody}`)
      .digest("hex")}`,
    nowSeconds: now,
    expect: { ok: false, reason: "bad_signature" },
  },
];

for (const testCase of cases) {
  process.stdout.write(`${JSON.stringify(testCase, null, 2)}\n---FIXTURE-BREAK---\n`);
}
