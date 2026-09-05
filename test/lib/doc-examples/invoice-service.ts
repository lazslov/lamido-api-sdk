import type { CancelledInvoice, DownloadLink, Invoice, InvoiceHealth } from "@lazslov/invoice";
import type { AllKeys, MandatoryKeys } from "../type-keys.js";
import {
  adminTier,
  type Classifier,
  isRecord,
  problemDocument,
  type ServiceExamples,
  spec,
  unwrap,
} from "./shared.js";

/**
 * invoice-service's documented examples, and the `@lazslov/invoice` type each one is checked against.
 *
 * @remarks
 * The lowest check count of the original three: most of this service's documented JSON is admin-tier,
 * and the one `CancelledInvoice` example upstream abbreviates itself with an ellipsis key.
 */

/** Every member is required on the wire: the nullable ones are present and `null` rather than absent. */
const invoiceKeys = {
  public_id: true,
  provider: true,
  provider_config_id: true,
  status: true,
  invoice_number: true,
  provider_invoice_id: true,
  gross_amount_minor: true,
  currency: true,
  partner_ref: true,
  error_message: true,
  created_at: true,
  updated_at: true,
} as const;

const invoiceSpec = spec(
  invoiceKeys satisfies AllKeys<Invoice>,
  invoiceKeys satisfies MandatoryKeys<Invoice>,
);

const cancelledInvoiceSpec = spec(
  { ...invoiceKeys, storno_number: true } satisfies AllKeys<CancelledInvoice>,
  invoiceKeys satisfies MandatoryKeys<CancelledInvoice>,
);

const downloadLinkSpec = spec(
  { url: true, expires_at: true } satisfies AllKeys<DownloadLink>,
  { url: true, expires_at: true } satisfies MandatoryKeys<DownloadLink>,
);

/** invoice-service's `/healthz` body: `{ status: "ok" }`, the same one member content-service reports. */
const healthSpec = spec(
  { status: true } satisfies AllKeys<InvoiceHealth>,
  { status: true } satisfies MandatoryKeys<InvoiceHealth>,
);

const classifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("invoice: problem document"),
  {
    id: "invoice: CancelledInvoice",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "storno_number" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: cancelledInvoiceSpec }),
  },
  {
    id: "invoice: DownloadLink",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && "expires_at" in data && "url" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: downloadLinkSpec }),
  },
  {
    id: "invoice: Invoice",
    matches: (example) => {
      const value = unwrap(example.json) ?? example.json;
      return isRecord(value) && "provider_config_id" in value && "status" in value;
    },
    check: (example) => ({
      value: (unwrap(example.json) ?? example.json) as object,
      spec: invoiceSpec,
    }),
  },
  {
    id: "invoice: health",
    matches: (example) =>
      isRecord(example.json) &&
      "status" in example.json &&
      Object.keys(example.json).every((key) => ["status", "db", "code"].includes(key)),
    check: (example) => ({ value: example.json as object, spec: healthSpec }),
  },
  {
    id: "out of scope: a partial illustration, not a full resource",
    // conventions.md shows fragments to make one point — that a single resource is unwrapped,
    // that money is a minor-unit string — rather than a whole body. A key check against the
    // full type would fail on every member the fragment deliberately leaves out.
    matches: (example) =>
      example.file === "conventions.md" &&
      isRecord(example.json) &&
      Object.keys(example.json).length <= 2,
  },
  {
    id: "invoice: inbound webhook event",
    // The estate envelope, received on /v1/hooks/{source_service}. The SDK sends invoices; it
    // does not model what this service receives from payment-service.
    matches: (example) =>
      isRecord(example.json) && "event_type" in example.json && "occurred_at" in example.json,
  },
  {
    id: "out of scope: an empty body, sent to prove a route answers",
    matches: (example) => isRecord(example.json) && Object.keys(example.json).length === 0,
  },
  {
    id: "invoice: CreateInvoiceInput",
    matches: (example) =>
      isRecord(example.json) && "items" in example.json && "partner" in example.json,
  },
  {
    id: "out of scope: a validation_error's Zod flatten, which the SDK types as details",
    matches: (example) => isRecord(example.json) && "details" in example.json,
  },
  {
    id: "out of scope: an envelope illustration with no payload of its own",
    matches: (example) => {
      const data = unwrap(example.json);
      return isRecord(data) && Object.keys(data).join() === "id";
    },
  },
  {
    // In `workflows.md`, whose context is a heading rather than a request line — so the admin-path rule
    // above cannot see it. Credentials are maintained on the `iad_` tier, which v1 does not cover.
    id: "out of scope: an admin integration body",
    matches: (example) =>
      isRecord(example.json) &&
      "provider" in example.json &&
      ("secret" in example.json || "config" in example.json),
  },
];

export const invoiceExamples: ServiceExamples = {
  id: "invoice-service",
  classifiers,
  minChecked: 3,
  minTypes: 3,
};
