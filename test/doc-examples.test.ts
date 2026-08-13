import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  AggregateGroup,
  ClientIdentity,
  CollectionItem,
  ContentAsset,
  ContentHealth,
  ContentSite,
  DatasetRecord,
  PageDocument,
  PublishedPageSummary,
  UploadToken,
} from "@lazslov/content";
import type { CancelledInvoice, DownloadLink, Invoice, InvoiceHealth } from "@lazslov/invoice";
import type { Payment, PaymentWebhookEvent, Refund, WebhookDelivery } from "@lazslov/payment";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../scripts/lib/paths.js";
import { type AllKeys, checkKeys, type KeySpec, type MandatoryKeys } from "./lib/type-keys.js";

/**
 * Every JSON example the knowledge base documents, checked against the type the SDK declares for it.
 *
 * @remarks
 * The examples are free, authoritative fixtures — they are what the services' own maintainers wrote down
 * as the shape of a request or a response. The point of checking them is not that they parse. It is that
 * **when a doc example and the SDK disagree, one of them is wrong**, and finding out at commit time is the
 * whole reason this repository exists.
 *
 * Three properties make this a real check rather than a green tick:
 *
 * 1. The key lists are verified **by the compiler** at their definition site — see `./lib/type-keys.ts`.
 *    A list that drifted from its type does not compile.
 * 2. Divergence is checked **in both directions**: a documented key the type does not declare, and a
 *    required key the example does not carry.
 * 3. **Every example must be claimed**, by a type or by an explicit out-of-scope reason. A new example
 *    upstream fails this suite until somebody says what it is. Without that, the whole file would report
 *    green over examples nobody had looked at.
 *
 * Regenerate the fixtures with `pnpm examples:import`; CI asserts the tree is clean afterwards.
 */

/** One extracted example, as `scripts/import-doc-examples.ts` writes it. */
interface DocExample {
  readonly file: string;
  readonly line: number;
  readonly context: string;
  readonly json: unknown;
}

