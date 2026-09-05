/**
 * Named aliases over the generated contract, and the shapes the SDK has to write by hand.
 *
 * @remarks
 * Wire names are kept exactly as the service spells them — `starts_at`, `price_minor`,
 * `public_id`, `rescheduled_from_id`. The SDK does not camelCase them: these are the strings in
 * the service's own docs and in every `curl` an integrator pastes while debugging.
 *
 * Two things are hand-written on purpose. The enums a booking carries are **widened** to accept a
 * member this SDK has never seen, because the service adds members inside `/v1` without notice.
 * And the capability tokens live on a **separate** type that only a create returns, so reading
 * `booking.management_token` off a `GET` is a compile error rather than an `undefined` shipped in
 * a confirmation link.
 */

import type { components, operations } from "./generated/schema.js";

/** @internal Shorthand for the generated component schemas. */
type Schemas = components["schemas"];

/** @internal The JSON request body of one generated operation. */
type RequestBodyOf<Op extends keyof operations> = operations[Op] extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

// ── Money and time ────────────────────────────────────────────────────────────────────────────

/**
 * A decimal string of minor units, or `null` for "not displayed".
 *
 * @remarks
 * **`HUF` is zero-decimal**: `"4500"` with `"HUF"` is 4500 Ft, not 45.00. Read it against the
 * `currency` beside it and never divide by 100 unconditionally. `null` is not zero — it means the
 * tenant chose not to show a price. This SDK performs no arithmetic on it and offers no helper to.
 */
export type MinorAmount = Schemas["MinorAmount"];

/** The only timezone this deployment accepts, enforced at validation. */
export type BookingTimezone = "Europe/Budapest";

/** A location-local date window. `from` is inclusive, `until` is exclusive. */
export type DateWindow = Schemas["DateWindow"];

// ── Enums, kept open ──────────────────────────────────────────────────────────────────────────

/** The statuses the service documents today. */
export type KnownBookingStatus = Schemas["BookingStatus"];

/**
 * A booking's status.
 *
 * @remarks
 * `pending` and `confirmed` hold the slot; `canceled`, `completed` and `no_show` are terminal and
 * nothing leaves them. The `string & {}` arm keeps a member added upstream deliverable — the
 * knowledge base's rule is *"treat an unknown enum member as unknown, not as an error"* — while
 * the known literals stay in autocompletion.
 */
export type BookingStatus = KnownBookingStatus | (string & Record<never, never>);

/** The cancellation reasons the service documents today, including the absence of one. */
export type KnownCancellationReason = Schemas["CancellationReason"];

/**
 * Why a slot freed up. `null` while the booking has not been canceled.
 *
 * @remarks
 * `no_show` is a reason as well as a status. `system_pending_expired` is the one nobody chose.
 * **Who** acted is not here — it is in the booking's event log. Open to new members like
 * {@link BookingStatus}.
 */
export type CancellationReason = KnownCancellationReason | (string & Record<never, never>);

/** A webhook delivery's status. Three members, not five — there is no `delivering` and no `failed`. */
export type DeliveryStatus = Schemas["DeliveryStatus"];

/** A date exception's kind: `closed` overrides the rules for a date, `open` adds a window. */
export type ExceptionKind = Schemas["AvailabilityException"]["kind"];

// ── The catalogue ─────────────────────────────────────────────────────────────────────────────

/** A location as the tenant tier sees it, with `active` and timestamps. */
export type Location = Schemas["Location"];

/** A location as a browser sees it: no `active` — an inactive one is absent — and no timestamps. */
export type PublicLocation = Schemas["PublicLocation"];

/** A service as the tenant tier sees it, buffers included. */
export type Service = Schemas["Service"];

/** A service as a browser sees it. Buffers and `active` are the tenant's business. */
export type PublicService = Schemas["PublicService"];

/** A staff member as the tenant tier sees them. `email` is internal and never public. */
export type Employee = Schemas["Employee"];

