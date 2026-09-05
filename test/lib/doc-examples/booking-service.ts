import type {
  AuthorizeCalendarInput,
  Availability,
  AvailabilityDays,
  Booking,
  BookingEventData,
  BookingWebhookEvent,
  BookingWindows,
  CancelInput,
  CreateBookingInput,
  CreatedPublicBooking,
  CreateEmployeeInput,
  CreateExceptionInput,
  CreateHoldInput,
  CreateLocationInput,
  CreateRuleInput,
  CreateServiceInput,
  CreateWebhookEndpointInput,
  Hold,
  PublicEmployee,
  PublicLocation,
  PublicService,
  RescheduleInput,
  UpdateEmployeeInput,
  UpdateLocationInput,
  UpdateRuleInput,
  UpdateServiceInput,
  UpdateWebhookEndpointInput,
} from "@lazslov/booking";
import type { AllKeys, MandatoryKeys } from "../type-keys.js";
import {
  adminTier,
  type Classifier,
  type DocExample,
  isRecord,
  problemDocument,
  requestBody,
  type ServiceExamples,
  spec,
  unwrap,
} from "./shared.js";

/** booking-service's documented examples, and the `@lazslov/booking` type each one is checked against. */

// ── Responses ─────────────────────────────────────────────────────────────────────────────────

const publicLocationSpec = spec(
  {
    public_id: true,
    name: true,
    slug: true,
    timezone: true,
    address: true,
  } satisfies AllKeys<PublicLocation>,
  {
    public_id: true,
    name: true,
    slug: true,
    timezone: true,
    address: true,
  } satisfies MandatoryKeys<PublicLocation>,
);

/**
 * A service as a browser sees it.
 *
 * @remarks
 * No `buffer_before_minutes`, no `buffer_after_minutes` and no `active`: a documented public row
 * carrying one of them would mean the tenant's business had leaked behind a key that ships in page
 * source, which is exactly the divergence this check exists to catch.
 */
const publicServiceSpec = spec(
  {
    public_id: true,
    location_id: true,
    name: true,
    slug: true,
    description: true,
    duration_minutes: true,
    price_minor: true,
    currency: true,
  } satisfies AllKeys<PublicService>,
  {
    public_id: true,
    location_id: true,
    name: true,
    slug: true,
    description: true,
    duration_minutes: true,
    price_minor: true,
    currency: true,
  } satisfies MandatoryKeys<PublicService>,
);

const publicEmployeeSpec = spec(
  { public_id: true, name: true } satisfies AllKeys<PublicEmployee>,
  { public_id: true, name: true } satisfies MandatoryKeys<PublicEmployee>,
);

const availabilityKeys = {
  timezone: true,
  service_id: true,
  duration_minutes: true,
  window: true,
  slots: true,
} as const;

const availabilitySpec = spec(
  availabilityKeys satisfies AllKeys<Availability>,
  availabilityKeys satisfies MandatoryKeys<Availability>,
);

const availabilityDaysKeys = {
  timezone: true,
  service_id: true,
  window: true,
  days: true,
} as const;

const availabilityDaysSpec = spec(
  availabilityDaysKeys satisfies AllKeys<AvailabilityDays>,
  availabilityDaysKeys satisfies MandatoryKeys<AvailabilityDays>,
);

const holdKeys = {
  hold_id: true,
  service_id: true,
  employee_id: true,
  starts_at: true,
  ends_at: true,
  expires_at: true,
} as const;

const holdSpec = spec(holdKeys satisfies AllKeys<Hold>, holdKeys satisfies MandatoryKeys<Hold>);

/** Every member a booking view shares, before the tier adds its own. */
const bookingCommonKeys = {
  public_id: true,
  status: true,
  location_id: true,
  service_id: true,
  service_name: true,
  employee_id: true,
  employee_name: true,
  starts_at: true,
  ends_at: true,
  timezone: true,
  pending_reason: true,
  expires_at: true,
  confirmed_at: true,
  canceled_at: true,
  completed_at: true,
  cancellation_reason: true,
  rescheduled_from_id: true,
  rescheduled_to_id: true,
  created_at: true,
  updated_at: true,
} as const;

