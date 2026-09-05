import type {
  EmailWebhookEvent,
  Message,
  SendMessageInput,
  StartedOauthFlow,
} from "@lazslov/email";
import type { AllKeys, MandatoryKeys } from "../type-keys.js";
import {
  adminTier,
  type Classifier,
  isRecord,
  problemDocument,
  type ServiceExamples,
  spec,
} from "./shared.js";

/** email-service's documented examples, and the `@lazslov/email` type each one is checked against. */

/**
 * A message, as the send and every read answer it.
 *
 * @remarks
 * `variables` is deliberately absent — the service never returns it on a tenant read — so a doc
 * example that carried it would fail here, which is the right outcome.
 */
const messageSpec = spec(
  {
    public_id: true,
    status: true,
    stream: true,
    template: true,
    to: true,
    subject: true,
    from: true,
    provider: true,
    provider_message_id: true,
    attachment_count: true,
    attempts: true,
    error_code: true,
    metadata: true,
    created_at: true,
  } satisfies AllKeys<Message>,
  {
    public_id: true,
    status: true,
    stream: true,
    template: true,
    to: true,
    from: true,
    created_at: true,
  } satisfies MandatoryKeys<Message>,
);

/**
 * The send body.
 *
 * @remarks
 * Checked as a request rather than parsed only, because the service **rejects unknown fields**: a
 * documented body carrying a member the SDK does not declare would be a body the service refuses.
 * The one deliberately malformed example — `"subjekt"` — is classified out of scope above this.
 */
const sendMessageSpec = spec(
  {
    stream: true,
    template: true,
    to: true,
    subject: true,
    variables: true,
    attachments: true,
    metadata: true,
    headers: true,
  } satisfies AllKeys<SendMessageInput>,
  { template: true, to: true } satisfies MandatoryKeys<SendMessageInput>,
);

const startedOauthFlowSpec = spec(
  { authorize_url: true, expires_at: true } satisfies AllKeys<StartedOauthFlow>,
  { authorize_url: true, expires_at: true } satisfies MandatoryKeys<StartedOauthFlow>,
);

/**
 * The delivered event envelope, as webhooks.md §2 shows it.
 *
 * @remarks
 * The arms of the union differ only in what `data` holds, so one key spec covers all of them. Note
 * `schema_version` and no `tenant` or `causation_id` — this service's published envelope differs from
 * payment-service's, and the type follows the Markdown.
 */
const envelopeKeys = {
  schema_version: true,
  event_id: true,
  event_type: true,
  occurred_at: true,
  service: true,
  account_id: true,
  correlation_id: true,
  hop: true,
  data: true,
} as const;

const webhookEventSpec = spec(
  envelopeKeys satisfies AllKeys<EmailWebhookEvent>,
  envelopeKeys satisfies MandatoryKeys<EmailWebhookEvent>,
);

const classifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("email: problem document"),
  {
    // examples.http shows a body with a typo'd `"subjekt"` to prove unknown fields are a 400, not
    // stripped. A key check would rightly fail on it; it is out of scope because it is wrong on
    // purpose.
    id: "out of scope: a deliberately malformed send body, shown to prove unknown fields are rejected",
    matches: (example) => isRecord(example.json) && "subjekt" in example.json,
  },
  {
    // Before the send body: a message carries `template` and `to` as well, and `public_id` is what
    // tells a response from a request.
    id: "email: Message",
    matches: (example) =>
      isRecord(example.json) && "public_id" in example.json && "status" in example.json,
    check: (example) => ({ value: example.json as object, spec: messageSpec }),
  },
  {
    id: "email: SendMessageInput",
    matches: (example) =>
      isRecord(example.json) && "template" in example.json && "to" in example.json,
    check: (example) => ({ value: example.json as object, spec: sendMessageSpec }),
  },
  {
    id: "email: StartedOauthFlow",
    matches: (example) => isRecord(example.json) && "authorize_url" in example.json,
    check: (example) => ({ value: example.json as object, spec: startedOauthFlowSpec }),
  },
  {
    id: "email: EmailWebhookEvent",
    matches: (example) =>
      isRecord(example.json) && "event_type" in example.json && "event_id" in example.json,
    check: (example) => ({ value: example.json as object, spec: webhookEventSpec }),
  },
  {
    // A log line, not a response. `event` is what every one of them carries.
    id: "out of scope: a structured log line, which no SDK type describes",
    matches: (example) =>
      example.file === "operations.md" && isRecord(example.json) && "event" in example.json,
  },
];

export const emailExamples: ServiceExamples = {
  id: "email-service",
  classifiers,
  minChecked: 11,
  minTypes: 5,
};
