/**
 * Constructing a client — one per credential tier.
 *
 * @remarks
 * Two constructors, not one client with a tier parameter. The two keys have different blast radii
 * and different browser rules, and a single object holding a `bsk_` that *can* read the catalogue
 * is a `bsk_` that ends up in a client component. Separate constructors mean the import graph shows
 * which tier a module touches.
 *
 * The admin tier (`bad_`), the Google callbacks under `/v1/providers/*` and the cron routes are
 * deliberately unreachable from here.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lazslov/api-core";
import { baseUrlVar, publishableKeyVar, secretKeyVar } from "./env.js";
import { serviceName } from "./errors.js";
import { bindHoldMethods, type HoldMethods } from "./holds.js";
import {
  bindPublicAvailabilityMethods,
  type PublicAvailabilityMethods,
} from "./public/availability.js";
import { bindPublicBookingMethods, type PublicBookingMethods } from "./public/bookings.js";
import { bindPublicCatalogueMethods, type PublicCatalogueMethods } from "./public/catalogue.js";
import {
  type AvailabilityRuleMethods,
  bindAvailabilityRuleMethods,
} from "./tenant/availability.js";
import { type BookingMethods, bindBookingMethods } from "./tenant/bookings.js";
import { bindCalendarMethods, type CalendarMethods } from "./tenant/calendar.js";
import { bindCatalogueMethods, type CatalogueMethods } from "./tenant/catalogue.js";
import { bindIdentityMethods, type IdentityMethods } from "./tenant/identity.js";
import { bindWebhookMethods, type WebhookMethods } from "./tenant/webhooks.js";

/**
 * The public tier: the twelve `/v1/public/*` endpoints a browser may call with a `bpk_` key.
 *
 * @remarks
 * It can read the catalogue and availability, take holds, create a booking where the tenant opted
 * in, and manage **one** booking with its token. It can never list bookings, read a customer's
 * contact details, or touch another booking. And it hears nothing back: **this service sends no
 * email, no SMS and no push** — a `bpk_` key in page source with no backend behind it gets no
 * confirmation, no reminder and no cancellation notice.
 */
export interface BookingPublicClient
  extends PublicCatalogueMethods,
    PublicAvailabilityMethods,
    HoldMethods,
    PublicBookingMethods {}

/**
 * The tenant tier: everything a tenant's **backend** does to its own data with a `bsk_` key.
 *
 * @remarks
 * The catalogue, working hours, calendar connections, holds, the full booking lifecycle, token
 * re-minting, and this tenant's own webhook surface. Key management (`/v1/keys*`) is deliberately
 * absent: minting, rotating and revoking credentials is an operator's ceremony, not a call a
 * backend makes on its own.
 */
export interface BookingClient
  extends IdentityMethods,
    CatalogueMethods,
    CalendarMethods,
    AvailabilityRuleMethods,
    HoldMethods,
    BookingMethods,
    WebhookMethods {}

/**
 * A client for the public tier, safe to construct in a browser with a `bpk_` key.
 *
 * @param config - Explicit configuration. Every field is optional; anything omitted comes from the
 * environment, and anything given wins over it.
 * @returns The twelve public endpoints.
 * @throws {@link NotConfiguredError} when neither the argument nor the environment supplies a base
 * URL and a key. Use {@link tryCreateBookingPublicClient} where a missing configuration should
 * degrade instead.
 * @throws `Error` when a `bsk_` key is used in a browser, naming rotation rather than hiding. A
 * `bpk_` is fine there — that is the whole point of the tier — so the guard is applied per key.
 * @remarks
 * Reads `BOOKING_SERVICE_BASE_URL` and `BOOKING_SERVICE_PUBLISHABLE_KEY`. It does **not** fall
 * back to the secret key: the knowledge base documents no `bsk_` access to `/v1/public/*`, and a
 * server that holds a `bsk_` has the whole tenant tier instead.
 *
 * @example
 * ```ts
 * const booking = createBookingPublicClient({
 *   baseUrl: process.env.NEXT_PUBLIC_BOOKING_SERVICE_BASE_URL,
 *   apiKey: process.env.NEXT_PUBLIC_BOOKING_SERVICE_PUBLISHABLE_KEY,
 * });
 * const days = await booking.getAvailabilityDays({ service_id, from, until });
 * ```
 */
export function createBookingPublicClient(config: ServiceConfig = {}): BookingPublicClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: publishableKeyVar },
    config,
  });

  // A `bsk_` handed to the public constructor is the leak this guard exists for. Named with the
  // variable it most likely came from, so the message says which one to move.
  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["bsk_"],
    serviceName,
    envVar: secretKeyVar,
  });

  return {
    ...bindPublicCatalogueMethods(resolved),
    ...bindPublicAvailabilityMethods(resolved),
    ...bindHoldMethods(resolved, "/v1/public/holds"),
    ...bindPublicBookingMethods(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createBookingPublicClient}.
 * @returns The client, or `null`.
 * @remarks
 * So a site boots and renders — with the booking widget disabled — when no `BOOKING_SERVICE_*`
 * variables are set, which is how a new contributor runs the project. A `bsk_` in a browser still
 * throws: that is a leak, not a missing configuration.
 */
export function tryCreateBookingPublicClient(
  config: ServiceConfig = {},
): BookingPublicClient | null {
  try {
    return createBookingPublicClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}

/**
 * A client for the tenant tier. **Server only.**
 *
 * @param config - Explicit configuration; anything omitted comes from the environment, and anything
 * given wins over it — which is what lets one process hold clients for two tenants.
 * @returns The tenant surface, minus key management.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreateBookingClient} where a missing configuration should degrade instead.
 * @throws `Error` when constructed in a **browser**, naming rotation rather than hiding.
 * @remarks
 * Reads `BOOKING_SERVICE_BASE_URL` and `BOOKING_SERVICE_SECRET_KEY`.
 *
 * The service has its own tripwire: any request to `/v1/*` carrying an `Origin` or a
 * `Sec-Fetch-Dest` header is refused with a `403` **before authentication**, and the key is
 * presumed burned. This guard fires earlier still, at construction — by the time that 403 arrives,
 * a `bsk_` has already shipped to every visitor, and the only remedy left is rotating it. A plain
 * Node `fetch` sends neither header, so a backend needs to do nothing special — and must **not**
 * set `mode: "same-origin"`, which the service's docs say to delete.
 *
 * @example
 * ```ts
 * import "server-only";
 * const booking = createBookingClient();
 * ```
 */
export function createBookingClient(config: ServiceConfig = {}): BookingClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: secretKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["bsk_"],
    serviceName,
    envVar: secretKeyVar,
  });

  return {
    ...bindIdentityMethods(resolved),
    ...bindCatalogueMethods(resolved),
    ...bindCalendarMethods(resolved),
    ...bindAvailabilityRuleMethods(resolved),
    ...bindHoldMethods(resolved, "/v1/holds"),
    ...bindBookingMethods(resolved),
    ...bindWebhookMethods(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createBookingClient}.
 * @returns The client, or `null`.
 * @remarks
 * So an admin page renders — with booking management disabled — in a deployment that has no
 * credentials, rather than crashing the whole app. A leaked key still throws.
 */
export function tryCreateBookingClient(config: ServiceConfig = {}): BookingClient | null {
  try {
    return createBookingClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
