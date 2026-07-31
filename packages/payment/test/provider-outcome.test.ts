import { describe, expect, it } from "vitest";
import {
  classifyProviderOutcome,
  isProviderOutcomeRetryable,
  type ProviderOutcome,
} from "../src/provider-outcome.js";

/** The four sentences the service documents, verbatim enough to be the real thing. */
const details: Readonly<Record<string, ProviderOutcome>> = {
  "The provider rejected the payment request: insufficient funds": "rejected",
  "The provider could not be reached and the outcome is unknown; retry with the same Idempotency-Key":
    "unknown",
  "The refund was sent but the provider did not answer, so the outcome is unknown":
    "refund_unknown",
  "The provider response could not be trusted": "untrusted",
};

describe("classifyProviderOutcome", () => {
  it.each(Object.entries(details))("classifies %s", (detail, expected) => {
    expect(classifyProviderOutcome(detail)).toBe(expected);
  });

  it("recognises the refund case before the general unknown one", () => {
    // The refund sentence also speaks of an unknown outcome, so order in the matcher is load-bearing:
    // a refund with an unknown outcome must NEVER be retried, while a plain unknown may be, same key.
    expect(
      classifyProviderOutcome(
        "The refund was sent but the provider did not answer and the outcome is unknown",
      ),
    ).toBe("refund_unknown");
  });

  it("ignores casing, so a rewording of the same words still matches", () => {
    expect(classifyProviderOutcome("THE PROVIDER REJECTED THE REQUEST")).toBe("rejected");
  });

  it("falls back to unclassified for a message it does not know", () => {
    expect(classifyProviderOutcome("Something went wrong upstream")).toBe("unclassified");
  });

  it("never reads a garbled message as rejected", () => {
    // `rejected` is the only outcome that permits a free retry, so a reworded message must make the
    // SDK MORE cautious, not less.
    const garbled = [
      "the provider rejceted the payment",
      "provider  rejected",
      "rejected by the provider",
      "",
      "The upstream declined it",
    ];
    for (const detail of garbled) {
      expect(classifyProviderOutcome(detail), detail).not.toBe("rejected");
    }
  });

  it("handles a missing or non-string detail", () => {
    expect(classifyProviderOutcome(undefined)).toBe("unclassified");
    expect(classifyProviderOutcome(null)).toBe("unclassified");
    expect(classifyProviderOutcome({ detail: "x" })).toBe("unclassified");
  });
});

describe("isProviderOutcomeRetryable", () => {
  it("permits a retry only where the service says one is safe", () => {
    expect(isProviderOutcomeRetryable("rejected")).toBe(true);
    expect(isProviderOutcomeRetryable("unknown")).toBe(true);
  });

  it("refuses a retry for a refund with an unknown outcome", () => {
    // The reservation stays held deliberately; only the service's reconciler may resolve it.
    expect(isProviderOutcomeRetryable("refund_unknown")).toBe(false);
  });

  it("refuses a retry for an untrusted response and for an unclassified one", () => {
    expect(isProviderOutcomeRetryable("untrusted")).toBe(false);
    // The default answer to "we could not tell what happened to money" is stop.
    expect(isProviderOutcomeRetryable("unclassified")).toBe(false);
  });
});
