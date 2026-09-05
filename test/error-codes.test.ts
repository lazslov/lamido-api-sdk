import type { LamidoApiError, ProblemType } from "@lazslov/api-core";
import type { AuthApiError, AuthProblemCode } from "@lazslov/auth";
import type { BookingApiError, BookingProblemCode } from "@lazslov/booking";
import type { ContentApiError } from "@lazslov/content";
import type { EmailApiError, EmailProblemCode } from "@lazslov/email";
import type { InvoiceApiError, InvoiceProblemCode } from "@lazslov/invoice";
import type { PaymentApiError, PaymentConflictCode } from "@lazslov/payment";
import type { WebshopApiError, WebshopProblemCode } from "@lazslov/webshop";
import { describe, expect, it } from "vitest";

/**
 * The seven services' error unions are **one** union, and it is exhaustively narrowable.
 *
 * @remarks
 * This suite used to prove the same property once per service, because each package shipped its own
 * closed set of codes. They have collapsed: every service answers with an RFC 9457 problem document
 * over one shared slug set, verbatim and by contract, so a site with several packages installed
 * writes **one** translator rather than several that must agree.
 *
 * The property that makes "branch on `type`, never on the message" practical rather than advisory
 * is unchanged: the translator below ends in a `never`-typed default, so if the estate gains a slug
 * and the union widens, `tsc` fails **here** and at every site a consumer wrote the same way.
 *
 * A cross-package suite because the property is about the packages *as a set*.
 */

/** Anything that reaches the `default` branch of an exhaustive switch is `never`. */
function unreachable(value: never): string {
  // Reached only when the union gained a member and this switch did not. The runtime arm exists so
  // a consumer's translator behaves sanely against a service that shipped ahead of their SDK.
  return `unhandled: ${String(value)}`;
}

describe("the estate's one problem slug set", () => {
  /** The shape of a site's own `explain`, written once and used for all three services. */
  function explain(type: ProblemType): string {
    switch (type) {
      case "validation":
        return "per-field errors from errors[], not one toast";
      case "unauthorized":
        return "the service rejected the key — an operator problem";
      case "forbidden":
        return "this key's tier cannot do that";
      case "not-found":
        return "absent, or another tenant's";
      case "conflict":
        // 409 and 422 both, which is exactly why `retryable` cannot come from the slug alone.
        return "read retryable and status, not the slug alone";
      case "payload-too-large":
        // content-service's alone: a dataset record past 8 KB.
        return "over the 8 KB record limit";
      case "rate-limit":
        return "wait retryAfter seconds";
      case "internal":
        // A provider failure arrives here, carried by a 502 — there is no `provider` slug.
        return "500 is ours, 502 is theirs";
      case "unknown":
        // The SDK's own: no problem document arrived, or none was recognised.
        return "no problem document — a proxy, or nothing was configured";
      default:
        return unreachable(type);
    }
  }

  it("narrows exhaustively over the whole set", () => {
    expect(explain("conflict")).toContain("retryable");
    expect(explain("internal")).toContain("502");
    expect(explain("unknown")).toContain("proxy");
  });

  it("has no provider slug, because a provider failure is an internal carried by a 502", () => {
    // @ts-expect-error — adding one would be an API change, and this is where it would surface.
    const absent: ProblemType = "provider";
    expect(absent).toBeTypeOf("string");
  });

  it("carries no service namespace, so one switch covers every package", () => {
    // The URN differs per service — `urn:content-service:problem:conflict` against
    // `urn:payment-service:problem:conflict` — and the SDK lifts the slug out of it. Branching on
    // the full URN would be three translators again.
    // @ts-expect-error — the namespace is stripped before the value reaches a caller.
    const namespaced: ProblemType = "urn:payment-service:problem:conflict";
    expect(namespaced).toBeTypeOf("string");
  });
});

describe("every error class shares the union", () => {
  /**
   * One translator, seven services. This is the point of the design, and it is a **compile-time**
   * assertion: the function below only type-checks because every class carries the same `type`
   * field over the same union.
   */
  function translate(
    error:
      | AuthApiError
      | BookingApiError
      | ContentApiError
      | EmailApiError
      | InvoiceApiError
      | PaymentApiError
      | WebshopApiError,
  ): string {
    return explainShared(error.type);
  }

  /** Reachable from any `@lazslov/*` error, which is what makes one translator possible. */
  function explainShared(type: ProblemType): string {
    return type;
  }

  it("reads `type` off any of them, and off the shared base, without a cast", () => {
    // A site holding a `LamidoApiError` it has not narrowed yet reads the same field.
    const fromBase: (error: LamidoApiError) => string = (error) => explainShared(error.type);

    expect(translate).toBeTypeOf("function");
    expect(fromBase).toBeTypeOf("function");
  });
});

describe("the per-service `code` extensions stay separate", () => {
  /**
   * `code` is the sub-case where a `(type, status)` pair cannot identify the failure, and it is
   * the one part that is **not** shared: each service names its own.
   */
  it("keeps invoice's and payment's sets distinct", () => {
    const notDownloadable: InvoiceProblemCode = "not_downloadable";
    const refundExceeds: PaymentConflictCode = "refund_exceeds_remaining";

    expect(notDownloadable).toBe("not_downloadable");
    expect(refundExceeds).toBe("refund_exceeds_remaining");

    // @ts-expect-error — payment's codes are not invoice's, and mixing them is a real bug.
    const wrong: InvoiceProblemCode = "refund_exceeds_remaining";
    expect(wrong).toBeTypeOf("string");
  });

  it("keeps the four newer services' sets distinct too", () => {
    // Each is the closed set that service documents. They overlap in wording — `idempotency_in_flight`
    // is auth's and booking's alike — and the sets are still separate types, because a code one
    // service can send is not a code another one can.
    const authCode: AuthProblemCode = "oauth_state_invalid";
    const bookingCode: BookingProblemCode = "slot_taken";
    const emailCode: EmailProblemCode = "recipient_suppressed";
    const webshopCode: WebshopProblemCode = "cart_converted";

    expect([authCode, bookingCode, emailCode, webshopCode]).toHaveLength(4);

    // @ts-expect-error — a booking conflict is not an email one, whatever the words look like.
    const mixed: EmailProblemCode = "slot_taken";
    expect(mixed).toBeTypeOf("string");
  });
});
