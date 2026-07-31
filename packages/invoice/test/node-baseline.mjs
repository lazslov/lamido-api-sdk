/**
 * The minimum supported runtime, checked against the built artifact.
 *
 * Run with `node --test packages/invoice/test/node-baseline.mjs` after `pnpm build`.
 *
 * Why this exists separately from the Vitest suites: Vitest 4 requires Node ^20.19 || >=22.12, so it
 * cannot run on Node 18.17 — the floor this package declares in `engines`. This file uses only
 * `node:test` and `node:assert`, available since Node 18, and imports `dist/` rather than `src/`, so
 * what it proves is that the tarball a consumer installs works on the runtime it claims.
 *
 * Deliberately small: the date type, one create carrying its key, and the storno the cancel returns.
 * The behaviour itself is the Vitest suites' job.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** pathToFileURL, not a bare path: a Windows drive letter is not a valid ESM specifier. */
const { createInvoiceClient, isoDate, InvoiceNotDownloadableError } = await import(
  pathToFileURL(path.join(here, "..", "dist", "index.js")).href
);

const baseUrl = "https://invoice.example.com";
const apiKey = "isk_YOUR_CLIENT_KEY_test0000";

/** A client answering from `respond`, plus the log of what reached fetch. */
function client(respond) {
  const calls = [];
  return {
    calls,
    invoices: createInvoiceClient({
      baseUrl,
      apiKey,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return respond(calls.length);
      },
    }),
  };
}

/** The service's `{ data }` envelope, at a status. */
function data(body, status = 200) {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const created = {
  id: "6f1c2c8e-4b6d-4f2a-9c33-0b1f2a4d55aa",
  provider: "billingo",
  providerConfigId: "billingo_acme",
  status: "created",
  invoiceNumber: "2026/0042",
  grossAmount: 38100,
  currency: "HUF",
  createdAt: "2026-07-25T09:14:03.221Z",
  updatedAt: "2026-07-25T09:14:05.882Z",
};

const body = {
  provider: "billingo",
  providerConfigId: "billingo_acme",
  partner: {
    name: "Teszt Vevő Kft",
    address: { postalCode: "1011", city: "Budapest", address: "Fő utca 1" },
  },
  items: [{ name: "Tanácsadás", quantity: 1, netUnitPrice: 15000, vatRate: "27" }],
};

test("isoDate rejects what the provider would reject", () => {
  assert.equal(isoDate("2026-07-25"), "2026-07-25");
  for (const bad of ["2026-13-45", "25/07/2026", "2026-02-30", "2026-7-25", ""]) {
    assert.throws(() => isoDate(bad), TypeError, `expected ${JSON.stringify(bad)} to throw`);
  }
});

test("a create carries its idempotency key, and reports 201 as not replayed", async () => {
  const { invoices, calls } = client(() => data(created, 201));
  // A branded key, built here the way core builds one — this file cannot import a type.
  const result = await invoices.createInvoice(body, "invoice-order-2026-0001-attempt-1");

  assert.equal(result.replayed, false);
  assert.equal(result.invoice.grossAmount, 38100);
  assert.equal(calls[0].url, `${baseUrl}/api/invoices`);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "invoice-order-2026-0001-attempt-1");
  assert.equal(calls[0].init.mode, undefined);
});

test("a 200 is a replay, whatever the invoice's status", async () => {
  const { invoices } = client(() => data({ ...created, status: "failed" }, 200));
  const result = await invoices.createInvoice(body, "invoice-order-2026-0001-attempt-1");

  assert.equal(result.replayed, true);
  assert.equal(result.invoice.status, "failed");
});

test("outbound validation runs before any request", async () => {
  const { invoices, calls } = client(() => data(created, 201));
  await assert.rejects(
    () => invoices.createInvoice({ ...body, providerConfigId: "szamlazz_acme" }, "k-attempt-1"),
    TypeError,
  );
  assert.equal(calls.length, 0);
});

test("stornoNumber arrives on the cancel, and the health body is not unwrapped", async () => {
  const { invoices } = client((call) =>
    call === 1
      ? data({ ...created, status: "cancelled", stornoNumber: "2026/0043" })
      : new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
  );

  const cancelled = await invoices.cancelInvoice(created.id);
  assert.equal(cancelled.stornoNumber, "2026/0043");
  assert.deepEqual(await invoices.getHealth(), { status: "ok" });
});

test("a cancelled invoice's PDF is a named error", async () => {
  const { invoices } = client(
    () =>
      new Response(
        JSON.stringify({
          error: {
            code: "bad_request",
            message: "Invoice is not in a downloadable state (status: cancelled)",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
  );

  await assert.rejects(() => invoices.getInvoicePdf(created.id), InvoiceNotDownloadableError);
});
