/**
 * Named aliases over the generated contract, and the request shapes the SDK writes by hand.
 *
 * @remarks
 * Response shapes are aliases of `src/generated/schema.ts`, never hand-copied, so a contract change
 * breaks the build rather than drifting quietly past it. Wire names stay exactly as the service
 * spells them — `public_id`, `template_key`, `provider_message_id` — so a response and a `curl` an
 * integrator pastes while debugging read side by side.
 *
 * The **send body** is hand-written, for two reasons. The generated type marks the defaulted
 * `stream`, `variables` and `attachments` *required*, which would force every caller to supply three
 * values the service is happy to choose. And it types `variables` as `Record<string, never>`, which
 * no real send can satisfy. `test/type-safety.test.ts` asserts a populated {@link SendMessageInput}
 * still fits the generated request type, so a renamed field on the wire fails the type-check the
 * same way an alias would.
 */

import type { CursorPage } from "@lazslov/api-core";
import type { MinorAmount } from "./amount.js";
import type { components, paths } from "./generated/schema.js";
import type { MessageStatus } from "./status.js";

/** @internal Shorthand for the generated component schemas. */
type Schemas = components["schemas"];

/** Which adapter sent a message. Nothing in a consumer's code should branch on this. */
export type MessageProvider = NonNullable<Schemas["Message"]["provider"]>;

/**
 * A message, as every tenant endpoint returns it.
 *
 * @remarks
 * Note what is **not** here: `variables`. It is deliberately absent from every tenant read —
 * echoing a magic link or a one-time code out of a read endpoint would turn a leaked key into a
 * token oracle. Keep your own copy of anything you need back; `metadata` is echoed, `variables`
 * never is. Reading `message.variables` is a compile error, which is the point.
 *
 * `from` is the identity the message **went out as**, not the tenant's current one. `to` is `null`
 * once the recipient's personal data has been erased. `provider_message_id` is `null` for SMTP,
 * which issues none. `status` is widened to accept a value added upstream — see
 * {@link MessageStatus}.
 */
export type Message = Omit<Schemas["Message"], "status"> & { readonly status: MessageStatus };

/**
 * One row of a message's timeline.
 *
 * @remarks
 * `at` is `occurred_at` — the **provider's** clock where there is one, not when the row was
 * written. A provider replaying a week of history writes rows dated last Tuesday, and the service
 * sorts by that so last Tuesday's bounce does not read as today's.
 */
export type MessageEvent = Omit<Schemas["MessageEvent"], "type"> & {
  readonly type?: MessageStatus;
};

/** How a timeline row came to be written. */
export type MessageEventSource = NonNullable<Schemas["MessageEvent"]["source"]>;

/**
 * A message with its timeline, as `getMessage` returns it.
 *
 * @remarks
 * The contract marks `events` optional; the Markdown shows it on every read. The alias follows the
 * contract, so a reader guards it.
 */
export type MessageDetail = Message & { readonly events?: readonly MessageEvent[] };

/** One page of messages, newest first. There is no `total`, anywhere, deliberately. */
export type MessageList = CursorPage<Message>;

/** Which template renders the message. */
export interface TemplateRef {
  /** From the catalogue — `order.confirmation`, `auth.magic_link`, … An unknown key is a `400`. */
  readonly key: string;
  /**
   * Omit for the latest `active` version.
   *
   * @remarks
   * **Pinned at accept time.** The version resolved *now* is written to the row, so a template edit
   * a minute later cannot change what this message renders.
   */
  readonly version?: number;
}

/**
 * A `type: currency` template variable.
 *
 * @remarks
 * `amount` is a **decimal string of minor units**, and a JSON number is a `400` — the rule changed
 * at the service's `7cbff0e`, and the number shape this folder used to publish is refused. Build
 * it with {@link ./amount.js | minorAmount}. HUF has zero minor units, so `"38100"` is 38 100 Ft;
 * EUR has two, so `"1000"` is €10.00.
 *
 * `currency` is validated as any three characters, not as ISO 4217: `"abc"` passes and the
 * rendered mail carries it. Send a real code — nothing here can tell you that you did not.
 */
