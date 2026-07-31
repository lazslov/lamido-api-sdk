/**
 * The money type: a decimal string of canonical minor units, and the two constructors that
 * produce one.
 *
 * @remarks
 * The highest-value type in this SDK, because the failure mode is a wrong charge.
 *
 * Two service rules make it what it is. **HUF has zero minor units in this API** — `"1000"` HUF is
 * 1000 Ft, not 10.00 Ft, while EUR is two-decimal so `"1000"` EUR is €10.00. And **an amount never
 * goes into a JavaScript `number`**: JSON numbers lose precision above 2^53 and floating point
 * cannot represent `9.99`.
 */

declare const minorUnitsBrand: unique symbol;

/**
 * A validated amount in canonical minor units.
 *
 * @remarks
 * Branded, so the only way to obtain one is through {@link huf}, {@link eurCents} or
 * {@link minorUnits}. A caller cannot pass a bare string or a number to an amount field without
 * going through a constructor and noticing which currency's exponent they are using.
 */
export type MinorUnits = string & { readonly [minorUnitsBrand]: true };

/**
 * Digits only: no sign, no decimal point, no leading zero, no exponent, and never `"0"`.
 *
 * @remarks
 * The service's own accepted format, mirrored so a bad amount fails here instead of costing a
 * round trip. Each rejection says something about the caller: `"25.00"` is thinking in major
 * units, `"1e3"` is a float that leaked in, `" 1"` was concatenated rather than computed, `"01"`
 * is string manipulation on amounts — the habit that produces `"1000" + "00"` — and `"0"` is a
 * zero-amount payment, which no path may create.
 */
const canonical = /^[1-9][0-9]*$/;

/**
 * Validate and brand a string that already holds canonical minor units.
 *
 * @param value - The amount, as digits.
 * @returns The same string, branded.
 * @throws `TypeError` naming what is wrong, in the service's own terms.
 * @remarks
 * For an amount that arrived from somewhere else already in minor units — a stored order total, a
 * value read back from the API. When you are converting from a currency's major unit, use
 * {@link huf} or {@link eurCents} instead: they say which exponent you meant.
 *
 * @example
 * ```ts
 * minorUnits("2500");   // ok
 * minorUnits("25.00");  // throws — major units
 * minorUnits("0");      // throws — no path may create a zero-amount payment
 * ```
 */
export function minorUnits(value: string): MinorUnits {
  if (typeof value !== "string") {
    throw new TypeError(`an amount must be a string of minor units, received ${typeof value}`);
  }
  if (!canonical.test(value)) {
    throw new TypeError(
      `an amount must be a decimal string of canonical minor units with no sign, decimal point, ` +
        `leading zero or exponent, and greater than zero; received ${JSON.stringify(value)}`,
    );
  }
  return value as MinorUnits;
}

/**
 * An amount in **forint**.
 *
 * @param forint - Whole forint. `1000` means 1000 Ft.
 * @returns The amount as minor units.
 * @throws `TypeError` for a non-integer, a non-positive value, or a number that is not finite.
 * @remarks
 * HUF is zero-decimal in this API, so this is an identity conversion — and it is a named function
 * anyway, because `huf(1000)` at a call site says *forint* where a bare `"1000"` says nothing.
 * There is deliberately no `huf(10.50)`: fillér have not circulated since 1999, and a rounding
 * step is not something an amount should acquire on its way to a PSP.
 *
 * Accepts a `bigint` so a caller doing arithmetic can stay in `BigInt`, which is how the service
 * stores amounts.
 */
export function huf(forint: number | bigint): MinorUnits {
  return minorUnits(whole(forint, "huf", "forint"));
}

/**
 * An amount in **euro cents**.
 *
 * @param cents - Whole cents. `1000` means €10.00.
 * @returns The amount as minor units.
 * @throws `TypeError` for a non-integer, a non-positive value, or a number that is not finite.
 * @remarks
 * Named `eurCents` rather than `eur` on purpose: `eur(10.5)` would have to round, and the name
 * would not say what `eur(1000)` means. Cents are what the wire carries.
 */
export function eurCents(cents: number | bigint): MinorUnits {
  return minorUnits(whole(cents, "eurCents", "cents"));
}

/**
 * Render a whole positive amount as digits.
 *
 * @throws `TypeError` for anything a currency cannot hold.
 */
function whole(value: number | bigint, fn: string, unit: string): string {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new TypeError(`${fn}() needs more than zero ${unit}, received ${value}`);
    return value.toString();
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `${fn}() takes whole ${unit}, received ${value}. There is no rounding step here — decide ` +
        `the exact amount at the call site.`,
    );
  }
  if (value <= 0) throw new TypeError(`${fn}() needs more than zero ${unit}, received ${value}`);
  return String(value);
}
