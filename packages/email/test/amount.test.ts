import { describe, expect, it } from "vitest";
import { minorAmount } from "../src/amount.js";

/**
 * The amount inside a `currency` template variable.
 *
 * @remarks
 * The rule changed at the service's `7cbff0e`: a decimal string of minor units, never a JSON number.
 * Each rejection below is one the service would answer with a `400`, caught here before the round
 * trip.
 */

describe("minorAmount", () => {
  it("accepts canonical minor units, including zero", () => {
    // Unlike a payment, a zero total is a legitimate thing to put in an email.
    expect(minorAmount("38100")).toBe("38100");
    expect(minorAmount("1")).toBe("1");
    expect(minorAmount("0")).toBe("0");
  });

  it.each([
    ["381.00", "major units"],
    ["1e3", "an exponent"],
    [" 1", "a concatenated value"],
    ["01", "a leading zero"],
    ["-1", "a sign"],
    ["", "an empty string"],
  ])("rejects %j — %s", (value) => {
    expect(() => minorAmount(value)).toThrow(TypeError);
    expect(() => minorAmount(value)).toThrow(/canonical minor units/);
  });

  it("rejects a number, naming the 400 the service would answer", () => {
    // The headline breaking change of the money model: `{ "amount": 38100 }` is refused.
    expect(() => minorAmount(38100 as never)).toThrow(/refuses a JSON number with a 400/);
  });
});