export interface CurrencyVariable {
  readonly amount: MinorAmount;
  readonly currency: string;
}

/** One attachment. ≤ 10 per message, ≤ 3 MB decoded in total, from a type allowlist. */
export interface Attachment {
  /** No path separators, no control characters. */
  readonly filename: string;
  /** Base64. */
  readonly content: string;
  /**
   * Allowlisted, and matched on **type and extension** — a renamed executable is refused twice.
   *
   * @remarks
   * PDF, plain text, CSV, iCalendar, PNG/JPEG/GIF/WebP, the three OOXML documents, and ZIP.
   */
  readonly content_type: string;
}

/**
 * What to send.
 *
 * @remarks
 * There is **no `body` field and no raw HTML**, here or in the service. Sending is template-only,
 * so a leaked key cannot compose an arbitrary phishing mail from a domain the recipient already
 * trusts. Templates are added by an operator, never through this API.
 *
 * **Unknown fields are rejected, not stripped.** A typo'd `"subjekt"` would otherwise send the
 * template default under a `202`, found by your customer. The service reports every offending key
 * at once, each with a JSON Pointer, in `errors`.
 */
export interface SendMessageInput {
  /**
   * Defaults to `"transactional"`, which is also the only stream that is open.
   *
   * @remarks
   * The wire accepts `"marketing"` and refuses it with `409 stream_closed`. The type does not offer
   * it: the column, the quota and the identity exist; the feature does not.
   */
  readonly stream?: "transactional";
  readonly template: TemplateRef;
  /**
   * **Exactly one recipient.** No `cc`, no `bcc`, no arrays.
   *
   * @remarks
   * One message, one recipient, one status. To reach several people, send once per person under a
   * key per message — the same key twice replays the first send.
   */
  readonly to: string;
  /**
   * Taken **literally** — no placeholder interpolation. Defaults to the template's own subject.
   * CRLF-checked at accept time.
   */
  readonly subject?: string;
  /**
   * Validated against the pinned version's descriptors. An unknown name is a `400`, not an empty
   * string in a rendered email.
   *
   * @remarks
   * **Send a value as your user typed it.** The renderer escapes every value before it reaches the
   * HTML body, so escaping here is a bug, not a precaution — `&amp;lt;b&amp;gt;` reaches the
   * recipient escaped twice. A `type: currency` variable is a {@link CurrencyVariable}. A `url`
   * variable with a non-`http(s)` scheme is a `400`.
   *
   * Never returned on a read. Keep your own copy.
   */
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly attachments?: readonly Attachment[];
  /** Opaque to the service, echoed on reads and webhooks. ≤ 20 keys, ≤ 4 KB serialised. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * An **allowlist** of four: `Reply-To`, `In-Reply-To`, `References`, `X-Entity-Ref-ID`.
   * Anything else is a `400`.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A queued message, and whether it already existed.
 *
 * @remarks
 * `replayed: true` means the service answered `200` with the frozen body of an earlier request
 * under the same key — including its `public_id`. Nothing was created, and that is a success.
 * A `202` means this call queued it.
 *
 * In both cases **`message.status` is where the message is now, not "sent"**. A `202` is queued;
 * a replay carries whatever status the first send has reached, and it can be `failed`.
 */
export interface SendMessageResult {
  readonly message: Message;
  readonly replayed: boolean;
}

/**
 * What `startGoogleOauth` takes.
 *
 * @remarks
 * `return_url` **must be under the service's own base URL** — checked at the start, deliberately,
 * so the refusal reaches whoever typed it while the flow is still theirs to fix.
 */
export type OauthStartInput = Schemas["OauthStart"];

/**
 * The consent URL and its expiry.
 *
 * @remarks
 * **Nothing is redirected.** You are a server-side integration, not a browser: hand
 * `authorize_url` to whoever is connecting the mailbox, by whatever channel fits. The `state`
 * inside it is signed, single-use and expires in ten minutes.
 */
export type StartedOauthFlow = Schemas["StartedOauthFlow"];

/** @internal The generated response of the read, kept beside its alias so drift fails the build. */
export type GeneratedMessageDetail =
  paths["/v1/messages/{public_id}"]["get"]["responses"][200]["content"]["application/json"];
