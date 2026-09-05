/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/booking/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: the CI leg that runs on the floor (Node 20.19)
 * installs nothing at all, because pnpm 11 refuses to start below Node 22.13 — so `node:test`, which
 * ships with the runtime, is the only runner available there. It also imports `dist/` rather than
 * `src/`, so what it proves is that the tarball a consumer installs works on the runtime it claims.
 *
 * Deliberately small: the webhook verifier on this runtime's Web Crypto, the event parser, one create
 * on each tier that carries its idempotency key and its capability token where the service expects
 * them, and the `./next` subpath — which is here because it is the only place that can prove the
 * route handler needs no `next` at all. `import()` of it would throw if it did.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier. */
const {
  createBookingClient,
  createBookingPublicClient,
  isKnownEvent,
  parseBookingWebhookEvent,
  verifyBookingWebhook,
} = await import(pathToFileURL(path.join(here, "..", "dist", "index.js")).href);

/** A `fetch` that records the one call it gets and answers a canned body. */
function recorder(body, status) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

test("verifyBookingWebhook agrees with every pinned fixture on this runtime", async () => {
  const fixturesDir = path.join(here, "fixtures", "webhook");
  const fixtures = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")));

  assert.ok(fixtures.length > 0, "expected pinned fixtures to be present");

  for (const fixture of fixtures) {
    const headers = new Headers();
    if (fixture.signature !== null) headers.set("X-Signature", fixture.signature);
    if (fixture.timestamp !== null) headers.set("X-Signature-Timestamp", fixture.timestamp);

    const verdict = await verifyBookingWebhook({
      secret: fixture.secret,
      rawBody: fixture.rawBody,
      headers,
      nowSeconds: fixture.nowSeconds,
    });
    assert.deepEqual(verdict, fixture.expect, `${fixture.name}: ${fixture.describes}`);
  }
});

test("a webhook event parses into the estate envelope with its four blocks", () => {
  const fixturesDir = path.join(here, "fixtures", "webhook");
  const { rawBody } = JSON.parse(
    readFileSync(path.join(fixturesDir, "valid-booking-confirmed.json"), "utf8"),
  );

  const event = parseBookingWebhookEvent(rawBody);
  assert.ok(isKnownEvent(event));
  assert.equal(event.data.booking.public_id, "019e5c31-0000-7000-8000-000000000106");
  assert.equal(event.data.service.price_minor, "4500");
  assert.equal(event.correlation_id, event.event_id);
  assert.equal(event.hop, 0);
});

test("a public create carries its idempotency key, and a read its management token", async () => {
  const created = recorder({ public_id: "019e", status: "pending" }, 201);
  const client = createBookingPublicClient({
    baseUrl: "https://booking.example.com",
    apiKey: "bpk_YOUR_PUBLISHABLE_KEY_test0",
    fetch: created.fetch,
  });

  const result = await client.createBooking(
    {
      service_id: "s",
      employee_id: "e",
      starts_at: "2026-09-14T08:00:00Z",
      customer: { email: "anna@example.com", name: "Anna" },
    },
    // A branded key, built here the way core builds one — this file cannot import a type.
    "booking-form-1-attempt-1",
  );

  assert.equal(result.replayed, false);
  assert.equal(created.calls[0].url, "https://booking.example.com/v1/public/bookings");
  assert.equal(created.calls[0].init.headers["Idempotency-Key"], "booking-form-1-attempt-1");
  assert.equal(created.calls[0].init.mode, undefined);

  const read = recorder({ public_id: "019e", status: "pending", windows: {} }, 200);
  await createBookingPublicClient({
    baseUrl: "https://booking.example.com",
    apiKey: "bpk_YOUR_PUBLISHABLE_KEY_test0",
    fetch: read.fetch,
  }).getBooking("019e", "mgmt-token-example");
  assert.equal(read.calls[0].init.headers["X-Booking-Token"], "mgmt-token-example");
  assert.ok(!read.calls[0].url.includes("mgmt-token-example"), "a token never travels in a URL");
});

test("a tenant list answers items and nextCursor", async () => {
  const listed = recorder({ data: [{ public_id: "b" }], next_cursor: null }, 200);
  const page = await createBookingClient({
    baseUrl: "https://booking.example.com",
    apiKey: "bsk_YOUR_SECRET_KEY_test000",
    fetch: listed.fetch,
  }).listBookings({ status: "confirmed" });

  assert.deepEqual(page, { items: [{ public_id: "b" }], nextCursor: null });
  assert.equal(listed.calls[0].url, "https://booking.example.com/v1/bookings?status=confirmed");
});

test("the ./next subpath imports and runs with no framework installed", async () => {
  // The point of this case is the import itself: if the handler reached for `next` anywhere, this line
  // would throw — which is why this package declares no peer dependency.
  const { createBookingWebhookHandler } = await import(
    pathToFileURL(path.join(here, "..", "dist", "next", "index.js")).href
  );

  const marked = [];
  const handler = createBookingWebhookHandler({
    secret: "whsec_EXAMPLE_TEST_SECRET_0123456789",
    alreadyProcessed: async (id) => marked.includes(id),
    markProcessed: async (id) => void marked.push(id),
    onEvent: async () => {},
  });

  // An unsigned delivery, so this exercises the verification path without pinning a signature here.
  const answer = await handler(
    new Request("https://site.example.com/api/webhooks/booking", { method: "POST", body: "{}" }),
  );

  assert.equal(answer.status, 401);
  assert.match(await answer.text(), /runtime = "nodejs"/);
  assert.deepEqual(marked, []);
});