/** A booking as the tenant tier reads it: the full customer record and `metadata`. */
const bookingKeys = { ...bookingCommonKeys, customer: true, metadata: true } as const;

const bookingSpec = spec(
  bookingKeys satisfies AllKeys<Booking>,
  bookingKeys satisfies MandatoryKeys<Booking>,
);

/**
 * A create's `201` on the public tier — the only response that carries the capability tokens.
 *
 * @remarks
 * `metadata` is deliberately absent and the two tokens are deliberately present. A read documented
 * with either of those the other way round would be a finding, because the SDK's types make the
 * tokens reachable from a create and from nowhere else.
 */
const createdPublicBookingKeys = {
  ...bookingCommonKeys,
  customer: true,
  management_token: true,
  confirmation_token: true,
} as const;

const createdPublicBookingSpec = spec(
  createdPublicBookingKeys satisfies AllKeys<CreatedPublicBooking>,
  createdPublicBookingKeys satisfies MandatoryKeys<CreatedPublicBooking>,
);

const bookingWindowsSpec = spec(
  { cancel_until: true, reschedule_until: true } satisfies AllKeys<BookingWindows>,
  { cancel_until: true, reschedule_until: true } satisfies MandatoryKeys<BookingWindows>,
);

// ── Request bodies ────────────────────────────────────────────────────────────────────────────

const createHoldSpec = spec(
  {
    service_id: true,
    employee_id: true,
    starts_at: true,
    nonce: true,
  } satisfies AllKeys<CreateHoldInput>,
  {
    service_id: true,
    employee_id: true,
    starts_at: true,
    nonce: true,
  } satisfies MandatoryKeys<CreateHoldInput>,
);

const createBookingSpec = spec(
  {
    service_id: true,
    employee_id: true,
    starts_at: true,
    customer: true,
    hold_id: true,
    nonce: true,
    pending_reason: true,
    metadata: true,
  } satisfies AllKeys<CreateBookingInput>,
  {
    service_id: true,
    employee_id: true,
    starts_at: true,
    customer: true,
  } satisfies MandatoryKeys<CreateBookingInput>,
);

const rescheduleSpec = spec(
  {
    starts_at: true,
    employee_id: true,
    hold_id: true,
    nonce: true,
  } satisfies AllKeys<RescheduleInput>,
  { starts_at: true } satisfies MandatoryKeys<RescheduleInput>,
);

const cancelSpec = spec(
  { reason: true } satisfies AllKeys<CancelInput>,
  {} satisfies MandatoryKeys<CancelInput>,
);

const locationKeys = {
  name: true,
  slug: true,
  timezone: true,
  address: true,
  active: true,
} as const;

const createLocationSpec = spec(
  locationKeys satisfies AllKeys<CreateLocationInput>,
  { name: true, slug: true } satisfies MandatoryKeys<CreateLocationInput>,
);

const updateLocationSpec = spec(
  locationKeys satisfies AllKeys<UpdateLocationInput>,
  {} satisfies MandatoryKeys<UpdateLocationInput>,
);

const serviceKeys = {
  name: true,
  slug: true,
  description: true,
  duration_minutes: true,
  buffer_before_minutes: true,
  buffer_after_minutes: true,
  price_minor: true,
  currency: true,
  active: true,
} as const;

const createServiceSpec = spec(
  serviceKeys satisfies AllKeys<CreateServiceInput>,
  { name: true, slug: true, duration_minutes: true } satisfies MandatoryKeys<CreateServiceInput>,
);

const updateServiceSpec = spec(
  serviceKeys satisfies AllKeys<UpdateServiceInput>,
  {} satisfies MandatoryKeys<UpdateServiceInput>,
);

const employeeKeys = { name: true, email: true, active: true } as const;

const createEmployeeSpec = spec(
  employeeKeys satisfies AllKeys<CreateEmployeeInput>,
  { name: true, email: true } satisfies MandatoryKeys<CreateEmployeeInput>,
);