/** A staff member as a browser sees them: name and id only. */
export type PublicEmployee = Schemas["PublicEmployee"];

/** A recurring weekly working window. **`day_of_week` 0 is Monday.** */
export type AvailabilityRule = Schemas["AvailabilityRule"];

/** A single date that overrides the rules. */
export type AvailabilityException = Schemas["AvailabilityException"];

// ── Availability and holds ────────────────────────────────────────────────────────────────────

/**
 * One bookable slot.
 *
 * @remarks
 * `employee_ids` is a list because a slot can be offered by several people; the create names one.
 * **A slot is not a reservation** — it is what was true when the response was computed.
 */
export type Slot = Schemas["Slot"];

/** The bookable slots for one service over one window. */
export type Availability = Schemas["Availability"];

/** The same computation summarised per local day, for a month picker. */
export type AvailabilityDays = Schemas["AvailabilityDays"];

/** A short reservation on one slot. Expiry is a predicate: it stops working at `expires_at`. */
export type Hold = Schemas["Hold"];

/** What to hold a slot with. Keep the `nonce` — redeeming and releasing both need it. */
export type CreateHoldInput = Schemas["HoldCreate"];

// ── Bookings ──────────────────────────────────────────────────────────────────────────────────

/**
 * What every booking view shares, with the two enums widened.
 *
 * @remarks
 * Built from the generated `BookingCommon` with `status` and `cancellation_reason` replaced by
 * their open forms, so a member added upstream reaches a caller as a string rather than as a
 * type that lies about what it can hold.
 */
export type BookingCommon = Omit<Schemas["BookingCommon"], "status" | "cancellation_reason"> & {
  readonly status: BookingStatus;
  readonly cancellation_reason: CancellationReason;
};

/** A customer, as the tenant tier sees them. Name, email, phone, your `external_ref` — and nothing else. */
export type Customer = Schemas["Customer"];

/** The tenant's own correlation data: flat, ≤ 4 KB serialised, never read by the service. */
export type BookingMetadata = Schemas["Booking"]["metadata"];

/** A booking as the tenant tier reads it: the full customer record and `metadata`. */
export type Booking = BookingCommon & {
  readonly customer: Customer;
  readonly metadata: BookingMetadata;
};

/**
 * One row of `GET /v1/bookings`.
 *
 * @remarks
 * Carries **no `customer` object at all**, not an empty one — joining five tables per page to
 * publish names nobody asked for is how that endpoint would get slow. Read one booking for the
 * full record.
 */
export type BookingListRow = BookingCommon;

/** A booking as a browser reads it: the customer's name and nothing else about them. */
export type PublicBooking = BookingCommon & {
  readonly customer: { readonly name: string };
};

/**
 * When the customer may still act, as instants.
 *
 * @remarks
 * `null` means the operation is **not offered at all** — the tenant set that window to `0`, or
 * the booking is terminal. A past timestamp means it *was* offered and the window has closed. A
 * UI should word those differently.
 */
export type BookingWindows = Schemas["BookingWindows"];

/** A booking read with its management token: the public view plus `windows`. */
export type PublicBookingWithWindows = PublicBooking & { readonly windows: BookingWindows };

/**
 * The capability tokens, which appear in a create response and nowhere else.
 *
 * @remarks
 * `confirmation_token` is `null` when the tenant does not require confirmation — nothing was
 * minted. **Store both before you navigate away.** No read returns them; a lost token is re-minted
 * from the tenant tier, never recovered.
 */
export interface BookingTokens {
  readonly management_token: string;
  readonly confirmation_token: string | null;
}

/** What `POST /v1/bookings` answers with a `201`: the tenant view plus the tokens. */
export type CreatedBooking = Booking & BookingTokens;

/** What `POST /v1/public/bookings` answers with a `201`: the public view plus the tokens. */
export type CreatedPublicBooking = PublicBooking & BookingTokens;

/** The customer block of a create. **Strict** — unknown fields are refused. */
export type CustomerInput = Schemas["CustomerInput"];

