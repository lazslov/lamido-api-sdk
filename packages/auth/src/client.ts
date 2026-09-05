/**
 * Constructing a client — one per credential tier.
 *
 * @remarks
 * Two constructors, not one client with a tier parameter. The two keys have different blast radii and
 * different browser rules: an `apk_` ships in front-end JavaScript on purpose, an `ask_` answers the
 * authorization decision for every principal in an organization and must never leave a backend. A
 * single object holding an `ask_` that *can* serve the browser flows is an `ask_` that ends up in a
 * client component. Separate constructors mean the import graph shows which tier a module touches.
 *
 * The operator tier (`aad_`), the provider callbacks the browser navigates to, the scheduler routes and
 * the sealed inbound namespace are deliberately unreachable from here.
 */

import {
  assertServerOnly,
  NotConfiguredError,
  resolveConfig,
  type ServiceConfig,
} from "@lazslov/api-core";
import {
  type AuthorizationMethods,
  bindAuthorizationMethods,
} from "./application/authorization.js";
import { bindCustomerMethods, type CustomerMethods } from "./application/customers.js";
import { bindEntitlementMethods, type EntitlementMethods } from "./application/entitlements.js";
import { bindOrganizationMethods, type OrganizationMethods } from "./application/organizations.js";
import { bindSessionMethods, type SessionMethods } from "./application/sessions.js";
import { bindWebsiteMethods, type WebsiteMethods } from "./application/websites.js";
import { bindInvitationMethods, type InvitationMethods } from "./browser/invitations.js";
import { bindSignInMethods, type SignInMethods } from "./browser/sign-in.js";
import { applicationKeyVar, baseUrlVar, publishableKeyVar } from "./env.js";
import { serviceName } from "./errors.js";

/**
 * The browser tier: `/v1/public/*` with an `apk_` publishable key.
 *
 * @remarks
 * Both sign-in surfaces — platform people and website customers — plus the invitation pages. This is
 * the only surface that serves CORS, and only to a website's **verified** domains: a refused origin
 * does not look refused, it looks like a success-shaped preflight with no `Access-Control-Allow-Origin`.
 * If browser calls fail while backend calls succeed, check the domain's verification status first.
 */
export interface AuthPublicClient extends SignInMethods, InvitationMethods {}

/**
 * The client tier: `/v1/*` with an `ask_` secret application key.
 *
 * @remarks
 * The authorization decision, entitlements, customers and session verification take the key alone.
 * The tenancy routes take the key **and** a person's session token, passed as the first argument and
 * sent as `X-Session-Token`.
 */
export interface AuthClient
  extends AuthorizationMethods,
    EntitlementMethods,
    CustomerMethods,
    SessionMethods,
    OrganizationMethods,
    WebsiteMethods {}

/**
 * A client for the browser tier.
 *
 * @param config - Explicit configuration. Every field is optional; anything omitted comes from the
 * environment, and anything given wins over it.
 * @returns Both sign-in surfaces and the invitation pages.
 * @throws {@link NotConfiguredError} when neither the argument nor the environment supplies a base URL
 * and a key. Use {@link tryCreateAuthPublicClient} where a missing configuration should degrade instead.
 * @throws `Error` when an `ask_` key is used in a browser. An `apk_` is fine there — that is the whole
 * point of the tier — so the guard is applied per key prefix rather than per client, and it names the
 * variable the `ask_` most likely came from.
 * @remarks
 * Reads `AUTH_SERVICE_BASE_URL` and `AUTH_SERVICE_PUBLISHABLE_KEY`. **An `ask_` key must never appear
 * on this tier**: the tripwire on the other tier exists to catch exactly that mistake, and this
 * constructor catches it a step earlier.
 *
 * @example
 * ```ts
 * const auth = createAuthPublicClient();
 * const { login_request, matching_code } = await auth.requestMagicLink({ email });
 * show(matching_code);   // the approval page asks the person for these six digits
 * ```
 */
export function createAuthPublicClient(config: ServiceConfig = {}): AuthPublicClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: publishableKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["ask_"],
    serviceName,
    envVar: applicationKeyVar,
  });

  return { ...bindSignInMethods(resolved), ...bindInvitationMethods(resolved) };
}

/**
 * The same browser client, or `null` when nothing is configured.
 *
 * @param config - As {@link createAuthPublicClient}.
 * @returns The client, or `null`.
 * @remarks
 * So a site boots and renders with no `AUTH_SERVICE_*` variables set at all — how a new contributor
 * runs the project — and sign-in degrades to a disabled button rather than a crash. A browser holding
 * an `ask_` still throws: that is a leak, not a missing configuration.
 */
export function tryCreateAuthPublicClient(config: ServiceConfig = {}): AuthPublicClient | null {
  try {
    return createAuthPublicClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}

/**
 * A client for the client tier.
 *
 * @param config - Explicit configuration; anything omitted comes from the environment, and anything
 * given wins over it.
 * @returns Authorization, entitlements, customers, session verification and the tenancy routes.
 * @throws {@link NotConfiguredError} when no base URL and key can be resolved. Use
 * {@link tryCreateAuthClient} where a missing configuration should degrade instead.
 * @throws `Error` when constructed in a **browser**, naming rotation rather than hiding.
 * @remarks
 * Reads `AUTH_SERVICE_BASE_URL` and `AUTH_SERVICE_APPLICATION_KEY`.
 *
 * The service has its own tripwire: any `/v1/*` request carrying `Origin` or `Sec-Fetch-Dest` is
 * refused with a `403` **before authentication runs**. This guard fires earlier still, at
 * construction — by the time that `403` arrives, an `ask_` key has already shipped to every visitor,
 * and the only remedy left is rotating it. Your Node backend is unaffected: undici sends only
 * `Sec-Fetch-Mode`, which is deliberately not the signal.
 *
 * @example
 * ```ts
 * import "server-only";
 * const auth = createAuthClient();
 * const { decision } = await auth.authorize({
 *   principal: { kind: "user", session_token },
 *   organization_id,
 *   permission: "shop.orders.refund",
 * });
 * ```
 */
export function createAuthClient(config: ServiceConfig = {}): AuthClient {
  const resolved = resolveConfig({
    serviceName,
    env: { baseUrl: baseUrlVar, apiKey: applicationKeyVar },
    config,
  });

  assertServerOnly(resolved.apiKey, {
    serverOnlyPrefixes: ["ask_"],
    serviceName,
    envVar: applicationKeyVar,
  });

  return {
    ...bindAuthorizationMethods(resolved),
    ...bindEntitlementMethods(resolved),
    ...bindCustomerMethods(resolved),
    ...bindSessionMethods(resolved),
    ...bindOrganizationMethods(resolved),
    ...bindWebsiteMethods(resolved),
  };
}

/**
 * The same client, or `null` when nothing is configured.
 *
 * @param config - As {@link createAuthClient}.
 * @returns The client, or `null`.
 * @remarks
 * So a backend route renders — with the gated capability off — when no credentials are configured,
 * rather than crashing the whole app. A leaked key still throws: that is not a missing configuration.
 */
export function tryCreateAuthClient(config: ServiceConfig = {}): AuthClient | null {
  try {
    return createAuthClient(config);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
}
