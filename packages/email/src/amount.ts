/**
 * The amount inside a `currency` template variable: a decimal string of canonical minor units.
 *
 * @remarks
 * The one place a caller types money into this service. The rule changed at the service's
 * `7cbff0e`: a `currency` variable's `amount` is a **string** of minor units, and a JSON number is
 * a `400`. HUF has zero minor units across every Lamido service, so `"38100"` is 38 100 Ft; EUR
 * has two, so `"1000"` is €10.00.
 *
 * This is not a money library. There is no arithmetic, no conversion and no formatting — the
 * service formats the amount for the recipient itself, with `BigInt` and no float on the path.
 */

declare const minorAmountBrand: unique symbol;

/**
 * A validated amount in canonical minor units.
 *
 * @remarks
 * Branded, so a {@link CurrencyVariable | currency variable} cannot be built from a bare string
 * or a number without passing through {@link minorAmount} and noticing which unit it holds.
 */
export type MinorAmount = string & { readonly [minorAmountBrand]: true };

/**
 * Digits only: no sign, no decimal point, no exponent, and no leading zero — except `"0"` itself.
 *
 * @remarks
 * The service's own accepted format, mirrored so a bad amount fails here instead of costing a
 * round trip. Unlike a payment, a zero total is a legitimate thing to put in an email, so `"0"`
 * is the one value that may begin with a zero.
 */
const canonical = /^(0|[1-9][0-9]*)$/;

/**
 * Validate and brand a string that already holds canonical minor units.
 *
 * @param value - The amount, as digits.
 * @returns The same string, branded.
 * @throws `TypeError` naming what is wrong, in the service's own terms — including for a
 * `number`, which is the shape the service refused from the day the rule changed.
 * @remarks
 * `String(order.totalMinor)` is the usual way to arrive here from a number you already hold in
 * minor units. There is deliberately no `huf()` or `eurCents()` constructor: this package sends
 * an amount for display, never for settlement, and the currency travels beside it.
 *
 * @example
 * ```ts
 * minorAmount("38100");   // ok — 38 100 Ft, or €381.00
 * minorAmount("0");       // ok
 * minorAmount("381.00");  // throws — major units
 * minorAmount(38100 as never); // throws — a JSON number is a 400 at the service
 * ```
 */
export function minorAmount(value: string): MinorAmount {
  if (typeof value !== "string") {
    throw new TypeError(
      `a currency variable's amount must be a string of minor units, received ${typeof value} — ` +
        "the service refuses a JSON number with a 400",
    );
  }
  if (!canonical.test(value)) {
    throw new TypeError(
      "a currency variable's amount must be a decimal string of canonical minor units with no " +
        `sign, decimal point, leading zero or exponent; received ${JSON.stringify(value)}`,
    );
  }
  return value as MinorAmount;
}
