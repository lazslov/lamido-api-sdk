import type { ContentErrorCode } from "@lazslov/content";
import type { InvoiceErrorCode } from "@lazslov/invoice";
import type { PaymentProblemType } from "@lazslov/payment";
import { describe, expect, it } from "vitest";

/**
 * Every service's error union is **exhaustively narrowable in a `switch`**.
 *
 * @remarks
 * The property that makes "branch on the code, never on the message" a practical instruction rather than
 * advice. Each translator below ends in a `never`-typed default: if a service gains a code and the union
 * is widened, `tsc` fails **here** and at every site a consumer wrote the same way — which is the whole
 * point of shipping a closed union instead of `string`.
 *
 * A cross-package suite because the property is about the three unions *as a set*: they are what a site
 * with all three packages installed writes one translator layer over.
 */

/** Anything that reaches the `default` branch of an exhaustive switch is `never`. */
function unreachable(value: never): string {
  // Reached only when a union gained a member and this switch did not. The runtime arm exists so a
  // consumer's translator behaves sanely against a service that shipped ahead of their SDK.
  return `unhandled: ${String(value)}`;
}

describe("content-service's codes", () => {
  /** The shape of a site's own `explain`. */
  function explain(code: ContentErrorCode): string {
    switch (code) {
      case "validation_error":
        return "per-field errors, not one toast";
      case "bad_request":
        return "the request was understood and is wrong";
      case "unauthorized":
        return "the service rejected the key — an operator problem";
      case "forbidden":
        return "this key's tier cannot do that";
      case "not_found":
        return "absent, or another site's";
      case "conflict":
        return "read details.missing, or details.recordCount";
      case "payload_too_large":
        return "over the 8 KB record limit";
      case "internal_error":
        return "retry once, then report";
      // The SDK's own, on a status: 0 error, so one translator covers a missing env var too.
      case "not_configured":
        return "CONTENT_SERVICE_* is not set";
      default:
        return unreachable(code);
    }
  }

  it("narrows exhaustively, with the SDK's own code among them", () => {
    expect(explain("conflict")).toContain("details.missing");
    expect(explain("not_configured")).toContain("CONTENT_SERVICE_");
  });
});

describe("invoice-service's codes", () => {
  /** Whether a retry can succeed, and — where it matters — under which key. */
  function retryAdvice(code: InvoiceErrorCode): string {
    switch (code) {
      case "provider_error":
        // The rule that separates this service from payment-service.
        return "retry with a NEW key";
      case "internal_error":
        return "check the credential, then a NEW key";
      case "validation_error":
      case "bad_request":
      case "unauthorized":
      case "forbidden":
        // None of these consumed the key, so the same one can be resent once the request is fixed.
        return "fix it and resend the SAME key";
      case "not_found":
      case "conflict":
        return "no retry will help";
      case "not_configured":
        return "INVOICE_SERVICE_* is not set";
      default:
        return unreachable(code);
    }
  }

  it("narrows exhaustively, and keeps the two retryable codes apart from the rest", () => {
    expect(retryAdvice("provider_error")).toContain("NEW key");
    expect(retryAdvice("validation_error")).toContain("SAME key");
  });
});

describe("payment-service's problem types", () => {
  /** Branch on `type`, never on `title` or `detail`. */
  function describeType(type: PaymentProblemType): string {
    switch (type) {
      case "urn:payment-service:problem:validation":
        return "fix the request";
      case "urn:payment-service:problem:unauthorized":
        return "fix the credential";
      case "urn:payment-service:problem:forbidden":
        return "an Origin header, or the wrong tier";
      case "urn:payment-service:problem:not-found":
        return "possibly the wrong merchant's key";
      case "urn:payment-service:problem:conflict":
        // 409 and 422 both, which is exactly why `retryable` cannot come from the type alone.
        return "read retryable, not the status";
      case "urn:payment-service:problem:rate-limit":
        return "wait retry_after";
      case "urn:payment-service:problem:internal":
        // A PSP failure arrives here, carried by a 502 — there is no `provider` type.
        return "read providerOutcome before retrying";
      default:
        return unreachable(type);
    }
  }

  it("narrows exhaustively over a closed set of URNs", () => {
    expect(describeType("urn:payment-service:problem:conflict")).toContain("retryable");
    expect(describeType("urn:payment-service:problem:internal")).toContain("providerOutcome");
  });

  it("has no provider type, because a PSP failure is an internal carried by a 502", () => {
    // @ts-expect-error — adding one would be an API change, and this is where it would surface.
    const absent: PaymentProblemType = "urn:payment-service:problem:provider";
    expect(absent).toBeTypeOf("string");
  });
});
