import type { Payment, PaymentWebhookEvent, Refund, WebhookDelivery } from "@lazslov/payment";
import { expect } from "vitest";
import type { AllKeys, MandatoryKeys } from "../type-keys.js";
import { adminTier, type Classifier, isRecord, type ServiceExamples, spec } from "./shared.js";

/** payment-service's documented examples, and the `@lazslov/payment` type each one is checked against. */

/** Every member is required on the wire. */
const paymentKeys = {
  public_id: true,
  merchant_payment_ref: true,
  amount_minor: true,
  currency: true,
  status: true,
  provider: true,
  mode: true,
  provider_payment_id: true,
  provider_status: true,
  gateway_url: true,
  redirect_url: true,
  metadata: true,
  expires_at: true,
  succeeded_at: true,
  failed_at: true,
  created_at: true,
  updated_at: true,
} as const;

const paymentSpec = spec(
  paymentKeys satisfies AllKeys<Payment>,
  paymentKeys satisfies MandatoryKeys<Payment>,
);

const refundKeys = {
  public_id: true,
  payment_public_id: true,
  amount_minor: true,
  currency: true,
  status: true,
  outcome_unknown: true,
  reason: true,
  provider: true,
  mode: true,
  provider_refund_id: true,
  provider_status: true,
  created_at: true,
  updated_at: true,
} as const;

const refundSpec = spec(
  refundKeys satisfies AllKeys<Refund>,
  refundKeys satisfies MandatoryKeys<Refund>,
);

const deliveryKeys = {
  delivery_id: true,
  event_id: true,
  event_type: true,
  status: true,
  attempt: true,
  next_attempt_at: true,
  response_status: true,
  response_body_excerpt: true,
  error: true,
  created_at: true,
  updated_at: true,
} as const;

const deliverySpec = spec(
  deliveryKeys satisfies AllKeys<WebhookDelivery>,
  deliveryKeys satisfies MandatoryKeys<WebhookDelivery>,
);

/**
 * The delivered event envelope.
 *
 * @remarks
 * Every event from every Lamido service is this shape. The resource blocks live inside `data`, so
 * the union's branches differ only in what `data` holds — which means one key spec covers all of
 * them.
 */
const envelopeKeys = {
  event_id: true,
  event_type: true,
  contract_version: true,
  occurred_at: true,
  service: true,
  account_id: true,
  tenant: true,
  correlation_id: true,
  causation_id: true,
  hop: true,
  data: true,
} as const;

const webhookEventSpec = spec(
  envelopeKeys satisfies AllKeys<PaymentWebhookEvent>,
  envelopeKeys satisfies MandatoryKeys<PaymentWebhookEvent>,
);

const classifiers: readonly Classifier[] = [
  adminTier,
  {
    id: "out of scope: the /healthz body, which the SDK declares no type for",
    // payment-service's liveness body carries `version`, `commit` and `now` beside `status` — and
    // no `db` since the service's `fc899ba`. The SDK does not model it: nothing in the merchant
    // surface reads it.
    matches: (example) =>
      isRecord(example.json) &&
      "status" in example.json &&
      ("db" in example.json || "version" in example.json),
  },
  {
    id: "payment: PaymentWebhookEvent",
    matches: (example) => isRecord(example.json) && "event_type" in example.json,
    check: (example) => ({ value: example.json as object, spec: webhookEventSpec }),
  },
  {
    id: "payment: RFC 7807 Problem",
    matches: (example) =>
      isRecord(example.json) && "type" in example.json && "instance" in example.json,
    check: (example) => {
      // Like an error envelope: modelled as a class, so there is no wire type to derive keys from.
      const problem = example.json as Record<string, unknown>;
      expect(typeof problem.type).toBe("string");
      expect(typeof problem.status).toBe("number");
      return null;
    },
  },
  {
    id: "payment: Refund",
    matches: (example) => isRecord(example.json) && "payment_public_id" in example.json,
    check: (example) => ({ value: example.json as object, spec: refundSpec }),
  },
  {
    id: "payment: Payment",
    matches: (example) =>
      isRecord(example.json) &&
      "public_id" in example.json &&
      "merchant_payment_ref" in example.json,
    check: (example) => ({ value: example.json as object, spec: paymentSpec }),
  },
  {
    id: "payment: WebhookDelivery[]",
    matches: (example) => Array.isArray(example.json),
    check: (example) => ({ value: (example.json as object[])[0] as object, spec: deliverySpec }),
  },
  {
    id: "payment: CreatePaymentInput",
    matches: (example) => isRecord(example.json) && "merchant_payment_ref" in example.json,
  },
  {
    id: "payment: CreateRefundInput",
    matches: (example) => isRecord(example.json) && "amount_minor" in example.json,
  },
  {
    id: "out of scope: an abbreviated orientation snippet, not a full response",
    matches: (example) => example.file === "README.md",
  },
];

export const paymentExamples: ServiceExamples = {
  id: "payment-service",
  classifiers,
  minChecked: 6,
  minTypes: 4,
};
