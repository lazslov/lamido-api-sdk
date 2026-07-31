/**
 * The date type, and the one constructor that produces it.
 *
 * @remarks
 * The three invoice dates are the SDK's clearest case for validating *outbound*. conventions §7 is
 * explicit that `issueDate`, `fulfillmentDate` and `dueDate` are **not format-validated** by the
 * service: they are typed as plain strings and passed straight through to szamlazz.hu or Billingo,
 * which rejects them as a `502 provider_error`. By then the `Idempotency-Key` is consumed and the
 * invoice row is written as `failed`, so the cost of a mistyped date is a wasted key and a retry
 * under a new one.
 */

declare const isoDateBrand: unique symbol;

/**
 * A calendar date the service will accept, `YYYY-MM-DD`.
 *
 * @remarks
 * Branded, so the only way to obtain one is through {@link isoDate}. A caller cannot put
 * `"25/07/2026"` into an invoice date field without going through a constructor and noticing which
 * format they are producing.
 */
export type IsoDate = string & { readonly [isoDateBrand]: true };

/** Shape only. Whether the components describe a real day is checked separately. */
const shape = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate and brand a calendar date.
 *
 * @param value - A `Date`, read in **UTC**, or a `YYYY-MM-DD` string.
 * @returns The date as `YYYY-MM-DD`, branded.
 * @throws `TypeError` naming the format, for anything that is not a real day in that shape.
 * @remarks
 * A `Date` is rendered in UTC rather than in the host's zone, deliberately: a server in Budapest
 * building `new Date()` at 00:30 local time would otherwise issue an invoice dated the previous day
 * for half the summer. Where the invoice's own date matters — and on an invoice it always does —
 * pass the string you mean.
 *
 * @example
 * ```ts
 * isoDate("2026-07-25");   // ok
 * isoDate(new Date());     // today, in UTC
 * isoDate("2026-13-45");   // throws — no such month, no such day
 * isoDate("25/07/2026");   // throws — the service would pass this straight to the provider
 * ```
 */
export function isoDate(value: Date | string): IsoDate {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("an invoice date cannot be built from an invalid Date");
    }
    return value.toISOString().slice(0, 10) as IsoDate;
  }

  if (typeof value !== "string") {
    throw new TypeError(
      `an invoice date must be a YYYY-MM-DD string or a Date, received ${typeof value}`,
    );
  }

  const parts = shape.exec(value);
  if (!parts) {
    throw new TypeError(
      `an invoice date must be YYYY-MM-DD, received ${JSON.stringify(value)}. The service does not ` +
        "check this and passes it to the provider, which rejects it as a 502 — consuming the idempotency key.",
    );
  }

  // Round-tripped through UTC so a shape-valid non-day is rejected too: "2026-13-45" and
  // "2026-02-30" both parse as three integers and neither names a date.
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new TypeError(`${JSON.stringify(value)} is not a real calendar date`);
  }

  return value as IsoDate;
}
