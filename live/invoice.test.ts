import { derivedIdempotencyKey } from "@lazslov/api-core";
import {
  type CreateInvoiceInput,
  createInvoiceClient,
  type InvoiceApiError,
  isoDate,
} from "@lazslov/invoice";
import { describe, expect, it } from "vitest";
import {
  allowWrites,
  failure,
  invoiceProviderConfigId,
  invoiceTarget,
  skipReason,
} from "./config.js";

/**
 * invoice-service, live.
 *
 * @remarks
 * **Nothing here issues a real invoice.** A successful create has side effects at szamlazz.hu or
 * Billingo and is reported to NAV — there is no undo but a storno, which is itself a real document. So
 * the create cases stop at the failures that happen **before** the provider is called: a bad
 * `providerConfigId` prefix is one, and it is exactly the case that proves the SDK's local validation
 * matches the service rather than being a stricter invention.
 *
 * The one case that can create a row is behind `LIVE_ALLOW_WRITES` **and** needs a provider sandbox
 * configured on the tenant; see `docs/live-testing.md`.
 */

describe.skipIf(!invoiceTarget.ready)("invoice-service live", () => {
  const client = () =>
    createInvoiceClient({
      baseUrl: invoiceTarget.baseUrl,
      apiKey: invoiceTarget.keys.client,
    });

  it("answers a bare {status:'ok'} with no data wrapper", async () => {
    // One of the three documented envelope exceptions, and the reason core's ReadMode is explicit per
    // call: a shared unwrap(body.data) applied here returns undefined.
    expect(await client().getHealth()).toEqual({ status: "ok" });
  });

  it("returns NO total on the invoice list", async () => {
    // The assertion that keeps the paginator honest. If this ever starts returning a total, branch 3 of
    // core's collectAll is dead code and `InvoiceList` should gain the field.
    const page = await client().listInvoices({ limit: 1 });

    expect(page.limit).toBe(1);
    expect(page.offset).toBe(0);
    expect(Object.keys(page).sort()).toEqual(["items", "limit", "offset"]);
    expect("total" in page).toBe(false);
  });

  it("rejects an out-of-range limit rather than clamping it", async () => {
    const error = await failure<InvoiceApiError>(() => client().listInvoices({ limit: 500 }));

    expect(error.status).toBe(400);
    expect(error.code).toBe("validation_error");
  });

  it("rejects a providerConfigId whose prefix does not match the provider", async () => {
    // The SDK refuses this locally, before any request — so the point of the live case is the
    // *converse*: that the service still refuses it too. Asserted by sending a body the SDK accepts,
    // with a config id whose characters are legal and whose prefix is the wrong provider's.
    const body: CreateInvoiceInput = {
      provider: "billingo",
      providerConfigId: "szamlazz_sdk_live_probe",
      partner: {
        name: "SDK Live Probe",
        address: { postalCode: "1011", city: "Budapest", address: "Fő utca 1" },
      },
      items: [{ name: "Probe", quantity: 1, netUnitPrice: 1, vatRate: "27" }],
      issueDate: isoDate(new Date()),
    };

    const error = await failure<InvoiceApiError>(() =>
      client().createInvoice(body, derivedIdempotencyKey("sdk-live-probe-bad-prefix", 1)),
    );

    // Raised before the row is inserted, which is also why this key is not consumed and the case can
    // run again tomorrow.
    expect(error.status).toBe(400);
    expect(error.code).toBe("bad_request");
  });

  it("answers 404 for an invoice this key cannot see, and does not map it to null", async () => {
    // Non-existence and no-access are deliberately indistinguishable, which is why the SDK throws here
    // rather than returning null: a 404 on an id you hold means the wrong key, not absent data.
    const error = await failure<InvoiceApiError>(() =>
      client().getInvoice("00000000-0000-4000-8000-000000000000"),
    );

    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it.skipIf(!allowWrites || !invoiceProviderConfigId)(
    "reports a replayed create as 200 with the same row",
    async () => {
      // The sharpest edge in the service: a key is consumed on first use whatever the outcome. This is
      // the only case here that can create a row, and it may create a `failed` one if the provider
      // sandbox refuses — which is still a valid outcome for this assertion, because the key is spent
      // either way and that is the thing being proved.
      const configId = invoiceProviderConfigId as string;
      const key = derivedIdempotencyKey(`sdk-live-replay-${configId}`, 1);

      const body: CreateInvoiceInput = {
        provider: configId.startsWith("billingo_") ? "billingo" : "szamlazz",
        providerConfigId: configId,
        partner: {
          name: "SDK Live Probe",
          address: { postalCode: "1011", city: "Budapest", address: "Fő utca 1" },
        },
        items: [{ name: "Probe", quantity: 1, netUnitPrice: 1, vatRate: "27" }],
        partnerRef: "sdk-live-probe",
      };

      // The first attempt may fail at the provider; the replay is what is under test.
      const first = await client()
        .createInvoice(body, key)
        .then((result) => result.invoice.id)
        .catch(() => null);

      const replay = await client().createInvoice(body, key);

      expect(replay.replayed).toBe(true);
      if (first !== null) expect(replay.invoice.id).toBe(first);
    },
  );
});

describe.skipIf(invoiceTarget.ready)("invoice-service live (skipped)", () => {
  it("reports why", () => {
    console.info(`  ${skipReason(invoiceTarget)}`);
    expect(invoiceTarget.ready).toBe(false);
  });
});