const updateEmployeeSpec = spec(
  employeeKeys satisfies AllKeys<UpdateEmployeeInput>,
  {} satisfies MandatoryKeys<UpdateEmployeeInput>,
);

const createRuleSpec = spec(
  {
    employee_id: true,
    location_id: true,
    day_of_week: true,
    starts_time: true,
    ends_time: true,
    effective_from: true,
    effective_until: true,
    active: true,
  } satisfies AllKeys<CreateRuleInput>,
  {
    employee_id: true,
    location_id: true,
    day_of_week: true,
    starts_time: true,
    ends_time: true,
  } satisfies MandatoryKeys<CreateRuleInput>,
);

const updateRuleSpec = spec(
  {
    day_of_week: true,
    starts_time: true,
    ends_time: true,
    effective_from: true,
    effective_until: true,
    active: true,
  } satisfies AllKeys<UpdateRuleInput>,
  {} satisfies MandatoryKeys<UpdateRuleInput>,
);

const createExceptionSpec = spec(
  {
    employee_id: true,
    location_id: true,
    date: true,
    kind: true,
    starts_time: true,
    ends_time: true,
    reason: true,
  } satisfies AllKeys<CreateExceptionInput>,
  { employee_id: true, date: true, kind: true } satisfies MandatoryKeys<CreateExceptionInput>,
);

const authorizeCalendarSpec = spec(
  { return_url: true } satisfies AllKeys<AuthorizeCalendarInput>,
  { return_url: true } satisfies MandatoryKeys<AuthorizeCalendarInput>,
);

const createWebhookEndpointSpec = spec(
  {
    url: true,
    description: true,
    subscribed_events: true,
    contract_version: true,
    enabled: true,
    include_customer: true,
  } satisfies AllKeys<CreateWebhookEndpointInput>,
  { url: true } satisfies MandatoryKeys<CreateWebhookEndpointInput>,
);

const updateWebhookEndpointSpec = spec(
  {
    url: true,
    description: true,
    subscribed_events: true,
    enabled: true,
    include_customer: true,
  } satisfies AllKeys<UpdateWebhookEndpointInput>,
  {} satisfies MandatoryKeys<UpdateWebhookEndpointInput>,
);

// ── Webhooks ──────────────────────────────────────────────────────────────────────────────────

/**
 * The envelope, as webhooks.md §2 shows it.
 *
 * @remarks
 * The arms of the union differ only in what `data` holds, so one key spec covers all of them. Note
 * `contract_version`, `tenant` and `causation_id` — this service's envelope is payment-service's
 * shape, not email-service's, and the type follows this folder's Markdown.
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
  envelopeKeys satisfies AllKeys<BookingWebhookEvent>,
  envelopeKeys satisfies MandatoryKeys<BookingWebhookEvent>,
);

const eventDataSpec = spec(
  {
    booking: true,
    location: true,
    service: true,
    employee: true,
    customer: true,
  } satisfies AllKeys<BookingEventData>,
  {
    booking: true,
    location: true,
    service: true,
    employee: true,
  } satisfies MandatoryKeys<BookingEventData>,
);

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** Whether a list envelope's first row carries every one of these keys. */
function firstRowHas(example: DocExample, ...keys: string[]): boolean {
  const data = unwrap(example.json);
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    isRecord(data[0]) &&
    keys.every((key) => key in (data[0] as object))
  );
}

/** The first row of a list, for a key check. */
function firstRow(example: DocExample): object {
  return (unwrap(example.json) as object[])[0] as object;
}

/** Whether the example is a plain object carrying every one of these keys. */
function has(example: DocExample, ...keys: string[]): boolean {
  // Bound to a local: the narrowing from `isRecord` does not survive into the callback.
  const json = example.json;
  return isRecord(json) && keys.every((key) => key in json);
}

