/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/payment/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: the CI leg that runs on the floor (Node 20.19)
 * installs nothing at all, because pnpm 11 refuses to start below Node 22.13 — so `node:test`, which
 * ships with the runtime, is the only runner available there. It also imports `dist/` rather than
 * `src/`, so what it proves is that the tarball a consumer installs works on the runtime it claims.
 *
 * Deliberately small: the money type, the webhook verifier on this runtime's Web Crypto, one create that
 * carries its idempotency key, and the `./next` subpath — which is here because it is the only place
 * that can prove the route handler needs no `next` at all. `import()` of it would throw if it did.
 * (`@lazslov/content/next` does need `next`, and proving *that* installs cleanly without it is phase 7's
 * `examples/node-script` fixture.) The behaviour itself is the Vitest suites' job.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier. */
const {
  createPaymentClient,
  huf,
  isFulfillable,
  minorUnits,
  parsePaymentWebhookEvent,
  verifyPaymentWebhook,
} = await import(pathToFileURL(path.join(here, "..", "dist", "index.js")).href);

test("the money type rejects what the service rejects", () => {
  assert.equal(huf(1000), "1000");
  assert.equal(minorUnits("2500"), "2500");
  for (const bad of ["25.00", "1e3", " 1", "01", "0"]) {
    assert.throws(() => minorUnits(bad), TypeError, `expected ${JSON.stringify(bad)} to throw`);
  }
  assert.throws(() => huf(10.5), TypeError);
});

test("nothing is fulfillable but a succeeded payment", () => {
  assert.equal(isFulfillable("pending"), false);
  assert.equal(isFulfillable("authorized"), false);
  assert.equal(isFulfillable("succeeded"), true);
});

test("verifyPaymentWebhook agrees with every pinned fixture on this runtime", async () => {
  const fixturesDir = path.join(here, "fixtures", "webhook");
  const fixtures = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")));

  assert.ok(fixtures.length > 0, "expected pinned fixtures to be present");

  for (const fixture of fixtures) {
    const headers = new Headers();
    if (fixture.signature !== null) headers.set("X-Signature", fixture.signature);
    if (fixture.timestamp !== null) headers.set("X-Signature-Timestamp", fixture.timestamp);

    const verdict = await verifyPaymentWebhook({
      secret: fixture.secret,
      rawBody: fixture.rawBody,
      headers,
      nowSeconds: fixture.nowSeconds,
    });
    assert.deepEqual(verdict, fixture.expect, `${fixture.name}: ${fixture.describes}`);
  }
});

test("a webhook event parses without renaming payment.id", () => {
  const rawBody = JSON.stringify({
    event_id: "019e4a91-0000-7000-8000-000000000001",
    event_type: "payment.succeeded",
    created_at: "2026-01-21T12:53:20.000Z",
    payment: {
      id: "019e4a91-0000-7000-8000-000000000002",
      merchant_payment_ref: "order-12345",
      status: "succeeded",
      amount_minor: "1000",
      currency: "HUF",
      provider: "barion",
    },
  });

  const event = parsePaymentWebhookEvent(rawBody);
  assert.equal(event.payment.id, "019e4a91-0000-7000-8000-000000000002");
  assert.equal(event.payment.public_id, undefined);
});

test("a create carries its idempotency key to fetch", async () => {
  const calls = [];
  const client = createPaymentClient({
    baseUrl: "https://payment.example.com",
    apiKey: "pmk_YOUR_MERCHANT_KEY_test00",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ public_id: "019e", status: "pending" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const { replayed } = await client.createPayment(
    { merchant_payment_ref: "order-12345", amount_minor: huf(2500), currency: "HUF" },
    // A branded key, built here the way core builds one — this file cannot import a type.
    "order-12345-attempt-1",
  );

  assert.equal(replayed, false);
  assert.equal(calls[0].url, "https://payment.example.com/v1/payments");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "order-12345-attempt-1");
  assert.equal(calls[0].init.mode, undefined);
});

test("the ./next subpath imports and runs with no framework installed", async () => {
  // The point of this case is the import itself: if the handler reached for `next` anywhere, this line
  // would throw — which is why this package declares no peer dependency.
  const { createPaymentWebhookHandler } = await import(
    pathToFileURL(path.join(here, "..", "dist", "next", "index.js")).href
  );

  const marked = [];
  const handler = createPaymentWebhookHandler({
    secret: "whsec_EXAMPLE_TEST_SECRET_0123456789",
    alreadyProcessed: async (id) => marked.includes(id),
    markProcessed: async (id) => void marked.push(id),
    onEvent: async () => {},
  });

  // An unsigned delivery, so this exercises the verification path without pinning a signature here —
  // the signed cases are the Vitest suite's, and the fixtures are api-core's.
  const answer = await handler(
    new Request("https://site.example.com/api/webhooks/payment", { method: "POST", body: "{}" }),
  );

  assert.equal(answer.status, 401);
  assert.match(await answer.text(), /runtime = "nodejs"/);
  assert.deepEqual(marked, []);
});