/**
 * What to create a booking with, on either tier.
 *
 * @remarks
 * `hold_id` is optional; without one, creation races the exclusion constraint and loses cleanly
 * with `409 slot_taken`. `nonce` is required whenever `hold_id` is present. `pending_reason` and
 * `metadata` are yours: stored, returned, never interpreted. `metadata` must be flat — nesting is
 * refused, not truncated.
 */
export type CreateBookingInput = Schemas["BookingCreate"];

/**
 * What to reschedule with. Only `starts_at` is required; omitting `employee_id` keeps the current one.
 *
 * @remarks
 * A reschedule creates a **new** booking and cancels the old one atomically. The answer is the new
 * booking with a new `public_id`; follow `rescheduled_from_id` / `rescheduled_to_id` to walk the
 * chain.
 */
export type RescheduleInput = Schemas["Reschedule"];

/** An optional reason, recorded on the booking's event — it describes the act, not the state. */
export type CancelInput = Schemas["Cancel"];

/**
 * A created booking, and whether it already existed.
 *
 * @remarks
 * Discriminated on `replayed`, because the two arms differ in what they can promise:
 *
 * - `replayed: false` — this call created it, and the body carries **both tokens**.
 * - `replayed: true` — the service answered `200` with the frozen body of an earlier identical
 *   request. Usually that body carries the tokens too. **But a replay of a recovered create does
 *   not**: when the first attempt made the booking and died before answering, the tokens it
 *   minted never reached anyone and are gone. Re-mint with `mintManagementToken`.
 *
 * So on the replay arm the tokens are optional, and a caller has to look before sending a link.
 */
export type CreateResult<TBooking extends PublicBooking> =
  | { readonly replayed: false; readonly booking: TBooking & BookingTokens }
  | { readonly replayed: true; readonly booking: TBooking & Partial<BookingTokens> };

/** A created booking on the tenant tier. See {@link CreateResult}. */
export type CreateBookingResult = CreateResult<Booking>;

/** A created booking on the public tier. See {@link CreateResult}. */
export type CreatePublicBookingResult = CreateResult<PublicBooking>;

/**
 * The new booking a reschedule produced, and whether this was a replay.
 *
 * @remarks
 * No tokens: the same management token keeps working on the new booking, so nothing new is minted.
 */
export interface RescheduleResult<TBooking extends PublicBooking = Booking> {
  readonly booking: TBooking;
  readonly replayed: boolean;
}

// ── Tenant identity and settings ──────────────────────────────────────────────────────────────

/** What a tenant may see about itself. */
export type TenantSelf = Schemas["TenantSelf"];

/** An API key's metadata. `last4` is the whole readback. */
export type TenantKey = Schemas["TenantKey"];

/** Who a `bsk_` key belongs to. A credential check that touches nothing. */
export interface TenantIdentity {
  readonly tenant: TenantSelf;
  readonly key: TenantKey;
}

/**
 * Every knob a tenant has. Read-only on this tier; an operator changes them.
 *
 * @remarks
 * The three worth reading before you build: `require_confirmation` (`false` means a create is
 * born `confirmed` with no confirmation token), `public_booking_create_enabled` (whether a `bpk_`
 * key may create at all) and `reminder_offsets_minutes` (when `booking.reminder_reached` fires —
 * and **this service still sends nothing**).
 */
export type TenantSettings = Schemas["TenantSettings"];

// ── Catalogue writes ──────────────────────────────────────────────────────────────────────────

/** What to create a location with. `timezone` must be `Europe/Budapest`. */
export type CreateLocationInput = RequestBodyOf<"createLocation">;

/** What to change on a location. **At least one field** — an empty body is a `400`. */
export type UpdateLocationInput = RequestBodyOf<"updateLocation">;

/**
 * What to create a service with.
 *
 * @remarks
 * **Strict** — an unknown field such as `buffer_after_minute` is a `400`, not a silently ignored
 * typo, because silently ignoring it double-books the calendar. `duration_minutes` is copied onto
 * each booking at creation, so changing it later moves nobody's appointment. A duplicate `slug`
 * is a `400`, not a `409`.
 */
