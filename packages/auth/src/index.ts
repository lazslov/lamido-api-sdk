/**
 * `@lazslov/auth` — consumer SDK for auth-service's browser and client tiers.
 *
 * @remarks
 * auth-service signs people in — magic link, cross-device, and Google, for both platform people and a
 * website's own customers — holds their sessions, and answers *may this principal do this?*. Two tiers,
 * two constructors:
 *
 * - {@link createAuthPublicClient} — the `apk_` **browser** tier on `/v1/public/*`: both sign-in
 *   surfaces and the invitation pages. The key is publishable on purpose and may ship in a bundle.
 * - {@link createAuthClient} — the `ask_` **client** tier on `/v1/*`: the authorization decision,
 *   entitlements, customers, session verification, and the tenancy routes a signed-in person drives.
 *   Server-side only; the service refuses a browser-shaped request with a `403` before authentication.
 *
 * Five documented traps are encoded rather than described:
 *
 * - **Stop polling when `poll_interval_ms` is `null`** — {@link isTerminalLoginStatus}. Every poll of
 *   an approved request mints a fresh `exchange_code` and kills the one you are spending.
 * - **The customer exchange answers `204` with no body.** {@link CustomerExchangeResult} carries only
 *   the raw `Set-Cookie`, and {@link sessionTokenFromSetCookie} reads the token out for a backend.
 * - **`decision` is `allow` or `deny` and never why.** {@link AuthorizationDecision} is the one enum
 *   here that cannot grow, and a third value is refused rather than widened.
 * - **An invalid customer session is `{ valid: false }`, not a `401`.** `verifyCustomerSession` never
 *   throws for it.
 * - **`POST /v1/customers` is create-or-resolve.** {@link CreateCustomerResult} reports `created`
 *   from the status.
 *
 * Every `401` is byte-identical and carries no `code`. Branch on `type` and `code`, never on `title`
 * or `detail`. The operator tier (`aad_`), the provider callbacks, the scheduler and the sealed
 * inbound namespace are out of scope.
 *
 * @example
 * ```ts
 * // In the browser, with the publishable key:
 * const auth = createAuthPublicClient();
 * const { login_request, matching_code } = await auth.requestMagicLink({ email });
 * show(matching_code);                                   // the approval page asks for these digits
 * let poll = await auth.getMagicLinkStatus(login_request);
 * while (!isTerminalLoginStatus(poll)) {
 *   await sleep(poll.poll_interval_ms ?? 2000);
 *   poll = await auth.getMagicLinkStatus(login_request);
 * }
 *
 * // On the server, with the application key:
 * import "server-only";
 * const backend = createAuthClient();
 * const { decision } = await backend.authorize({
 *   principal: { kind: "user", session_token },
 *   organization_id,
 *   permission: "shop.orders.refund",
 * });
 * ```
 */

export type { AuthorizationMethods } from "./application/authorization.js";
export type {
  CustomerListOptions,
  CustomerMethods,
  CustomerScope,
} from "./application/customers.js";
export type {
  EntitlementMethods,
  EntitlementScope,
  SubscriptionListOptions,
} from "./application/entitlements.js";
export type { OrganizationMethods } from "./application/organizations.js";
export type { SessionMethods } from "./application/sessions.js";
export type { WebsiteMethods } from "./application/websites.js";
export type { InvitationMethods } from "./browser/invitations.js";
export type { SignInMethods } from "./browser/sign-in.js";
export {
  type AuthRequest,
  type CreateOptions,
  type PageOptions,
  type RequestOptions,
  sessionTokenHeader,
} from "./call.js";
export {
  type AuthClient,
  type AuthPublicClient,
  createAuthClient,
  createAuthPublicClient,
  tryCreateAuthClient,
  tryCreateAuthPublicClient,
} from "./client.js";
export { AuthApiError, type AuthProblemCode, authProblemCodes } from "./errors.js";
export { isTerminalLoginStatus } from "./login-status.js";
export {
  customerSessionCookie,
  platformSessionCookie,
  sessionTokenFromSetCookie,
} from "./session-cookie.js";
export type {
  AddDomainInput,
  AuthorizationDecision,
  AuthorizeDecision,
  AuthorizeInput,
  AuthPage,
  Branding,
  BrandingInput,
  CreateCustomerInput,
  CreateCustomerResult,
  CreateInvitationInput,
  CreateOrganizationInput,
  CreateWebsiteInput,
  Customer,
  CustomerExchangeResult,
  CustomerSessionVerdict,
  CustomerStatus,
  Domain,
  DomainVerificationStatus,
  ExchangeInput,
  Feature,
  GoogleStart,
  GoogleStartInput,
  Invitation,
  InvitationPreview,
  InvitationStatus,
  LoginRequestStatus,
  LoginSettings,
  LoginSettingsInput,
  LoginStatus,
  MagicLinkInput,
  MagicLinkRequested,
  Me,
  Membership,
  MembershipRole,
  MintedWebsiteKey,
  Organization,
  Permission,
  PermissionsInput,
  Plan,
  PlatformExchangeResult,
  PlatformSession,
  Principal,
  Session,
  Subscription,
  SubscriptionStatus,
  SwitchOrganizationInput,
  SwitchOrganizationResult,
  UpdateWebsiteInput,
  User,
  VerifyCustomerSessionInput,
  Website,
  WebsiteKey,
} from "./types.js";
export {
  type AuthEventEnvelope,
  type AuthEventTenant,
  type AuthWebhookEvent,
  type AuthWebhookEventType,
  type AuthWebhookInput,
  type CustomerEvent,
  deliveryIdHeader,
  eventIdHeader,
  isCustomerEvent,
  isKnownEvent,
  isPingEvent,
  isSubscriptionEvent,
  type KnownAuthEvent,
  parseAuthWebhookEvent,
  pingEventType,
  type SubscriptionEvent,
  signatureHeader,
  timestampHeader,
  verifyAuthWebhook,
  type WebhookCustomerBlock,
  type WebhookSubscriptionBlock,
} from "./webhook.js";

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that disagrees with
 * the tarball it came from.
 */
export const VERSION = "1.0.1";
