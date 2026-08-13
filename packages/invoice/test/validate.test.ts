import { idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { isoDate } from "../src/dates.js";
import type { CreateInvoiceInput } from "../src/types.js";
import { createBody, fetchStub, invoiceClient } from "./stubs/fetch.js";

/**
 * The four things the service passes through to the provider rather than checking, checked here.
 *
 * @remarks
 * All four assertions are that the failure happens **before any request** — `stub.calls` stays empty —
 * because the whole value of these checks is not spending an idempotency key on a typo.
 */

const key = idempotencyKey("invoice-order-2026-0001-attempt-1");

/** Attempt a create with `overrides` merged in, and report what reached `fetch`. */
async function attempt(overrides: Partial<CreateInvoiceInput>) {
  const stub = fetchStub();
  const thrown = await invoiceClient(stub)
    .createInvoice({ ...createBody(), ...overrides } as CreateInvoiceInput, key)
    .then(() => null)
    .catch((error: unknown) => error as Error);
  return { thrown, calls: stub.calls };
}

describe("provider_config_id", () => {
  it("must start with the provider's prefix", async () => {
    const { thrown, calls } = await attempt({ provider_config_id: "szamlazz_acme" });
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown?.message).toMatch(/must start with "billingo_"/);
    expect(calls).toEqual([]);
  });

  it("rejects a dash and an upper-case letter, naming the rule", async () => {
    for (const bad of ["billingo-acme", "billingo_Acme"]) {
      const { thrown, calls } = await attempt({ provider_config_id: bad });
      expect(thrown?.message).toMatch(/\^\[a-z0-9_\]\+\$/);
      expect(calls).toEqual([]);
    }
  });

  it("rejects more than 64 characters", async () => {
    const { thrown } = await attempt({ provider_config_id: `billingo_${"a".repeat(60)}` });
    expect(thrown?.message).toMatch(/at most 64 characters/);
  });

  it("rejects an empty value", async () => {
    const { thrown } = await attempt({ provider_config_id: "" });
    expect(thrown?.message).toMatch(/non-empty string/);
  });

  it("accepts a well-formed id", async () => {
    const { thrown } = await attempt({ provider_config_id: "billingo_acme_2026" });
    expect(thrown).toBeNull();
  });
});

describe("vat_rate", () => {
  it("rejects a percent sign, which the service forwards and the provider refuses", async () => {
    const { thrown, calls } = await attempt({
      items: [{ name: "Tanácsadás", quantity: 1, net_unit_price_minor: "15000", vat_rate: "27%" }],
    });
    expect(thrown?.message).toMatch(/items\[0\]\.vat_rate/);
    expect(calls).toEqual([]);
  });

  it("rejects a number, in the shape a JavaScript caller reaches it with", async () => {
    const { thrown } = await attempt({
      items: [
        {
          name: "Tanácsadás",
          quantity: 1,
          net_unit_price_minor: "15000",
          vat_rate: 27 as unknown as string,
        },
      ],
    });
    expect(thrown?.message).toMatch(/must be a string, not a number/);
  });

  it("rejects whitespace, a decimal point, a lower-case code and an empty value", async () => {
    for (const bad of [" 27", "27 ", "27.0", "aam", "", "-5"]) {
      const { thrown } = await attempt({
        items: [{ name: "Tanácsadás", quantity: 1, net_unit_price_minor: "15000", vat_rate: bad }],
      });
      expect(thrown, `expected ${JSON.stringify(bad)} to be rejected`).toBeInstanceOf(TypeError);
    }
  });

  it("accepts every documented form, and a code the documentation does not enumerate", async () => {
    // A pattern rather than an allowlist: the docs say "other codes" pass through, and rejecting a
    // legitimate rate would be an SDK bug a consumer could not work around.
    for (const good of ["27", "18", "5", "0", "AAM", "TAM", "EU", "FAD"]) {
      const { thrown } = await attempt({
        items: [{ name: "Tanácsadás", quantity: 1, net_unit_price_minor: "15000", vat_rate: good }],
      });
      expect(thrown, `expected ${JSON.stringify(good)} to be accepted`).toBeNull();
    }
  });

  it("names the line's index, because fieldErrors would only say `items`", async () => {
    const { thrown } = await attempt({
      items: [
        { name: "A", quantity: 1, net_unit_price_minor: "1", vat_rate: "27" },
        { name: "B", quantity: 1, net_unit_price_minor: "1", vat_rate: "27%" },
      ],
    });
    expect(thrown?.message).toMatch(/items\[1\]\.vat_rate/);
  });
});

describe("items", () => {
  it("must contain at least one line", async () => {
    const { thrown, calls } = await attempt({
      items: [] as unknown as CreateInvoiceInput["items"],
    });
    expect(thrown?.message).toMatch(/at least one invoice line/);
    expect(calls).toEqual([]);
  });
});

describe("the date fields are re-checked at runtime", () => {
  it("rejects a bad date that was cast past the brand, naming the field", async () => {
    // The brand makes this a compile error; this is the JavaScript caller's path.
    const { thrown, calls } = await attempt({
      due_date: "25/07/2026" as unknown as CreateInvoiceInput["due_date"],
    });
    expect(thrown?.message).toMatch(/^due_date: /);
    expect(calls).toEqual([]);
  });

  it("accepts dates built through isoDate", async () => {
    const { thrown } = await attempt({
      issue_date: isoDate("2026-07-25"),
      fulfillment_date: isoDate("2026-07-25"),
      due_date: isoDate("2026-08-02"),
    });
    expect(thrown).toBeNull();
  });
});

describe("net_unit_price_minor", () => {
  it("rejects a number, which is what the old major-unit field was", async () => {
    // The most likely migration mistake, and the one that bills the wrong amount instead of
    // failing loudly: `15000` and `"15000"` look identical in a diff.
    const { thrown, calls } = await attempt({
      items: [
        {
          name: "Tanácsadás",
          quantity: 1,
          net_unit_price_minor: 15000 as unknown as string,
          vat_rate: "27",
        },
      ],
    });
    expect(thrown?.message).toMatch(/must be a string of minor units, not a number/);
    expect(calls).toEqual([]);
  });

  it("rejects a major-unit decimal, a sign, a leading zero and zero itself", async () => {
    for (const bad of ["150.00", "-15000", "+15000", "015000", "0", "", "1e4", "15 000"]) {
      const { thrown } = await attempt({
        items: [{ name: "Tanácsadás", quantity: 1, net_unit_price_minor: bad, vat_rate: "27" }],
      });
      expect(thrown, `expected ${JSON.stringify(bad)} to be rejected`).toBeInstanceOf(TypeError);
    }
  });

  it("accepts canonical minor units, including one far above 2^53", async () => {
    // The reason the field is a string at all: a yearly HUF total exceeds what a JSON number
    // can carry without losing precision.
    for (const good of ["1", "15000", "38100", "9007199254740993"]) {
      const { thrown } = await attempt({
        items: [{ name: "Tanácsadás", quantity: 1, net_unit_price_minor: good, vat_rate: "27" }],
      });
      expect(thrown, `expected ${JSON.stringify(good)} to be accepted`).toBeNull();
    }
  });

  it("names the line's index", async () => {
    const { thrown } = await attempt({
      items: [
        { name: "A", quantity: 1, net_unit_price_minor: "1", vat_rate: "27" },
        { name: "B", quantity: 1, net_unit_price_minor: "0", vat_rate: "27" },
      ],
    });
    expect(thrown?.message).toMatch(/items\[1\]\.net_unit_price_minor/);
  });
});
