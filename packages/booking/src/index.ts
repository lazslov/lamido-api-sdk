/**
 * `@lazslov/booking` — consumer SDK for booking-service's public and tenant tiers.
 *
 * @remarks
 * **RULE — this service sends nothing. No email, no SMS, no push, ever.** It emits webhooks —
 * `booking.created`, `booking.confirmed`, `booking.reminder_reached` and four more — and whether a
 * human ever hears about any of them is entirely your side of the line. A tenant integrating
 * **without a backend** — a `bpk_` key in page source and nothing else — gets **no confirmation
 * email, no reminder and no cancellation notice**. That is not a gap to be filled later; it is the
 * boundary. If your integration needs a customer to be told something, you need a webhook
 * receiver, and `@lazslov/booking/next` is one.
 *
 * Two clients, because there are two consumer credentials:
 *
 * - {@link createBookingPublicClient} — the `bpk_` tier, safe in a browser. The catalogue,
 *   availability, holds, booking create where the tenant opted in, and the four things a customer
 *   does to their own booking with its capability token.
 * - {@link createBookingClient} — the `bsk_` tier, **server only**. The catalogue and working hours,
 *   the full booking lifecycle, token re-minting, and this tenant's own webhook surface.
 *
 * Five things this package makes hard on purpose:
 *
 * - **A create cannot happen without an idempotency key.** A customer double-clicking Book is the
 *   normal case, and without a key that is two appointments. There is no overload without one, and
 *   `@lazslov/api-core` will not generate one.
 * - **The capability tokens are only on a create's result.** {@link BookingTokens} is reachable from
 *   `createBooking` and nowhere else; reading `booking.management_token` off a `GET` is a compile
 *   error, because no read returns them. And a replay may carry none — {@link CreateResult} says so.
 * - **Every error carries the service's closed `code`**, and `retryable` is read off the service's
 *   own table: `409 slot_taken` is a different slot, `409 idempotency_in_flight` is the same key
 *   after a pause, `422 already_confirmed` is a success.
 * - **Unknown enum members are not errors.** {@link BookingStatus}, {@link CancellationReason} and
 *   the webhook `event_type` all accept a member added upstream after this SDK shipped.
 * - **Money is a minor-unit string and `HUF` is zero-decimal.** `"4500"` is 4500 Ft. There is no
 *   arithmetic here and no helper that divides by 100.
 *
 * `Europe/Budapest` is the only timezone this deployment accepts.
 *
 * @example
 * ```ts
 * // In the browser: find a slot, hold it, book it — with a bpk_ key.
 * const booking = createBookingPublicClient({ baseUrl, apiKey });
 * const { slots } = await booking.getAvailability({ service_id, from, until });
 * const hold = await booking.createHold({ service_id, employee_id, starts_at, nonce });
 * const result = await booking.createBooking(
 *   { service_id, employee_id, starts_at, hold_id: hold.hold_id, nonce, customer },
 *   idempotencyKey(`booking-${formId}`),
 * );
 *
 * // On your server: the confirmation email starts here, not in the service.
 * export const POST = createBookingWebhookHandler({ alreadyProcessed, markProcessed, onEvent });
 * ```
 */

export type { BookingListRequest, BookingRequest, ListOptions, RequestOptions } from "./call.js";
export {
  type BookingClient,
  type BookingPublicClient,
  createBookingClient,
  createBookingPublicClient,
  tryCreateBookingClient,
  tryCreateBookingPublicClient,
} from "./client.js";
export { BookingApiError, type BookingProblemCode } from "./errors.js";
export type { HoldMethods } from "./holds.js";
export type { AvailabilityQuery, PublicAvailabilityMethods } from "./public/availability.js";
export { bookingTokenHeader, type PublicBookingMethods } from "./public/bookings.js";
export type { PublicCatalogueMethods } from "./public/catalogue.js";
export type { AvailabilityRuleMethods } from "./tenant/availability.js";
export type {
  BookingListOptions,
  BookingMethods,
  MintedConfirmationToken,
  MintedManagementToken,
} from "./tenant/bookings.js";
export type { CalendarMethods } from "./tenant/calendar.js";
export type { CatalogueListOptions, CatalogueMethods } from "./tenant/catalogue.js";
export type { IdentityMethods } from "./tenant/identity.js";
export type {
  WebhookDeliveryListOptions,
  WebhookEndpointListOptions,
  WebhookEventListOptions,
  WebhookMethods,
} from "./tenant/webhooks.js";
export type {
  AuthorizeCalendarInput,
  Availability,
  AvailabilityDays,
  AvailabilityException,
  AvailabilityRule,
  Booking,
  BookingCommon,
  BookingListRow,
  BookingMetadata,
  BookingStatus,
  BookingTimezone,
  BookingTokens,
  BookingWindows,
  CalendarAuthorization,
  CalendarConnection,
  CancelInput,
  CancellationReason,
  CreateBookingInput,
  CreateBookingResult,
  CreatedBooking,
  CreatedPublicBooking,
  CreateEmployeeInput,
  CreateExceptionInput,
  CreateHoldInput,
  CreateLocationInput,
  CreatePublicBookingResult,
  CreateResult,
  CreateRuleInput,
  CreateServiceInput,
  CreateWebhookEndpointInput,
  Customer,
  CustomerInput,
  DateWindow,
  DeliveryStatus,
  Employee,
  EventType,
  ExceptionKind,
  Hold,
  KnownBookingStatus,
  KnownCancellationReason,
  Location,
  MinorAmount,
  MintedWebhookEndpoint,
  PublicBooking,
  PublicBookingWithWindows,
  PublicEmployee,
  PublicLocation,
  PublicService,
  RescheduleInput,
  RescheduleResult,
  Service,
  Slot,
  TenantIdentity,
  TenantKey,
  TenantSelf,
  TenantSettings,
  UpdateEmployeeInput,
  UpdateLocationInput,
  UpdateRuleInput,
  UpdateServiceInput,
  UpdateWebhookEndpointInput,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
  WebhookTestResult,
} from "./types.js";
export {
  type BookingEventData,
  type BookingEventEnvelope,
  type BookingEventTenant,
  type BookingEventType,
  type BookingWebhookEvent,
  type BookingWebhookEventType,
  type BookingWebhookInput,
  deliveryIdHeader,
  eventIdHeader,
  isKnownEvent,
  type KnownBookingEvent,
  parseBookingWebhookEvent,
  signatureHeader,
  timestampHeader,
  verifyBookingWebhook,
  type WebhookBookingBlock,
  type WebhookCustomerBlock,
  type WebhookEmployeeBlock,
  type WebhookLocationBlock,
  type WebhookServiceBlock,
} from "./webhook.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that disagrees with
 * the tarball it came from.
 */
export const VERSION = "1.0.2";