export type CreateServiceInput = RequestBodyOf<"createService">;

/** What to change on a service. */
export type UpdateServiceInput = RequestBodyOf<"updateService">;

/** What to add a staff member with. `email` is internal — it never reaches the public tier. */
export type CreateEmployeeInput = RequestBodyOf<"createEmployee">;

/** What to change on a staff member. */
export type UpdateEmployeeInput = RequestBodyOf<"updateEmployee">;

// ── Working hours ─────────────────────────────────────────────────────────────────────────────

/**
 * What to add a working-hour rule with.
 *
 * @remarks
 * **`day_of_week` is `0` = Monday (ISO), through `6` = Sunday.** Times are wall-clock in the
 * location's zone, `HH:MM`. A rule crossing midnight is refused — split it in two.
 */
export type CreateRuleInput = RequestBodyOf<"createRule">;

/** What to change on a rule. */
export type UpdateRuleInput = RequestBodyOf<"updateRule">;

/**
 * What to add a date exception with.
 *
 * @remarks
 * `kind: "closed"` with no times closes the whole day; `kind: "open"` requires both times.
 * `location_id: null` applies to all of that employee's locations.
 */
export type CreateExceptionInput = RequestBodyOf<"createException">;

// ── Google Calendar ───────────────────────────────────────────────────────────────────────────

/** A staff member's Google calendar connection. No endpoint ever returns a token. */
export type CalendarConnection = Schemas["CalendarConnection"];

/**
 * Where the staff member lands after consenting. **Required** — there is no default.
 *
 * @remarks
 * Must be `https://`, or `http://localhost` in development. The service appends
 * `?calendar=connected|denied|gone` to it, and **you** build the page that reads it.
 */
export type AuthorizeCalendarInput = RequestBodyOf<"authorizeCalendar">;

/** The Google consent URL to send the staff member to. Its `state` is single-use and short-lived. */
export interface CalendarAuthorization {
  readonly authorize_url: string;
}

// ── Webhooks, tenant side ─────────────────────────────────────────────────────────────────────

/** One entry of the event catalogue. Build a subscription UI from this, not from a typed list. */
export type EventType = Schemas["EventType"];

/** A registered receiver. `secret_last4` and `secret_fingerprint` are the whole readback of the secret. */
export type WebhookEndpoint = Schemas["WebhookEndpoint"];

/** A receiver with its `secret`, which appears here — on create and on rotate — and nowhere else. */
export type MintedWebhookEndpoint = Schemas["MintedWebhookEndpoint"];

/**
 * What to register a receiver with.
 *
 * @remarks
 * `url` must be HTTPS on a public host, and is re-validated at **every** delivery.
 * `subscribed_events: null` (the default) means every type in the catalogue, which is how a new
 * event type reaches you for free. `include_customer` is off by default; turn it on because you
 * cannot do your job without it, not because it is convenient — both directions are audited.
 */
export type CreateWebhookEndpointInput = Schemas["WebhookEndpointCreate"];

/** What to change on a receiver. At least one field. */
export type UpdateWebhookEndpointInput = Schemas["WebhookEndpointUpdate"];

/** A stored event. `data.customer` is stripped here even for endpoints that receive it. */
export type WebhookEvent = Schemas["WebhookEvent"];

/**
 * One delivery row per (event, endpoint).
 *
 * @remarks
 * `pending` includes an attempt in flight and a failed attempt with rungs left — read
 * `next_attempt_at` to tell them apart. `response_status` and `response_excerpt` are *your*
 * answer on the last attempt, which is usually where the problem is.
 */
export type WebhookDelivery = Schemas["WebhookDelivery"];

/** What `POST …/test` answers: the id of the ping event it emitted, when it reports one. */
export interface WebhookTestResult {
  readonly event_public_id?: string;
}
