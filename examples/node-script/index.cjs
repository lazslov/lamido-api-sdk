/**
 * A consumer that is as unlike a Next.js app as possible: plain Node, CommonJS `require`, no framework,
 * no bundler, no TypeScript.
 *
 * Run with `pnpm --filter @lazslov-examples/node-script smoke`, after `pnpm build`.
 *
 * Three things it proves, none of which a suite inside the repository can:
 *
 * 1. **`require()` resolves.** The packages are `"type": "module"` and ship a CJS build beside the ESM
 *    one. Every unit suite here imports source through Vitest, so nothing else exercises the `require`
 *    condition of the exports map at all.
 * 2. **The main entries need no `next`.** It is not installed in this project. If any main entry reached
 *    for it, the very first `require` below would throw — which is the fixture half of phase 6's
 *    peer-dependency criterion.
 * 3. **A consumer boots with an EMPTY environment.** No `CONTENT_SERVICE_*`, no `INVOICE_SERVICE_*`, no
 *    `PAYMENT_SERVICE_*`. Every `tryCreate…` answers `null` and nothing throws, which is how a new
 *    contributor runs a client project and how a keyless CI build stays green.
 */

"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

/** Every check that ran, so the output says what was proved rather than just "ok". */
const proved = [];

/** Assert, and record the claim. */
function check(claim, assertion) {
  assertion();
  proved.push(claim);
}

// ── 1. require() resolves, on all four packages and all three subpaths ────────────────────────────

const core = require("@lazslov/api-core");
const content = require("@lazslov/content");
const contentFields = require("@lazslov/content/fields");
const invoice = require("@lazslov/invoice");
const payment = require("@lazslov/payment");
const paymentNext = require("@lazslov/payment/next");

check("all four packages resolve through the require condition", () => {
  for (const [name, mod] of Object.entries({ core, content, invoice, payment })) {
    assert.equal(typeof mod.VERSION, "string", `${name} has no VERSION`);
  }
});

check("the ./fields subpath resolves and carries the field layer", () => {
  assert.equal(typeof contentFields.prepareValues, "function");
  assert.equal(typeof contentFields.asText, "function");
});

check("@lazslov/payment/next resolves with no framework installed", () => {
  // This package's handler is a plain Request → Response, which is why it declares no peer dependency.
  assert.equal(typeof paymentNext.createPaymentWebhookHandler, "function");
});

check("no main entry's shipped CJS requires next, on any package", () => {
  // Checked against the built artifact, from a consumer's position, rather than against the source.
  //
  // Note what this does NOT prove. `require("@lazslov/content/next")` succeeds here even though this
  // project does not depend on `next`, because pnpm hoists the repository's own devDependency to the
  // root and Node's resolution walks up into it. So "the package is unusable without next" cannot be
  // simulated from inside this workspace at all — that is phase 8's `pnpm add` smoke, in a project
  // outside the monorepo. What is provable here is the thing that actually matters to an Astro or
  // plain-Node consumer: the entry they import reaches for nothing.
  const requiresNext = /require\(\s*["']next(\/[^"']*)?["']\s*\)/;

  for (const entry of [
    "@lazslov/api-core",
    "@lazslov/content",
    "@lazslov/content/fields",
    "@lazslov/invoice",
    "@lazslov/payment",
    "@lazslov/payment/next",
  ]) {
    const built = readFileSync(require.resolve(entry), "utf8");
    assert.equal(requiresNext.test(built), false, `${entry} requires next`);
  }

  // And the one subpath that does, so this stays a real distinction rather than a vacuous pass.
  const gateway = readFileSync(require.resolve("@lazslov/content/next"), "utf8");
  assert.equal(requiresNext.test(gateway), true, "@lazslov/content/next should require next/cache");
});

// ── 2. An empty environment degrades rather than crashing ────────────────────────────────────────

for (const variable of Object.keys(process.env)) {
  if (/^(CONTENT|INVOICE|PAYMENT)_SERVICE_/.test(variable)) delete process.env[variable];
}

check("every tryCreate… answers null with no environment at all", () => {
  assert.equal(content.tryCreateWebsiteClient(), null);
  assert.equal(content.tryCreateContentClient(), null);
  assert.equal(invoice.tryCreateInvoiceClient(), null);
  assert.equal(payment.tryCreatePaymentClient(), null);
});

check("the strict constructors report the variable to set, on a status: 0 error", () => {
  // The sentinel that lets one translator handle a missing variable and a real 401.
  for (const create of [
    content.createContentClient,
    invoice.createInvoiceClient,
    payment.createPaymentClient,
  ]) {
    let caught = null;
    try {
      create();
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "expected a NotConfiguredError");
    assert.equal(caught.status, 0);
    assert.equal(caught.code, "not_configured");
    assert.match(caught.message, /_(BASE_)?URL|_KEY/);
  }
});

// ── 3. The pure helpers work outside any framework ───────────────────────────────────────────────

check("the money type and the date type reject what the services reject", () => {
  assert.equal(payment.huf(2500), "2500");
  assert.throws(() => payment.minorUnits("25.00"), TypeError);
  assert.equal(invoice.isoDate("2026-07-25"), "2026-07-25");
  assert.throws(() => invoice.isoDate("25/07/2026"), TypeError);
});

check("an idempotency key must be derived, never generated by the SDK", () => {
  assert.equal(core.derivedIdempotencyKey("order-1", 2), "order-1-attempt-2");
  assert.throws(() => core.idempotencyKey(""), TypeError);
  // Nothing in core mints one from a clock or a random source.
  assert.equal(core.generateIdempotencyKey, undefined);
});

check("a client can be constructed from explicit config with no environment", () => {
  const client = invoice.createInvoiceClient({
    baseUrl: "https://invoice.example.com",
    apiKey: "isk_YOUR_CLIENT_KEY_test0000",
  });
  assert.equal(typeof client.createInvoice, "function");
  // And it still does not reveal the credential.
  assert.equal(JSON.stringify(client).includes("isk_"), false);
});

console.log(`\n  examples/node-script — ${proved.length} checks passed\n`);
for (const claim of proved) console.log(`  ✓ ${claim}`);
console.log("");
