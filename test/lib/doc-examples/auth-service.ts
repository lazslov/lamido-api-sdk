import type {
  AuthorizeDecision,
  AuthorizeInput,
  AuthWebhookEvent,
  BrandingInput,
  ExchangeInput,
  GoogleStartInput,
  LoginSettingsInput,
  PermissionsInput,
  Subscription,
  SwitchOrganizationInput,
  UpdateWebsiteInput,
  VerifyCustomerSessionInput,
} from "@lazslov/auth";
import type { AllKeys, MandatoryKeys } from "../type-keys.js";
import {
  adminTier,
  type Classifier,
  isRecord,
  problemDocument,
  type ServiceExamples,
  spec,
} from "./shared.js";

/** auth-service's documented examples, and the `@lazslov/auth` type each one is checked against. */

/**
 * The decision, which is the whole body of a `POST /v1/authorize` response.
 *
 * @remarks
 * One member, and it is the one enum in this API that cannot grow. A second member appearing in a
 * documented example would mean the answer had started to explain itself, which the service refuses
 * to do — so this key check is worth having on a single-member type.
 */
const decisionSpec = spec(
  { decision: true } satisfies AllKeys<AuthorizeDecision>,
  { decision: true } satisfies MandatoryKeys<AuthorizeDecision>,
);

/**
 * What `POST /v1/authorize` asks.
 *
 * @remarks
 * `principal` is checked as a key, not as a shape: the removed `{kind, public_id}` form is a `400`
 * and no documented example carries it, so a nested spec would assert nothing the union does not.
 */
const authorizeInputSpec = spec(
  {
    principal: true,
    organization_id: true,
    website_id: true,
    permission: true,
  } satisfies AllKeys<AuthorizeInput>,
  {
    principal: true,
    organization_id: true,
    permission: true,
  } satisfies MandatoryKeys<AuthorizeInput>,
);

/** The same body minus `permission` — `POST /v1/permissions`, a read with a body. */
const permissionsInputSpec = spec(
  {
    principal: true,
    organization_id: true,
    website_id: true,
  } satisfies AllKeys<PermissionsInput>,
  { principal: true, organization_id: true } satisfies MandatoryKeys<PermissionsInput>,
);

/**
 * A subscription, as `GET /v1/subscriptions` and the `subscription.*` events carry it.
 *
 * @remarks
 * Every member is required here although the generated schema marks all ten optional — the
 * documented example carries all ten, which is what this check holds the hand-written type to.
 */
const subscriptionKeys = {
  public_id: true,
  organization: true,
  website: true,
  plan: true,
  status: true,
  period_start: true,
  period_end: true,
  past_due_at: true,
  created_at: true,
  updated_at: true,
} as const;

const subscriptionSpec = spec(
  subscriptionKeys satisfies AllKeys<Subscription>,
  subscriptionKeys satisfies MandatoryKeys<Subscription>,
);

/**
 * What `POST /v1/customer-sessions/verify` takes.
 *
 * @remarks
 * The check that matters most in this file: the field is `token`, not `session_token`, and `website`
 * is required. An example spelling it the other way is the `400` an integrator lost time on.
 */
const verifyInputSpec = spec(
  { website: true, token: true } satisfies AllKeys<VerifyCustomerSessionInput>,
  { website: true, token: true } satisfies MandatoryKeys<VerifyCustomerSessionInput>,
);

/** What both magic-link exchanges take. */
const exchangeInputSpec = spec(
  { login_request: true, exchange_code: true } satisfies AllKeys<ExchangeInput>,
  { login_request: true, exchange_code: true } satisfies MandatoryKeys<ExchangeInput>,
);

/** What both Google starts take. `return_url` is optional, so nothing is mandatory. */
const googleStartInputSpec = spec(
  { return_url: true } satisfies AllKeys<GoogleStartInput>,
  {} satisfies MandatoryKeys<GoogleStartInput>,
);

/**
 * What `PATCH /v1/websites/{id}/login-settings` takes.
 *
 * @remarks
 * `google_client_secret` goes in here and never comes back — only its `last4` and `fingerprint` do —
 * so the write type and the read type deliberately differ, and only the write one is checked.
 */
const loginSettingsInputSpec = spec(
  {
    magic_link_enabled: true,
    google_enabled: true,
    google_client_id: true,
    google_client_secret: true,
    redirect_urls: true,
  } satisfies AllKeys<LoginSettingsInput>,
  {} satisfies MandatoryKeys<LoginSettingsInput>,
);

/** What `PATCH /v1/websites/{id}/branding` takes: two fields, and anything else is a `400`. */
const brandingInputSpec = spec(
  { sender_name: true, reply_to: true } satisfies AllKeys<BrandingInput>,
  {} satisfies MandatoryKeys<BrandingInput>,
);

/** What `POST /v1/organizations/switch` takes. `null` clears the active organization. */
const switchInputSpec = spec(
  { organization_id: true } satisfies AllKeys<SwitchOrganizationInput>,
  { organization_id: true } satisfies MandatoryKeys<SwitchOrganizationInput>,
);