const classifiers: readonly Classifier[] = [
  adminTier,
  problemDocument("booking: problem document"),
  {
    // conventions §4 shows the `errors` extension alone — `{ pointer, detail }`, with no `code`.
    // `@lazslov/api-core`'s shared `ProblemFieldError` requires `code`, so no SDK type describes
    // this shape; the divergence is recorded in docs/plans/phase-9-booking.md §7.
    id: "out of scope: a validation problem's `errors` extension, shown without its envelope",
    matches: (example) => has(example, "errors"),
  },
  {
    // examples.http:382 carries a typo'd `buffer_after_minute` to prove the service rejects an
    // unknown field rather than ignoring it — silently ignoring it double-books the calendar. A key
    // check would rightly fail on it; it is out of scope because it is wrong on purpose.
    id: "out of scope: a deliberately malformed service body, shown to prove unknown fields are rejected",
    matches: (example) => has(example, "buffer_after_minute"),
  },
  {
    // The route "takes no body … anything sent here is read by nobody", and the SDK sends none.
    // The documented `{ reason }` is therefore not a request shape — see §7 of the plan.
    id: "out of scope: a disable body the route reads from nobody",
    matches: (example) => example.context.includes("/disable"),
  },
  {
    // Minting, rotating and revoking credentials is an operator's ceremony. `/v1/keys*` is
    // deliberately absent from the client, so the SDK declares no body for it.
    id: "out of scope: key management, which no consumer client reaches",
    matches: (example) => example.context.includes("/v1/keys"),
  },
  {
    // README.md:97 and conventions.md:146 both abbreviate a booking to the two or three members
    // the surrounding sentence is about. Neither is a response shape, and key-checking one against
    // the full type would report every omitted member as a divergence.
    id: "out of scope: an abbreviated orientation snippet, not a full response",
    matches: (example) =>
      (example.file === "README.md" || example.file === "conventions.md") &&
      has(example, "public_id", "status"),
  },
  {
    id: "booking: BookingWebhookEvent",
    matches: (example) => has(example, "event_type", "event_id"),
    check: (example) => ({ value: example.json as object, spec: webhookEventSpec }),
  },
  {
    id: "booking: BookingEventData",
    matches: (example) => has(example, "booking", "employee"),
    check: (example) => ({ value: example.json as object, spec: eventDataSpec }),
  },
  {
    id: "booking: PublicService[]",
    matches: (example) => firstRowHas(example, "duration_minutes", "price_minor"),
    check: (example) => ({ value: firstRow(example), spec: publicServiceSpec }),
  },
  {
    id: "booking: PublicLocation[]",
    matches: (example) => firstRowHas(example, "slug", "timezone"),
    check: (example) => ({ value: firstRow(example), spec: publicLocationSpec }),
  },
  {
    // Last of the three public listings: a public employee is a `public_id` and a name, so its row
    // is a subset of the other two and has to be matched after them.
    id: "booking: PublicEmployee[]",
    matches: (example) => firstRowHas(example, "public_id", "name"),
    check: (example) => ({ value: firstRow(example), spec: publicEmployeeSpec }),
  },
  {
    id: "booking: Availability",
    matches: (example) => has(example, "slots"),
    check: (example) => ({ value: example.json as object, spec: availabilitySpec }),
  },
  {
    id: "booking: AvailabilityDays",
    matches: (example) => has(example, "days"),
    check: (example) => ({ value: example.json as object, spec: availabilityDaysSpec }),
  },
  {
    // Before the create bodies, which also carry `hold_id`: only the response carries `expires_at`.
    id: "booking: Hold",
    matches: (example) => has(example, "hold_id", "expires_at"),
    check: (example) => ({ value: example.json as object, spec: holdSpec }),
  },
  {
    id: "booking: CreatedPublicBooking",
    matches: (example) => has(example, "management_token"),
    check: (example) => ({ value: example.json as object, spec: createdPublicBookingSpec }),
  },
  {
    id: "booking: Booking",
    matches: (example) => has(example, "public_id", "customer", "metadata"),
    check: (example) => ({ value: example.json as object, spec: bookingSpec }),
  },
  {
    // The read is documented as "the public view plus `windows`", so the block is shown alone.
    id: "booking: BookingWindows",
    matches: (example) => has(example, "windows"),
    check: (example) => ({
      value: (example.json as { windows: object }).windows,
      spec: bookingWindowsSpec,
    }),
  },
  {
    id: "booking: CreateBookingInput",
    matches: (example) => has(example, "service_id", "customer"),
    check: (example) => ({ value: example.json as object, spec: createBookingSpec }),
  },
  {
    id: "booking: CreateHoldInput",
    matches: (example) => has(example, "service_id", "nonce"),
    check: (example) => ({ value: example.json as object, spec: createHoldSpec }),
  },
  {
    id: "booking: CreateRuleInput",
    matches: (example) => has(example, "day_of_week"),
    check: (example) => ({ value: example.json as object, spec: createRuleSpec }),
  },
  {
    id: "booking: CreateExceptionInput",
    matches: (example) => has(example, "date", "kind"),
    check: (example) => ({ value: example.json as object, spec: createExceptionSpec }),
  },
  {
    // After the rule and exception bodies, which carry these members alongside their own.
    id: "booking: UpdateRuleInput",
    matches: (example) => has(example, "ends_time"),
    check: (example) => ({ value: example.json as object, spec: updateRuleSpec }),
  },
  {
    id: "booking: RescheduleInput",
    matches: (example) => has(example, "starts_at"),
    check: (example) => ({ value: example.json as object, spec: rescheduleSpec }),
  },
  {
    id: "booking: CreateLocationInput",
    matches: (example) => has(example, "name", "slug", "timezone"),
    check: (example) => ({ value: example.json as object, spec: createLocationSpec }),
  },
  {
    id: "booking: CreateServiceInput",
    matches: (example) => has(example, "name", "slug", "duration_minutes"),
    check: (example) => ({ value: example.json as object, spec: createServiceSpec }),
  },
  {
    id: "booking: CreateEmployeeInput",
    matches: (example) => has(example, "name", "email"),
    check: (example) => ({ value: example.json as object, spec: createEmployeeSpec }),
  },
  {
    id: "booking: UpdateServiceInput",
    matches: (example) => has(example, "price_minor"),
    check: (example) => ({ value: example.json as object, spec: updateServiceSpec }),
  },
  {
    // `{ "name": "…" }` fits both PATCH bodies, so the route is the only thing that tells them
    // apart — which is the honest answer, not a weakness of the check.
    id: "booking: UpdateLocationInput",
    matches: (example) => has(example, "name") && example.context.includes("/v1/locations/"),
    check: (example) => ({ value: example.json as object, spec: updateLocationSpec }),
  },
  {
    id: "booking: UpdateEmployeeInput",
    matches: (example) => has(example, "name") && example.context.includes("/v1/employees/"),
    check: (example) => ({ value: example.json as object, spec: updateEmployeeSpec }),
  },
  {
    id: "booking: AuthorizeCalendarInput",
    matches: (example) => has(example, "return_url"),
    check: (example) => ({ value: example.json as object, spec: authorizeCalendarSpec }),
  },
  {
    id: "booking: CreateWebhookEndpointInput",
    matches: (example) => has(example, "url"),
    check: (example) => ({ value: example.json as object, spec: createWebhookEndpointSpec }),
  },
  {
    id: "booking: UpdateWebhookEndpointInput",
    matches: (example) => has(example, "subscribed_events"),
    check: (example) => ({ value: example.json as object, spec: updateWebhookEndpointSpec }),
  },
  {
    // After the exception body, which also carries `reason`.
    id: "booking: CancelInput",
    matches: (example) => has(example, "reason"),
    check: (example) => ({ value: example.json as object, spec: cancelSpec }),
  },
  requestBody(
    // `{ "token": … }` is the confirm body. The SDK builds it inside `confirmBooking` from the
    // token a caller holds, so it declares no named type for it and there is nothing to key-check.
    "booking: the confirm body, which the SDK builds itself",
    (example) => has(example, "token"),
  ),
];

export const bookingExamples: ServiceExamples = {
  id: "booking-service",
  classifiers,
  minChecked: 50,
  minTypes: 28,
};