/** Read one service's committed examples. */
function examplesOf(service: string): DocExample[] {
  const file = path.join(repoRoot, "test", "fixtures", "doc-examples", `${service}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as DocExample[];
}

/** A list envelope: `data` plus the siblings that make it interpretable. */
type Envelope = {
  data?: unknown;
  next_cursor?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
};

/**
 * The subject of an example: a list's rows, or the resource itself.
 *
 * @remarks
 * **The single-resource wrapper is gone.** A resource response *is* the resource now, so this
 * unwraps only a list — recognised by `data` alongside `next_cursor`, which every list carries and
 * nothing else does. Unwrapping `data` unconditionally would strip a *dataset record's own*
 * payload member, which is also called `data`.
 */
function unwrap(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const envelope = value as Envelope;
  return "data" in envelope && "next_cursor" in envelope ? envelope.data : envelope;
}

/** A classification: what an example is, and how to check it. */
interface Classifier {
  /** Reported when a check fails, and when the coverage summary is printed. */
  readonly id: string;
  /** Whether this classifier owns the example. First match wins, so order is significant. */
  matches(example: DocExample): boolean;
  /**
   * How to check it. Omitted for a deliberate out-of-scope classification.
   *
   * @remarks
   * Returns the object to key-check and the spec to check it against — or `null` where the example is a
   * shape the SDK declares no type for and the assertion is only that it parsed.
   */
  readonly check?: (example: DocExample) => { value: object; spec: KeySpec } | null;
}

/** Build a {@link KeySpec}. Both arguments are annotated at the call site, where the compiler checks them. */
function spec(
  all: Readonly<Record<string, true>>,
  required: Readonly<Record<string, true>>,
): KeySpec {
  return { all, required };
}

// ── The key specs. Every one is compiler-checked against the SDK's own type ───────────────────────

const invoiceSpec = spec(
  {
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
  } satisfies AllKeys<Invoice>,
  {
    // Every member is required on the wire now — the nullable ones are present and `null`
    // rather than absent, so a reader never has to tell "absent" from "not set yet".
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
  } satisfies MandatoryKeys<Invoice>,
);

const cancelledInvoiceSpec = spec(
  {
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
    storno_number: true,
  } satisfies AllKeys<CancelledInvoice>,
  {
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
  } satisfies MandatoryKeys<CancelledInvoice>,
);

const downloadLinkSpec = spec(
  { url: true, expires_at: true } satisfies AllKeys<DownloadLink>,
  { url: true, expires_at: true } satisfies MandatoryKeys<DownloadLink>,
);

const paymentSpec = spec(
  {
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
  } satisfies AllKeys<Payment>,
  {
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
  } satisfies MandatoryKeys<Payment>,
);

const refundSpec = spec(
  {
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
  } satisfies AllKeys<Refund>,
  {
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
  } satisfies MandatoryKeys<Refund>,
);

const pageDocumentSpec = spec(
  { page: true, sections: true } satisfies AllKeys<PageDocument>,
  { page: true, sections: true } satisfies MandatoryKeys<PageDocument>,
);

const identitySpec = spec(
  { key: true, site: true } satisfies AllKeys<ClientIdentity>,
  { key: true, site: true } satisfies MandatoryKeys<ClientIdentity>,
);

const siteSpec = spec(
  {
    slug: true,
    name: true,
    locale: true,
    locales: true,
    default_locale: true,
    settings: true,
  } satisfies AllKeys<ContentSite>,
  {
    slug: true,
    name: true,
    locale: true,
    locales: true,
    default_locale: true,
    settings: true,
  } satisfies MandatoryKeys<ContentSite>,
);

const publishedPageSpec = spec(
  {
    slug: true,
    title: true,
    version: true,
    published_at: true,
  } satisfies AllKeys<PublishedPageSummary>,
  {
    slug: true,
    title: true,
    version: true,
    published_at: true,
  } satisfies MandatoryKeys<PublishedPageSummary>,
);

const itemSpec = spec(
  {
    // A collection item is still keyed by `id`, not `public_id` — the identifier rule applies
    // per resource, and this one was never exposed under a second name.
    id: true,
    collection_key: true,
    slug: true,
    position: true,
    status: true,
    published_at: true,
    created_at: true,
    updated_at: true,
    values: true,
  } satisfies AllKeys<CollectionItem>,
  {
    id: true,
    slug: true,
    position: true,
    status: true,
    values: true,
  } satisfies MandatoryKeys<CollectionItem>,
);

const recordSpec = spec(
  {
    public_id: true,
    dataset_key: true,
    external_id: true,
    data: true,
    withheld: true,
    occurred_at: true,
    created_at: true,
    updated_at: true,
  } satisfies AllKeys<DatasetRecord>,
  {
    public_id: true,
    dataset_key: true,
    external_id: true,
    data: true,
    withheld: true,
    occurred_at: true,
  } satisfies MandatoryKeys<DatasetRecord>,
);

const assetSpec = spec(
  {
    public_id: true,
    site_id: true,
    pathname: true,
    url: true,
    content_type: true,
    size: true,
    width: true,
    height: true,
    uploaded_by: true,
    created_at: true,
    references: true,
  } satisfies AllKeys<ContentAsset>,
  {
    public_id: true,
    site_id: true,
    pathname: true,
    url: true,
    content_type: true,
    size: true,
    uploaded_by: true,
    references: true,
  } satisfies MandatoryKeys<ContentAsset>,
);

const uploadTokenSpec = spec(
  {
    token: true,
    pathname: true,
    maximum_size_in_bytes: true,
    allowed_content_types: true,
  } satisfies AllKeys<UploadToken>,
  {
    token: true,
    pathname: true,
    maximum_size_in_bytes: true,
    allowed_content_types: true,
  } satisfies MandatoryKeys<UploadToken>,
);

const aggregateSpec = spec(
  { key: true, count: true, sum: true } satisfies AllKeys<AggregateGroup>,
  { key: true } satisfies MandatoryKeys<AggregateGroup>,
);

const deliverySpec = spec(
  {
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
  } satisfies AllKeys<WebhookDelivery>,
  {
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
  } satisfies MandatoryKeys<WebhookDelivery>,
);

/**
 * The delivered event envelope.
 *
 *
 * Every event from every Lamido service is this shape now. The resource blocks moved inside `data`,
 * so the union's two branches differ only in what `data` holds — which means one key spec covers
 * both, where the old top-level `payment` / `refund` split needed an `Exclude` to describe.
 */
const webhookEventSpec = spec(
  {
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
  } satisfies AllKeys<PaymentWebhookEvent>,
  {
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
  } satisfies MandatoryKeys<PaymentWebhookEvent>,
);

/** content-service's `/healthz` body: `{ status: "ok" }`, and nothing beside it. */
const contentHealthSpec = spec(
  { status: true } satisfies AllKeys<ContentHealth>,
  { status: true } satisfies MandatoryKeys<ContentHealth>,
);

/**
 * invoice-service's health body.
 *
 * @remarks
 * Unlike content-service, this route still reports the database — and both the healthy and the
 * degraded body now arrive at `200`, so `status` is the only thing that says which.
 */
const healthSpec = spec(
  { status: true, db: true, code: true } satisfies AllKeys<InvoiceHealth>,
  { status: true } satisfies MandatoryKeys<InvoiceHealth>,
);

// ── Shared classifications ───────────────────────────────────────────────────────────────────────

/** Anything on the admin tier. Out of v1's surface entirely — no SDK type could be checked against it. */
const adminTier: Classifier = {
  id: "out of scope: admin tier",
  matches: (example) =>
    example.file === "admin-api.md" || /\/(api\/)?admin\//.test(example.context),
};

/**
 * An RFC 9457 problem document. All three services now, where two used an `{ error }` envelope.
 *
 * @remarks
 * Checked by hand rather than by key spec: the SDK models this as an *error class*, not as a wire
 * type, so there is no `T` to derive keys from. What is asserted instead is the part the shared
 * reader depends on — the five core members are present, and `type` is a URN whose slug is one of
 * the closed set.
 */
function problemDocument(id: string): Classifier {
  const slugs = new Set([
    "validation",
    "unauthorized",
    "forbidden",
    "not-found",
    "conflict",
    "payload-too-large",
    "rate-limit",
    "internal",
  ]);

  return {
    id,
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "type" in (example.json as object) &&
      String((example.json as { type: unknown }).type).startsWith("urn:"),
    check: (example) => {
      const problem = example.json as Record<string, unknown>;
      for (const member of ["type", "title", "status", "detail", "instance"]) {
        expect(problem, `${example.file}:${example.line} is missing ${member}`).toHaveProperty(
          member,
        );
      }
      const type = String(problem.type);
      expect(slugs.has(type.slice(type.lastIndexOf(":") + 1)), `unknown slug in ${type}`).toBe(
        true,
      );
      return null;
    },
  };
}

/**
 * A pre-RFC-9457 `{ error: { code, message, details } }` envelope still shown in the docs.
 *
 * @remarks
 * **This is a finding, not a shape the SDK supports.** conventions §4 of every service now says
 * every failure is `application/problem+json`, and the SDK reads only that. A handful of Markdown
 * blocks were not updated with the rest, so they still show the envelope the services stopped
 * sending.
 *
 * Classified explicitly rather than left unclaimed so the suite stays green while *recording* the
 * divergence: an unclaimed example says "nobody looked at this", and these have been looked at.
 * The entry goes when the documentation is corrected upstream.
 */
function staleErrorEnvelope(id: string): Classifier {
  return {
    id,
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "error" in (example.json as object),
  };
}

/** A request body the SDK sends but declares no named response type for. Asserted only to parse. */
function requestBody(id: string, matches: Classifier["matches"]): Classifier {
  return { id, matches };
}

// ── content-service ──────────────────────────────────────────────────────────────────────────────

const contentClassifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("content: problem document"),
  staleErrorEnvelope("content: STALE doc — pre-RFC-9457 error envelope"),
  {
    id: "content: Health",
    matches: (example) => {
      const data = unwrap(example.json);
      return (
        typeof data === "object" &&
        data !== null &&
        Object.keys(data).length === 1 &&
        "status" in data
      );
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: contentHealthSpec }),
  },
  {
    id: "content: PublishedPageSummary",
    matches: (example) => {
      const data = unwrap(example.json);
      return (
        typeof data === "object" &&
        data !== null &&
        !Array.isArray(data) &&
        "published_at" in data &&
        "title" in data &&
        "version" in data
      );
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: publishedPageSpec }),
  },
  {
    id: "content: PageDocument",
    matches: (example) => {
      const data = unwrap(example.json);
      return typeof data === "object" && data !== null && "page" in data && "sections" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: pageDocumentSpec }),
  },
  {
    id: "content: ClientIdentity",
    matches: (example) => {
      const data = unwrap(example.json);
      return typeof data === "object" && data !== null && "key" in data && "site" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: identitySpec }),
  },
  {
    id: "content: ContentSite",
    matches: (example) => {
      const data = unwrap(example.json);
      return typeof data === "object" && data !== null && "default_locale" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: siteSpec }),
  },
  {
    id: "content: UploadToken",
    matches: (example) => {
      const data = unwrap(example.json);
      return typeof data === "object" && data !== null && "token" in data && "pathname" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: uploadTokenSpec }),
  },
  {
    id: "content: ContentAsset",
    matches: (example) => {
      const data = unwrap(example.json);
      // `references` is what makes it a response: a registration request carries no such member,
      // and `pathname` + `url` alone match the request body too.
      return typeof data === "object" && data !== null && "references" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: assetSpec }),
  },
  {
    id: "content: PublishedPageSummary[]",
    matches: (example) => {
      const data = unwrap(example.json);
      return (
        Array.isArray(data) && data.length > 0 && "published_at" in data[0] && "title" in data[0]
      );
    },
    check: (example) => ({
      value: (unwrap(example.json) as object[])[0] as object,
      spec: publishedPageSpec,
    }),
  },
  {
    id: "content: VersionSummary[]",
    matches: (example) => {
      const data = unwrap(example.json);
      return Array.isArray(data) && data.length > 0 && "published_by" in data[0];
    },
  },
  {
    id: "content: CollectionItem[]",
    matches: (example) => {
      const data = unwrap(example.json);
      return Array.isArray(data) && data.length > 0 && "collection_key" in data[0];
    },
    check: (example) => ({
      value: (unwrap(example.json) as object[])[0] as object,
      spec: itemSpec,
    }),
  },
  {
    id: "content: AggregateGroup[]",
    matches: (example) => {
      const data = unwrap(example.json);
      return Array.isArray(data) && data.length > 0 && "count" in data[0];
    },
    check: (example) => ({
      value: (unwrap(example.json) as object[])[0] as object,
      spec: aggregateSpec,
    }),
  },
  {
    id: "content: CollectionItem",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "collection_key" in (example.json as object),
    check: (example) => ({ value: example.json as object, spec: itemSpec }),
  },
  {
    id: "content: DatasetRecord",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "dataset_key" in (example.json as object),
    check: (example) => ({ value: example.json as object, spec: recordSpec }),
  },
  requestBody(
    "content: request body",
    (example) =>
      example.file === "examples.http" ||
      // The one Markdown block that is a request body: `{ contentType, filename }`.
      (typeof example.json === "object" &&
        example.json !== null &&
        "filename" in (example.json as object)),
  ),
  {
    id: "out of scope: a structure definition, which only staff can write",
    matches: (example) => example.file === "data-model.md",
  },
];

// ── invoice-service ──────────────────────────────────────────────────────────────────────────────

const invoiceClassifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("invoice: problem document"),
  {
    id: "invoice: CancelledInvoice",
    matches: (example) => {
      const data = unwrap(example.json);
      return typeof data === "object" && data !== null && "storno_number" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: cancelledInvoiceSpec }),
  },
  {
    id: "invoice: DownloadLink",
    matches: (example) => {
      const data = unwrap(example.json);
      return typeof data === "object" && data !== null && "expires_at" in data && "url" in data;
    },
    check: (example) => ({ value: unwrap(example.json) as object, spec: downloadLinkSpec }),
  },
  {
    id: "invoice: Invoice",
    matches: (example) => {
      const value = unwrap(example.json) ?? example.json;
      return (
        typeof value === "object" &&
        value !== null &&
        "provider_config_id" in value &&
        "status" in value
      );
    },
    check: (example) => ({
      value: (unwrap(example.json) ?? example.json) as object,
      spec: invoiceSpec,
    }),
  },
  {
    id: "invoice: health",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "status" in (example.json as object) &&
      Object.keys(example.json as object).every((key) => ["status", "db", "code"].includes(key)),
    check: (example) => ({ value: example.json as object, spec: healthSpec }),
  },
  {
    id: "out of scope: a partial illustration, not a full resource",
    // conventions.md shows fragments to make one point — that a single resource is unwrapped,
    // that money is a minor-unit string — rather than a whole body. A key check against the
    // full type would fail on every member the fragment deliberately leaves out.
    matches: (example) =>
      example.file === "conventions.md" &&
      typeof example.json === "object" &&
      example.json !== null &&
      Object.keys(example.json as object).length <= 2,
  },
  {
    id: "invoice: inbound webhook event",
    // The estate envelope, received on /v1/hooks/{source_service}. The SDK sends invoices; it
    // does not model what this service receives from payment-service.
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "event_type" in (example.json as object) &&
      "occurred_at" in (example.json as object),
  },
  {
    id: "out of scope: an empty body, sent to prove a route answers",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      Object.keys(example.json as object).length === 0,
  },
  {
    id: "invoice: CreateInvoiceInput",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "items" in (example.json as object) &&
      "partner" in (example.json as object),
  },
  {
    id: "out of scope: a validation_error's Zod flatten, which the SDK types as details",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "details" in (example.json as object),
  },
  {
    id: "out of scope: an envelope illustration with no payload of its own",
    matches: (example) => {
      const data = unwrap(example.json);
      return typeof data === "object" && data !== null && Object.keys(data).join() === "id";
    },
  },
  {
    // In `workflows.md`, whose context is a heading rather than a request line — so the admin-path rule
    // above cannot see it. Credentials are maintained on the `iad_` tier, which v1 does not cover.
    id: "out of scope: an admin integration body",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "provider" in (example.json as object) &&
      ("secret" in (example.json as object) || "config" in (example.json as object)),
  },
];

// ── payment-service ──────────────────────────────────────────────────────────────────────────────

const paymentClassifiers: readonly Classifier[] = [
  adminTier,
  {
    id: "out of scope: the /healthz body, which the SDK declares no type for",
    // payment-service's liveness body carries `version`, `commit` and `now` as well as the
    // database status. The SDK does not model it: nothing in the merchant surface reads it.
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "status" in (example.json as object) &&
      "db" in (example.json as object),
  },
  {
    id: "payment: PaymentWebhookEvent",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "event_type" in (example.json as object),
    check: (example) => ({ value: example.json as object, spec: webhookEventSpec }),
  },
  {
    id: "payment: RFC 7807 Problem",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "type" in (example.json as object) &&
      "instance" in (example.json as object),
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
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "payment_public_id" in (example.json as object),
    check: (example) => ({ value: example.json as object, spec: refundSpec }),
  },
  {
    id: "payment: Payment",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "public_id" in (example.json as object) &&
      "merchant_payment_ref" in (example.json as object),
    check: (example) => ({ value: example.json as object, spec: paymentSpec }),
  },
  {
    id: "payment: WebhookDelivery[]",
    matches: (example) => Array.isArray(example.json),
    check: (example) => ({ value: (example.json as object[])[0] as object, spec: deliverySpec }),
  },
  {
    id: "payment: CreatePaymentInput",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "merchant_payment_ref" in (example.json as object),
  },
  {
    id: "payment: CreateRefundInput",
    matches: (example) =>
      typeof example.json === "object" &&
      example.json !== null &&
      "amount_minor" in (example.json as object),
  },
  {
    id: "out of scope: an abbreviated orientation snippet, not a full response",
    matches: (example) => example.file === "README.md",
  },
];

/** Which classifier owns an example, if any. */
function classify(example: DocExample, classifiers: readonly Classifier[]): Classifier | undefined {
  return classifiers.find((classifier) => classifier.matches(example));
}

/**
 * The three services, with how much of each is actually key-checked.
 *
 * @remarks
 * `minChecked` and `minTypes` are floors, not targets — they exist so a classifier that quietly lost its
 * `check` in a refactor fails loudly instead of silently asserting nothing. Each number is a fact about
 * how many documented examples this SDK has a declared type for; raise one when a type gains an example.
 * invoice-service's is the lowest because most of its documented JSON is admin-tier, and the one
 * `CancelledInvoice` example upstream abbreviates itself with an ellipsis key.
 */
const services = [
  { id: "content-service", classifiers: contentClassifiers, minChecked: 8, minTypes: 6 },
  { id: "invoice-service", classifiers: invoiceClassifiers, minChecked: 3, minTypes: 3 },
  { id: "payment-service", classifiers: paymentClassifiers, minChecked: 6, minTypes: 4 },
] as const;

describe.each(services)(
  "$id's documented examples",
  ({ id, classifiers, minChecked, minTypes }) => {
    const examples = examplesOf(id);

    it("has examples to check at all", () => {
      // Guards the whole file: if extraction silently produced nothing, every assertion below would pass.
      expect(examples.length).toBeGreaterThan(10);
    });

    it("classifies every one of them", () => {
      // The assertion that keeps this suite honest. An example nobody has looked at is a failure, not a
      // pass — otherwise a new upstream shape lands silently and this file reports green over it.
      const unclaimed = examples
        .filter((example) => classify(example, classifiers) === undefined)
        .map(
          (example) => `${example.file}:${example.line} {${Object.keys(example.json as object)}}`,
        );

      expect(unclaimed).toEqual([]);
    });

    it("matches the SDK's declared keys, in both directions", () => {
      const divergences: string[] = [];

      for (const example of examples) {
        const classifier = classify(example, classifiers);
        const target = classifier?.check?.(example);
        if (!target) continue;

        const { undeclared, missing } = checkKeys(target.value, target.spec);
        const where = `${example.file}:${example.line} (${classifier?.id})`;

        // A key the service documents and the SDK's type does not declare. Either the type is behind the
        // service, or the example is wrong — and both are worth a build failure.
        for (const key of undeclared) divergences.push(`${where}: undeclared key "${key}"`);
        // A key the SDK insists on that the documented response omits. Usually the SDK guessing.
        for (const key of missing) divergences.push(`${where}: required key "${key}" absent`);
      }

      expect(divergences).toEqual([]);
    });

    it("actually key-checks a meaningful share of them, against distinct types", () => {
      // Without this the suite above could be green because nothing was checked. It is the same trap the
      // classification rule guards, one level down: a classifier whose `check` was dropped in a refactor
      // silently stops asserting, and every remaining assertion still passes.
      const checked = examples
        .map((example) => classify(example, classifiers))
        .filter((classifier) => classifier?.check !== undefined)
        .map((classifier) => classifier?.id ?? "");

      expect(checked.length, checked.join(", ")).toBeGreaterThanOrEqual(minChecked);
      // More than one type, so a single over-broad classifier cannot be doing all the work.
      expect(new Set(checked).size).toBeGreaterThanOrEqual(minTypes);
    });
  },
);

describe("the fixtures themselves", () => {
  it("carry no deployment host and no credential-shaped string", () => {
    // The docs are full of both; `sanitizeExample` rewrites them on the way in. The repository-wide leak
    // guard scans these files too — this is the assertion that says *why* they are clean.
    for (const { id } of services) {
      const raw = readFileSync(
        path.join(repoRoot, "test", "fixtures", "doc-examples", `${id}.json`),
        "utf8",
      );
      expect(raw, id).not.toMatch(/lamido\.hu/);
      expect(raw, id).not.toMatch(
        /\b(csk|cpk|isk|iad|pmk|pad|cad|whsec)_(?!YOUR_)[A-Za-z0-9_-]{8,}/,
      );
    }
  });

  it("record where each example came from, so a failure is findable upstream", () => {
    for (const { id } of services) {
      for (const example of examplesOf(id)) {
        expect(example.file, id).toMatch(/\.(md|http)$/);
        expect(example.line).toBeGreaterThan(0);
        expect(example.context.length).toBeGreaterThan(0);
      }
    }
  });
});