/** What `PATCH /v1/websites/{id}` takes. Both members optional; a rename sends `name` alone. */
const updateWebsiteInputSpec = spec(
  { name: true, primary_domain: true } satisfies AllKeys<UpdateWebsiteInput>,
  {} satisfies MandatoryKeys<UpdateWebsiteInput>,
);

/**
 * The event envelope, as webhooks.md §3 shows it.
 *
 * @remarks
 * The arms of the union differ only in what `data` holds, so one key spec covers all of them. Note
 * `contract_version`, `tenant` and `causation_id` — this service's envelope matches payment-service's
 * and **not** email-service's, which spells the first member `schema_version` and carries neither of
 * the other two.
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
  envelopeKeys satisfies AllKeys<AuthWebhookEvent>,
  envelopeKeys satisfies MandatoryKeys<AuthWebhookEvent>,
);

const classifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("auth: problem document"),
  {
    // `/v1/hooks/*` is sealed with a 404 by design: auth-service is a pure emitter and receives no
    // events. The body is a placeholder proving the namespace answers, so there is nothing to check.
    id: "out of scope: the sealed inbound namespace, which answers 404 by design",
    matches: (example) => /\/v1\/hooks\//.test(example.context),
  },
  {
    id: "auth: AuthWebhookEvent",
    matches: (example) =>
      isRecord(example.json) && "event_type" in example.json && "event_id" in example.json,
    check: (example) => ({ value: example.json as object, spec: webhookEventSpec }),
  },
  {
    // Before every request body: a subscription is the one documented response that carries a period.
    id: "auth: Subscription",
    matches: (example) =>
      isRecord(example.json) && "public_id" in example.json && "period_start" in example.json,
    check: (example) => ({ value: example.json as object, spec: subscriptionSpec }),
  },
  {
    id: "auth: AuthorizeDecision",
    matches: (example) => isRecord(example.json) && "decision" in example.json,
    check: (example) => ({ value: example.json as object, spec: decisionSpec }),
  },
  {
    // Before the permissions body, which is this one minus `permission`.
    id: "auth: AuthorizeInput",
    matches: (example) =>
      isRecord(example.json) && "principal" in example.json && "permission" in example.json,
    check: (example) => ({ value: example.json as object, spec: authorizeInputSpec }),
  },
  {
    id: "auth: PermissionsInput",
    matches: (example) => isRecord(example.json) && "principal" in example.json,
    check: (example) => ({ value: example.json as object, spec: permissionsInputSpec }),
  },
  {
    id: "auth: VerifyCustomerSessionInput",
    matches: (example) =>
      isRecord(example.json) && "website" in example.json && "token" in example.json,
    check: (example) => ({ value: example.json as object, spec: verifyInputSpec }),
  },
  {
    id: "auth: ExchangeInput",
    matches: (example) => isRecord(example.json) && "login_request" in example.json,
    check: (example) => ({ value: example.json as object, spec: exchangeInputSpec }),
  },
  {
    id: "auth: GoogleStartInput",
    matches: (example) => isRecord(example.json) && "return_url" in example.json,
    check: (example) => ({ value: example.json as object, spec: googleStartInputSpec }),
  },
  {
    id: "auth: LoginSettingsInput",
    matches: (example) => isRecord(example.json) && "redirect_urls" in example.json,
    check: (example) => ({ value: example.json as object, spec: loginSettingsInputSpec }),
  },
  {
    id: "auth: BrandingInput",
    matches: (example) => isRecord(example.json) && "sender_name" in example.json,
    check: (example) => ({ value: example.json as object, spec: brandingInputSpec }),
  },
  {
    // After the two authorization bodies, which carry `organization_id` as well.
    id: "auth: SwitchOrganizationInput",
    matches: (example) => isRecord(example.json) && "organization_id" in example.json,
    check: (example) => ({ value: example.json as object, spec: switchInputSpec }),
  },
  {
    // The website rename. Matched on the route too, because `{ "name": … }` alone is also the shape
    // of a website create and of an organization create.
    id: "auth: UpdateWebsiteInput",
    matches: (example) =>
      /\/v1\/websites\//.test(example.context) && isRecord(example.json) && "name" in example.json,
    check: (example) => ({ value: example.json as object, spec: updateWebsiteInputSpec }),
  },
  {
    // conventions.md §3 shows the empty collection envelope. The SDK exports no type with these
    // keys: `callCursorList` renames them to `{ items, nextCursor }` so core's paginator reads them,
    // and the wire envelope stays internal. There is nothing to key-check it against.
    id: "out of scope: the collection envelope, which the SDK renames to a CursorPage",
    matches: (example) =>
      isRecord(example.json) && "data" in example.json && "next_cursor" in example.json,
  },
];

export const authExamples: ServiceExamples = {
  id: "auth-service",
  classifiers,
  minChecked: 20,
  minTypes: 13,
};
