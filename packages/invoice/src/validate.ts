/**
 * The outbound checks — the four things the service deliberately does not validate.
 *
 * @remarks
 * This is the one package that validates *before* sending, and the reason is narrow rather than
 * general: the service passes these values straight through to szamlazz.hu or Billingo, so a typo
 * comes back as an opaque `502 provider_error` **with the idempotency key already consumed and the
 * invoice stored as `failed`**. A local `TypeError` costs nothing; the round trip costs a key.
 *
 * Hand-written predicates, no validation library — the packages ship zero runtime dependencies.
 */

import { isoDate } from "./dates.js";
import type { CreateInvoiceInput } from "./types.js";

/** conventions §8: lowercase, digits and underscores, at most 64 characters. */
const configIdShape = /^[a-z0-9_]+$/;

/** Maximum length of a `provider_config_id`. */
const configIdMaxLength = 64;

/** A VAT percentage as the wire wants it: bare digits, no sign, no `%`, no decimal point. */
const numericVatRate = /^(?:0|[1-9][0-9]*)$/;

/**
 * A VAT *code* — `"AAM"`, `"TAM"`, `"EU"`.
 *
 * @remarks
 * A pattern rather than a closed list. The documentation names three codes and then says "other
 * codes" pass through, so an allowlist would reject a legitimate code with no way around it, and
 * being wrong in that direction is worse: a rejected valid rate is an SDK bug a consumer cannot work
 * around, while a bad code still fails at the provider the way it would have anyway. What the pattern
 * does catch is the documented mistakes — `"27%"`, `" 27"`, `"27.0"`, `"aam"`, `""`.
 */
const codeVatRate = /^[A-Z][A-Z0-9]{1,15}$/;

/**
 * A monetary amount as the wire wants it: canonical minor units, digits only.
 *
 * @remarks
 * No sign, no decimal point, no exponent and no leading zero — and `"0"` itself is rejected, so
 * the pattern starts at `1`. This is the shape a caller most often gets wrong when migrating off
 * the old major-unit number: `15000` (a number), `"150.00"` and `"-15000"` all fail here rather
 * than at the provider.
 */
const amountMinor = /^[1-9][0-9]*$/;

/**
 * Check everything the SDK can check about a create, before the request leaves.
 *
 * @param input - The body as the caller assembled it.
 * @throws `TypeError` naming the field and the rule it broke.
 * @remarks
 * Runs in one place, at the top of `createInvoice`, so every rule is enforced on every path and none
 * of them can be skipped by a caller who assembled the body somewhere else. The types already forbid
 * most of this; these checks are what a JavaScript caller — or a body parsed from a form — gets.
 * @internal
 */
export function assertCreatable(input: CreateInvoiceInput): void {
  assertProviderConfigId(input.provider, input.provider_config_id);
  assertItems(input.items);
  assertDates(input);
}

/**
 * Check a `provider_config_id` against the pure string half of its rule.
 *
 * @throws `TypeError` naming which of the three rules failed.
 * @remarks
 * The fourth rule — that the id is in the client's `allowedProviderConfigs` — is not checkable here
 * and is a `403`. Only an operator can fix that one, so the error the service returns is the right
 * place for it.
 * @internal
 */
export function assertProviderConfigId(provider: string, configId: unknown): void {
  if (typeof configId !== "string" || configId.length === 0) {
    throw new TypeError("provider_config_id is required and must be a non-empty string");
  }
  if (configId.length > configIdMaxLength) {
    throw new TypeError(
      `provider_config_id must be at most ${configIdMaxLength} characters, received ${configId.length}`,
    );
  }
  if (!configIdShape.test(configId)) {
    throw new TypeError(
      `provider_config_id must match ^[a-z0-9_]+$ — no dashes, no uppercase — received ${JSON.stringify(configId)}. ` +
        "The id is upper-cased to build an env-var fallback name, so it has to stay filename-safe.",
    );
  }
  if (!configId.startsWith(`${provider}_`)) {
    throw new TypeError(
      `provider_config_id must start with "${provider}_" to match provider "${provider}", received ${JSON.stringify(configId)}`,
    );
  }
}

/**
 * Check that there is at least one line, and that every line's VAT rate is one the provider accepts.
 *
 * @throws `TypeError` naming the line's index.
 * @internal
 */
export function assertItems(items: unknown): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError("items must contain at least one invoice line");
  }
  items.forEach((item, index) => {
    assertAmountMinor((item as { net_unit_price_minor?: unknown }).net_unit_price_minor, index);
    assertVatRate((item as { vat_rate?: unknown }).vat_rate, index);
  });
}

/**
 * Check one line's net unit price.
 *
 * @param amount - The value as given.
 * @param index - Which line it is, named in the error.
 * @throws `TypeError` describing the accepted form.
 * @remarks
 * Checked locally because the shape is the single most likely mistake when moving off the old
 * major-unit number, and because getting it wrong bills the wrong amount rather than failing
 * loudly. A number is called out by name: `15000` and `"15000"` look identical in a diff.
 * @internal
 */
export function assertAmountMinor(amount: unknown, index: number): void {
  if (typeof amount !== "string") {
    throw new TypeError(
      `items[${index}].net_unit_price_minor must be a string of minor units, not a ${typeof amount} — ` +
        `"15000", never 15000. A JSON number loses precision above 2^53, which a yearly HUF total reaches.`,
    );
  }
  if (amountMinor.test(amount)) return;
  throw new TypeError(
    `items[${index}].net_unit_price_minor must be canonical minor units — digits only, no sign, ` +
      `no decimal point, no leading zero, and greater than zero — received ${JSON.stringify(amount)}. ` +
      'HUF is zero-decimal here, so 38 100 Ft is "38100" rather than "38100.00".',
  );
}

/**
 * Check one line's VAT rate.
 *
 * @param rate - The value as given.
 * @param index - Which line it is, named in the error because `fieldErrors` would only say `items`.
 * @throws `TypeError` describing both accepted forms.
 * @internal
 */
export function assertVatRate(rate: unknown, index: number): void {
  if (typeof rate !== "string") {
    throw new TypeError(
      `items[${index}].vat_rate must be a string, not a ${typeof rate} — "27", never 27`,
    );
  }
  if (numericVatRate.test(rate) || codeVatRate.test(rate)) return;
  throw new TypeError(
    `items[${index}].vat_rate must be a bare percentage as a string ("27", "5", "0") or an ` +
      `upper-case code ("AAM", "TAM", "EU"), received ${JSON.stringify(rate)}. ` +
      "The service does not check this and the provider rejects it as a 502, consuming the idempotency key.",
  );
}

/**
 * Re-check the three date fields at runtime.
 *
 * @throws `TypeError` naming the field.
 * @remarks
 * The {@link ./dates.js | IsoDate} brand already makes a bad date a compile error, so this only fires
 * for a JavaScript caller or a value that arrived as `unknown` and was cast. Worth the six lines: the
 * whole reason these fields are branded is that the service will forward anything.
 * @internal
 */
function assertDates(input: CreateInvoiceInput): void {
  for (const field of ["issue_date", "fulfillment_date", "due_date"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    try {
      isoDate(value);
    } catch (error) {
      throw new TypeError(`${field}: ${(error as Error).message}`);
    }
  }
}
