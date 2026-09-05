/**
 * `@lazslov/email` — consumer SDK for email-service's tenant tier.
 *
 * @remarks
 * A small surface around one idea: **you queue a template, you do not send an email.** Four things
 * the package makes hard on purpose:
 *
 * - **There is no `body` field.** {@link SendMessageInput} carries a `template`, one `to` and
 *   `variables` — nothing that could compose raw HTML. That absence is the control that makes a
 *   leaked key unable to write a phishing mail from a domain the recipient already trusts.
 * - **A send cannot happen without an idempotency key.** There is no overload without one, and
 *   `@lazslov/api-core` will not generate one — there is no unsend, so an un-keyed send is one a
 *   network retry can duplicate. The same key is the recovery after a timeout, not a risk.
 * - **`202` means queued.** {@link SendMessageResult} carries the message with `status: "queued"`;
 *   `sent` still is not `delivered`, and for an SMTP tenant `sent` is terminal.
 * - **`variables` never come back on a read.** {@link Message} does not declare the member, so
 *   reading a magic link back off a message is a compile error, as it is a security control at the
 *   service.
 *
 * This package must never reach a browser bundle: an `esk_` key authorises every send for the tenant,
 * and the service rejects any `/v1/*` request carrying `Origin` or `Sec-Fetch-Dest` with a `403`
 * before authentication even runs. There is deliberately no publishable tier.
 *
 * The admin tier (`ead_`), the provider callbacks (`/v1/providers/*`), the inbound house-event
 * receivers (`/v1/hooks/*`) and the cron are out of scope — none of them is yours to call.
 *
 * @example
 * ```ts
 * import "server-only";
 * import { createEmailClient, minorAmount } from "@lazslov/email";
 * import { derivedIdempotencyKey } from "@lazslov/api-core";
 *
 * const email = createEmailClient();
 *
 * const { message } = await email.sendMessage(
 *   {
 *     template: { key: "order.confirmation" },
 *     to: order.customerEmail,
 *     variables: {
 *       orderNumber: order.number,
 *       total: { amount: minorAmount(String(order.totalMinor)), currency: "HUF" },
 *     },
 *     metadata: { order_id: order.id },
 *   },
 *   derivedIdempotencyKey(`order-${order.id}`, 1),
 * );
 * await store(order.id, message.public_id);   // the only handle for reads, cancels and support
 * ```
 */

export { type MinorAmount, minorAmount } from "./amount.js";
export type { EmailRequest, RequestOptions } from "./call.js";
export { createEmailClient, type EmailClient, tryCreateEmailClient } from "./client.js";
export { EmailApiError, type EmailProblemCode } from "./errors.js";
export type { ListMessagesOptions, MessageMethods } from "./messages.js";
export type { OauthMethods } from "./oauth.js";
export { isCancellable, type KnownMessageStatus, type MessageStatus } from "./status.js";
export type {
  Attachment,
  CurrencyVariable,
  Message,
  MessageDetail,
  MessageEvent,
  MessageEventSource,
  MessageList,
  MessageProvider,
  OauthStartInput,
  SendMessageInput,
  SendMessageResult,
  StartedOauthFlow,
  TemplateRef,
} from "./types.js";
export {
  deliveryIdHeader,
  type EmailEventEnvelope,
  type EmailMessageEvent,
  type EmailMessageEventType,
  type EmailWebhookEvent,
  type EmailWebhookEventType,
  type EmailWebhookInput,
  eventIdHeader,
  isKnownEvent,
  isMessageEvent,
  type KnownEmailEvent,
  parseEmailWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyEmailWebhook,
  type WebhookMessageBlock,
} from "./webhook.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that disagrees with
 * the tarball it came from.
 */
export const VERSION = "1.0.2";
