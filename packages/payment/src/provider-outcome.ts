/**
 * 502 triage: the one place this SDK reads a problem's `detail`.
 *
 * @remarks
 * A deliberate, documented exception to *"branch on `type`, never on `detail`"*. A 502 has four
 * distinct meanings, the retry rule differs in each, and the **only** thing distinguishing them is
 * the prose. Getting it wrong double-charges a buyer, so the alternative — treating every 502 the
 * same — is not the safer option it looks like.
 *
 * Two properties make reading prose defensible here:
 *
 * 1. Matching is on short, stable substrings, and a miss falls through to `"unclassified"` — never
 *    to `"rejected"`, the only outcome that permits a free retry. If the service rewords a message,
 *    this becomes *more* cautious, not less.
 * 2. `"unclassified"` is not retryable. The default answer to "we could not tell what happened to
 *    money" is stop.
 */

/**
 * What a 502 says happened at the PSP.
 *
 * @remarks
 * `unknown` and `refund_unknown` are the two that cost money if misread. Neither means "it failed".
 */
export type ProviderOutcome =
  /** Definitively nothing happened at the PSP. Safe to retry with the **same** key once fixed. */
  | "rejected"
  /**
   * The PSP could not be reached and the outcome is unknown.
   *
   * @remarks
   * Retry with the **same** idempotency key only. A retry under the same key is forced through a
   * probe of the PSP before anything is sent again; a new key is simply a second payment, because
   * Barion does not deduplicate on its own request id.
   */
  | "unknown"
  /**
   * A refund was sent and the PSP did not answer.
   *
   * @remarks
   * **Do not retry.** The reservation stays held deliberately and only the service's reconciler may
   * resolve it — read the refund again in a minute.
   */
  | "refund_unknown"
  /** An integrity check on the PSP's response failed. Do not retry; an operator has to look. */
  | "untrusted"
  /** The `detail` matched nothing known. Treat as unknown, and do not retry blind. */
  | "unclassified";

/**
 * The substrings, most specific first.
 *
 * @remarks
 * Order is load-bearing: the refund message also speaks of a provider that did not answer, so it
 * has to be recognised before the general unknown-outcome case. Kept short so a reworded sentence
 * still matches, and lowercase so casing changes cannot break the match.
 */
const signals: readonly {
  readonly outcome: ProviderOutcome;
  readonly needles: readonly string[];
}[] = [
  { outcome: "refund_unknown", needles: ["refund was sent"] },
  { outcome: "untrusted", needles: ["could not be trusted"] },
  { outcome: "rejected", needles: ["provider rejected"] },
  { outcome: "unknown", needles: ["could not be reached", "outcome is unknown"] },
];

/**
 * Classify a 502's `detail`.
 *
 * @param detail - The problem's `detail`, or anything else that arrived in its place.
 * @returns The outcome, or `"unclassified"` when nothing matched.
 * @remarks
 * Call only for status 502; every other status is decided by `type` and `status` alone.
 */
export function classifyProviderOutcome(detail: unknown): ProviderOutcome {
  if (typeof detail !== "string") return "unclassified";

  const prose = detail.toLowerCase();
  for (const { outcome, needles } of signals) {
    if (needles.some((needle) => prose.includes(needle))) return outcome;
  }
  return "unclassified";
}

/**
 * Whether a 502 with this outcome may be retried at all.
 *
 * @remarks
 * `true` for `rejected` and `unknown` — and in both cases only under the **same** idempotency key,
 * which is what {@link ../errors.js | PaymentApiError}'s `advice` says. `false` for everything
 * else, including `unclassified`.
 */
export function isProviderOutcomeRetryable(outcome: ProviderOutcome): boolean {
  return outcome === "rejected" || outcome === "unknown";
}

/** What to tell whoever reads the error, per outcome. Prose for a human, never for control flow. */
export const providerOutcomeAdvice: Readonly<Record<ProviderOutcome, string>> = {
  rejected:
    "The provider rejected this definitively and nothing was created. Fix what it objected to, then retry with the SAME Idempotency-Key.",
  unknown:
    "The outcome is unknown. Retry with the SAME Idempotency-Key — a new key is a second payment, because Barion does not deduplicate on its own request id.",
  refund_unknown:
    "The refund was sent and the outcome is unknown. Do NOT retry: read the refund again in a minute and let the reconciler resolve it.",
  untrusted:
    "The provider's response failed an integrity check. Do not retry — an operator has to look at this.",
  unclassified:
    "The provider outcome could not be classified from this message. Treat it as unknown: do not retry blind, and read the payment or refund before doing anything else.",
};
