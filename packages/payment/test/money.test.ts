import { describe, expect, it } from "vitest";
import { eurCents, huf, minorUnits } from "../src/money.js";

describe("minorUnits", () => {
  it("accepts a canonical amount", () => {
    expect(minorUnits("2500")).toBe("2500");
    expect(minorUnits("1")).toBe("1");
  });

  it('rejects "25.00", which is thinking in major units', () => {
    expect(() => minorUnits("25.00")).toThrow(TypeError);
  });

  it('rejects "1e3", which is a float that leaked into the request', () => {
    expect(() => minorUnits("1e3")).toThrow(TypeError);
  });

  it('rejects " 1", which was concatenated rather than computed', () => {
    expect(() => minorUnits(" 1")).toThrow(TypeError);
  });

  it('rejects "01", the habit that produces "1000" + "00"', () => {
    expect(() => minorUnits("01")).toThrow(TypeError);
  });

  it('rejects "0", because no path may create a zero-amount payment', () => {
    expect(() => minorUnits("0")).toThrow(TypeError);
  });

  it("rejects a negative amount and an empty string", () => {
    expect(() => minorUnits("-1")).toThrow(TypeError);
    expect(() => minorUnits("")).toThrow(TypeError);
  });

  it("says what is wrong in the service's own terms", () => {
    expect(() => minorUnits("25.00")).toThrow(/no sign, decimal point, leading zero or exponent/);
  });

  it("keeps an amount too large for a JavaScript number exactly", () => {
    // Which is why amounts are strings: 2^53 + 1 does not survive a JSON number.
    expect(minorUnits("9007199254740993")).toBe("9007199254740993");
  });
});

describe("huf", () => {
  it("is zero-decimal: 1000 forint is 1000", () => {
    expect(huf(1000)).toBe("1000");
  });

  it("throws for a fractional forint rather than rounding it", () => {
    // Fillér have not circulated since 1999, and a rounding step is not something an amount should
    // acquire on its way to a PSP.
    expect(() => huf(10.5)).toThrow(/whole forint/);
  });

  it("throws for zero and for a negative amount", () => {
    expect(() => huf(0)).toThrow(/more than zero/);
    expect(() => huf(-100)).toThrow(/more than zero/);
  });

  it("accepts a bigint, so arithmetic can stay in BigInt", () => {
    expect(huf(10n ** 20n)).toBe("100000000000000000000");
    expect(() => huf(0n)).toThrow(/more than zero/);
  });

  it("throws for NaN and Infinity", () => {
    expect(() => huf(Number.NaN)).toThrow(TypeError);
    expect(() => huf(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("eurCents", () => {
  it("is two-decimal: 1000 cents is €10.00, and still the string 1000", () => {
    expect(eurCents(1000)).toBe("1000");
  });

  it("throws for a fractional cent", () => {
    expect(() => eurCents(10.5)).toThrow(/whole cents/);
  });

  it("is named for cents, so nothing at a call site reads as euro", () => {
    // A hypothetical eur(10.5) would have to round, and eur(1000) would say nothing about which it is.
    expect(eurCents(1)).toBe("1");
  });
});
