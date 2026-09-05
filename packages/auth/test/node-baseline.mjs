/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/auth/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: the CI leg that runs on the floor (Node 20.19)
 * installs nothing at all, because pnpm 11 refuses to start below Node 22.13 — so `node:test`, which
 * ships with the runtime, is the only runner available there. It also imports `dist/` rather than
 * `src/`, so what it proves is that the tarball a consumer installs works on the runtime it claims.
 *
 * Deliberately small: the poll predicate, the cookie reader, the webhook verifier on this runtime's Web
 * Crypto, one call on each tier that proves the credential and the session header reach `fetch`, and
 * the `./next` subpath — which is here because it is the only place that can prove the route handler
 * needs no `next` at all. `import()` of it would throw if it did. The behaviour itself is the Vitest
 * suites' job.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier. */
const {
  createAuthClient,
  createAuthPublicClient,
  isTerminalLoginStatus,
  parseAuthWebhookEvent,
  sessionTokenFromSetCookie,
  verifyAuthWebhook,
} = await import(pathToFileURL(path.join(here, "..", "dist", "index.js")).href);

test("the poll predicate stops on a null interval and nothing else", () => {
  assert.equal(isTerminalLoginStatus({ status: "pending", poll_interval_ms: 2000 }), false);
  assert.equal(isTerminalLoginStatus({ status: "approved", poll_interval_ms: null }), true);
  assert.equal(isTerminalLoginStatus({ status: "expired", poll_interval_ms: null }), true);
});

test("the cookie reader finds a session token and nothing else", () => {
  assert.equal(
    sessionTokenFromSetCookie("__Host-lamido_customer_session=tok; Path=/; HttpOnly"),
    "tok",
  );
  assert.equal(sessionTokenFromSetCookie("__Host-lamido_oauth_state=st; Path=/"), null);
  assert.equal(sessionTokenFromSetCookie(null), null);
});

test("verifyAuthWebhook agrees with every pinned fixture on this runtime", async () => {
  const fixturesDir = path.join(here, "fixtures", "webhook");
  const fixtures = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")));

  assert.ok(fixtures.length > 0, "expected pinned fixtures to be present");

  for (const fixture of fixtures) {
    const headers = new Headers();
    if (fixture.signature !== null) headers.set("X-Signature", fixture.signature);
    if (fixture.timestamp !== null) headers.set("X-Signature-Timestamp", fixture.timestamp);

    const verdict = await verifyAuthWebhook({
      secret: fixture.secret,
      rawBody: fixture.rawBody,
      headers,
      nowSeconds: fixture.nowSeconds,
    });
    assert.deepEqual(verdict, fixture.expect, `${fixture.name}: ${fixture.describes}`);
  }
});

test("a webhook event parses into the estate envelope", () => {
  const rawBody = JSON.stringify({
    event_id: "019f0a10-0000-7000-8000-0000000000a1",
    event_type: "subscription.activated",
    contract_version: 1,
    occurred_at: "2026-08-14T09:14:31.204Z",
    service: "auth-service",
    account_id: null,
    tenant: { kind: "organization", public_id: "019f0a10-0000-7000-8000-0000000000b2" },
    correlation_id: "019f0a10-0000-7000-8000-0000000000a1",
    causation_id: null,
    hop: 0,
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

  const event = parseAuthWebhookEvent(rawBody);
  assert.equal(event.data.subscription.public_id, "019f0a10-0000-7000-8000-0000000000c3");
  assert.equal(event.correlation_id, event.event_id);
  assert.equal(event.tenant.kind, "organization");
});

test("the browser tier sends the publishable key and no fetch mode", async () => {
  const calls = [];
  const client = createAuthPublicClient({
    baseUrl: "https://auth.example.com",
    apiKey: "apk_YOUR_WEBSITE_KEY_test000",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ status: "pending", poll_interval_ms: 2000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const poll = await client.getMagicLinkStatus("handle");
  assert.equal(poll.status, "pending");
  assert.equal(calls[0].url, "https://auth.example.com/v1/public/auth/magic-link/handle/status");
  assert.equal(calls[0].init.headers.Authorization, "Bearer apk_YOUR_WEBSITE_KEY_test000");
  assert.equal(calls[0].init.mode, undefined);
});

test("the client tier carries both credentials on a session-bearing route", async () => {
  const calls = [];
  const client = createAuthClient({
    baseUrl: "https://auth.example.com",
    apiKey: "ask_YOUR_APPLICATION_KEY_test0",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [], next_cursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const page = await client.listWebsites("session-token-for-tests");
  assert.deepEqual(page, { items: [], nextCursor: null });
  assert.equal(calls[0].url, "https://auth.example.com/v1/websites");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ask_YOUR_APPLICATION_KEY_test0");
  assert.equal(calls[0].init.headers["X-Session-Token"], "session-token-for-tests");
});

test("the ./next subpath imports and runs with no framework installed", async () => {
  // The point of this case is the import itself: if the handler reached for `next` anywhere, this line
  // would throw — which is why this package declares no peer dependency.
  const { createAuthWebhookHandler } = await import(
    pathToFileURL(path.join(here, "..", "dist", "next", "index.js")).href
  );

  const marked = [];
  const handler = createAuthWebhookHandler({
    secret: "whsec_EXAMPLE_TEST_SECRET_0123456789",
    alreadyProcessed: async (id) => marked.includes(id),
    markProcessed: async (id) => void marked.push(id),
    onEvent: async () => {},
  });

  // An unsigned delivery, so this exercises the verification path without pinning a signature here —
  // the signed cases are the Vitest suite's, and the fixtures are api-core's.
  const answer = await handler(
    new Request("https://site.example.com/api/webhooks/auth", { method: "POST", body: "{}" }),
  );

  assert.equal(answer.status, 401);
  assert.match(await answer.text(), /runtime = "nodejs"/);
  assert.deepEqual(marked, []);
});
