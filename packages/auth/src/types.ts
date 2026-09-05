/**
 * The wire shapes this package sends and receives.
 *
 * @remarks
 * Wire names are kept exactly as the service spells them — `public_id`, `poll_interval_ms`,
 * `session_token`. The SDK does not camelCase them: these are the strings in the service's own docs
 * and in every `curl` an integrator will paste while debugging.
 *
 * **Where a type comes from.** The pinned contract names a schema for four things only —
 * `Problem`, `Collection`, `AuthorizeDecision`, `Subscription` and `CustomerSessionVerdict` — and
 * says so: *"request shapes live in examples.http and in the endpoint files"*. Everything else here
 * is hand-written from the Markdown and from the responses `examples.http` shows. A resource whose
 * full member list the knowledge base never shows keeps the members it does show and stays **open**
 * (`[member: string]: unknown`), because a schema invented to look complete is exactly how that
 * folder became dangerous the first time. `docs/plans/phase-9-auth.md` lists each one.
 */

import type { CursorPage } from "@lazslov/api-core";
import type { components } from "./generated/schema.js";

/** @internal Shorthand for the generated component schemas. */
type Schemas = components["schemas"];

/**
 * A literal union that may grow.
 *
 * @remarks
 * data-model.md §3: *treat an unrecognised value as unknown, never as an error*. The `string & {}`
 * arm keeps the documented members in autocompletion while still accepting a value added upstream
 * after this SDK shipped. The one enum that does **not** get this treatment is
 * {@link AuthorizationDecision}.
 */
type Open<T extends string> = T | (string & Record<never, never>);

/** One page of a keyset list, as core's `collectAllCursor` reads it. There is no `total`. */
export type AuthPage<T> = CursorPage<T>;

// ── The authorization decision ───────────────────────────────────────────────────────────────────

/**
 * The answer to *may this principal do this?* — and never why.
 *
 * @remarks
 * **The one enum in this API that cannot grow.** Everywhere else an unrecognised value is safe to
 * ignore; here it would be a request whose outcome you cannot determine, which must fail closed. The
 * type is closed and the client refuses any third value rather than widening it.
 */
export type AuthorizationDecision = Schemas["AuthorizeDecision"]["decision"];

/** The body `POST /v1/authorize` answers with. */
export type AuthorizeDecision = Schemas["AuthorizeDecision"];

/**
 * Who a question is about.
 *
 * @remarks
 * **One form only: `{ kind, session_token }`.** The service validates the session as part of the
 * decision, so the person's identity is checked rather than asserted. The former `{ kind, public_id }`
 * form is a `400` since 2026-08-24 — it let any holder of the key obtain a decision for any principal
 * in the organization with no proof of a session.
 */
export interface Principal {
  /** `user` is a platform person in an organization; `customer` is a website-scoped identity. */
  readonly kind: "user" | "customer";
  /** The person's session token, as read out of the `Set-Cookie` header. Never a public id. */
  readonly session_token: string;
}

/** What `POST /v1/authorize` asks. */
export interface AuthorizeInput {
  readonly principal: Principal;
  /** Must be the key's own organization. Any other is a `404`, not a `deny`. */
  readonly organization_id: string;
  /**
   * Optional for a `user`; omit it to ask about the organization as a whole.
   *
   * @remarks
   * **A `customer` question must name one.** A customer session belongs to a website and cannot be
   * validated without it, so a customer principal with no `website_id` is a `deny` rather than an error.
   */
  readonly website_id?: string;
  /** A permission key, e.g. `shop.orders.refund`. One nobody registered can only ever answer `deny`. */
  readonly permission: string;
}

/**
 * What `POST /v1/permissions` asks: the decision route's body minus `permission`.
 *
 * @remarks
 * A `POST` with a body rather than a `GET` with a query string, because a session token in a URL lands
 * in access logs, a `Referer` and browser history. It writes no row and takes no idempotency key.
 */
export type PermissionsInput = Omit<AuthorizeInput, "permission">;

/** One permission the principal holds, as `POST /v1/permissions` lists them. Flat keys, nothing else. */
export interface Permission {
  readonly key: string;
}

// ── Entitlements ─────────────────────────────────────────────────────────────────────────────────

/**
 * A subscription's lifecycle.
 *
 * @remarks
 * `past_due` **still has access**: a grace window runs from `past_due_at`. `canceled` and `expired`
 * are terminal; a returning customer gets a **new** subscription row rather than a revived one.
 */
export type SubscriptionStatus = Open<NonNullable<Schemas["Subscription"]["status"]>>;

/**
 * A subscription, as `GET /v1/subscriptions` and the `subscription.*` events carry it.
 *
 * @remarks
 * Hand-written rather than aliased: the generated schema marks every member optional, and the
 * documented example carries all ten. A test asserts this shape still satisfies the generated one.
 * `period_end` is **exclusive** — the first instant *not* covered — so `>= period_end` is over.
 */
export interface Subscription {
  readonly public_id: string;
  readonly organization: string;
  readonly website: string | null;
  /** The plan's key, e.g. `starter`. */
  readonly plan: string;
  readonly status: SubscriptionStatus;
  readonly period_start: string;
  readonly period_end: string;
  readonly past_due_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A plan on offer, for a pricing page. **Not the gate** — {@link Feature} is.
 *
 * @remarks
 * Open: the knowledge base says a plan *"has a key and a feature bundle"* and names no other member.
 */
export interface Plan {
  readonly key: string;
  readonly [member: string]: unknown;
}

/** One effective feature, as `GET /v1/features` lists them. Flat keys, nothing else. */
export interface Feature {
  readonly key: string;
}

// ── Customers ────────────────────────────────────────────────────────────────────────────────────

/** Whether a customer may sign in. Read it; never assume it from an event type. */
export type CustomerStatus = Open<"active" | "deactivated">;

/**
 * A website's own identity, keyed on `(website, email)`.
 *
 * @remarks
 * Open: the knowledge base documents `public_id` and `status` and shows no full body. The same email
 * address on two websites is two different customers, and neither is the platform user with that
 * address — there is no lookup by address alone, and there never will be.
 */
export interface Customer {
  readonly public_id: string;
  readonly status: CustomerStatus;
  readonly [member: string]: unknown;
}

/**
 * What `POST /v1/customers` takes.
 *
 * @remarks
 * **The field is `website`, not `website_id`.** Create-or-resolve: the second call with the same
 * address answers `200` instead of `201`, and the status is the signal.
 */
export interface CreateCustomerInput {
  readonly website: string;
  readonly email: string;
  readonly name?: string;
}

/** A created-or-resolved customer, and which of the two it was. */
export interface CreateCustomerResult {
  readonly customer: Customer;
  /** `true` on a `201`. `false` means the row already existed and the service answered `200`. */
  readonly created: boolean;
}

/** What `POST /v1/customer-sessions/verify` takes. `token`, not `session_token`; `website` is required. */
export interface VerifyCustomerSessionInput {
  readonly website: string;
  /** The value of the `__Host-lamido_customer_session` cookie. */
  readonly token: string;
}

/**
 * The answer to *is this browser session real?*
 *
 * @remarks
 * An invalid, expired or unknown session is **`200` with `valid: false`** — not a `401`. The request
 * authenticated fine; the answer is no. Cache a `valid: true` verdict until `expires_at`: this route
 * is throttled per key like every consumer route, and an application that verifies on every request it
 * serves will reach the limit.
 *
 * Hand-written as a discriminated union: the generated schema types `customer` as an empty object,
 * which would make the one member a backend needs unreadable.
 */
export type CustomerSessionVerdict =
  | {
      readonly valid: true;
      readonly customer: Customer;
      readonly expires_at: string;
    }
  | {
      readonly valid: false;
      readonly customer: null;
      readonly expires_at: null;
    };

// ── Sign-in (the browser tier) ───────────────────────────────────────────────────────────────────

/** What both magic-link requests take. */
export interface MagicLinkInput {
  readonly email: string;
}

/**
 * A booked magic link. `202`: the work is booked, not done.
 *
 * @remarks
 * Answered the same way whether or not the address has an account — first sign-in *is* registration,
 * so there is nothing to disclose.
 */
export interface MagicLinkRequested {
  /** **A credential**, and the handle the poll and the exchange finish with. Keep it. */
  readonly login_request: string;
  /**
   * Six digits you **must display**.
   *
   * @remarks
   * The person who clicks the emailed link is asked for them on the approval page. A front end that
   * drops this field cannot sign anybody in.
   */
  readonly matching_code: string;
  readonly expires_at: string;
  /** How long to wait before the first poll, in milliseconds. */
  readonly poll_interval_ms: number;
}

/**
 * The poll's status values.
 *
 * @remarks
 * `expired` is a wire value with no column behind it — the route computes it from the token's
 * timestamp — and it is the value you meet most often, after somebody walks away from their laptop.
 * `pending` is the only non-terminal value; treat any unrecognised status as unknown and stop polling.
 */
export type LoginRequestStatus = Open<"pending" | "approved" | "consumed" | "expired">;

/**
 * One poll of a login request.
 *
 * @remarks
 * **Stop polling the moment `poll_interval_ms` is `null`.** Every poll of an approved request mints a
 * fresh `exchange_code` and invalidates the previous one, so a loop still running while you exchange
 * kills the code you are spending. `exchange_code` is **absent** while pending, not `null`.
 */
export interface LoginStatus {
  readonly status: LoginRequestStatus;
  /** A number while `pending`; `null` on every terminal status. The whole contract a loop needs. */
  readonly poll_interval_ms: number | null;
  /** Present on `approved` only. Spend it once. */
  readonly exchange_code?: string;
}

/** What both exchanges take: the handle the browser kept, and the code the poll handed it. */
export interface ExchangeInput {
  readonly login_request: string;
  readonly exchange_code: string;
}

/**
 * A platform person. Open: the knowledge base shows `email` and no full body.
 *
 * @remarks
 * A platform person and a website customer are different principals with different sessions, and one
 * browser holds both at once whenever a tenant's staff shop on their own site.
 */
export interface User {
  readonly email: string;
  readonly [member: string]: unknown;
}

/**
 * What the **platform** exchange answers: `200` with the user and the session's public id.
 *
 * @remarks
 * The body never carries the token. The session is an `HttpOnly` cookie in `Set-Cookie`, which the
 * result exposes separately for a backend — see {@link PlatformExchangeResult.setCookie}.
 */
export interface PlatformSession {
  readonly user: User;
  readonly session: { readonly public_id: string };
}

/** A completed platform exchange. */
export interface PlatformExchangeResult extends PlatformSession {
  /**
   * The raw `Set-Cookie` header, or `null` where the runtime withholds it.
   *
   * @remarks
   * A browser cannot read `Set-Cookie` — the platform stores the cookie itself — so this is `null`
   * there, and that is correct. A backend reads the token out of it once, with `sessionTokenFromSetCookie`.
   */
  readonly setCookie: string | null;
}

/**
 * A completed **customer** exchange, which answers `204` with **no body**.
 *
 * @remarks
 * Everything the service gives you is one `Set-Cookie` header naming neither the customer nor the
 * website. A browser needs nothing more. A backend reads the token out of the header, then calls
 * `verifyCustomerSession` on the `ask_` tier to learn who signed in — a different key, held in a
 * different place. The T-24 smoke runner assumed a JSON body here and crashed.
 */
export interface CustomerExchangeResult {
  /** The raw `Set-Cookie` header, or `null` where the runtime withholds it (a browser does). */
  readonly setCookie: string | null;
}

/** What both Google starts take. */
export interface GoogleStartInput {
  /** Where to send the browser back to. Must be on a verified domain of the website. */
  readonly return_url?: string;
}

/** The URL to send the browser to. The service does not redirect: a cross-origin `fetch` cannot follow one usefully. */
export interface GoogleStart {
  readonly authorization_url: string;
}

// ── Invitations ──────────────────────────────────────────────────────────────────────────────────

/**
 * The two roles. There is no `admin` — that value is a `400`, and it is the one people guess first.
 */
export type MembershipRole = Open<"owner" | "member">;

/** An invitation's lifecycle. `revoked` is what a withdrawal or a decline leaves behind. */
export type InvitationStatus = Open<"pending" | "accepted" | "declined" | "revoked" | "expired">;

/**
 * An invitation as the browser tier previews it — who invited, to which organization, which role.
 *
 * @remarks
 * Open: the knowledge base names the three facts and shows no member list.
 */
export interface InvitationPreview {
  readonly [member: string]: unknown;
}

/** An invitation as the tenant lists it. The token is never in a listing. */
export interface Invitation {
  readonly public_id: string;
  readonly status: InvitationStatus;
  readonly [member: string]: unknown;
}

/** What `POST /v1/organizations/{id}/invitations` takes. Invitations live fourteen days. */
export interface CreateInvitationInput {
  readonly email: string;
  readonly role: MembershipRole;
}

// ── Tenancy ──────────────────────────────────────────────────────────────────────────────────────

/** An organization. Open: the knowledge base shows `public_id` and `name`. */
export interface Organization {
  readonly public_id: string;
  readonly name: string;
  readonly [member: string]: unknown;
}

/** What `POST /v1/organizations` takes. The creator becomes its owner. */
export interface CreateOrganizationInput {
  readonly name: string;
}

/** A membership, as `GET /v1/auth/me` lists them. Open: the full body is not shown. */
export interface Membership {
  readonly public_id: string;
  readonly role: MembershipRole;
  readonly [member: string]: unknown;
}

/**
 * A person's own session, as `GET /v1/sessions` lists every device.
 *
 * @remarks
 * Open: the knowledge base says the current one is flagged and does not name the flag.
 */
export interface Session {
  readonly public_id: string;
  readonly [member: string]: unknown;
}

/**
 * The person, their memberships, and the active organization.
 *
 * @remarks
 * `active_organization` is `null` until `switchOrganization` sets it — and most tenancy routes read
 * the active organization rather than taking one in the path, so a `null` here is why `listWebsites`
 * answers `422 no_active_organization`. A fresh user has no memberships at all, which is what tells a
 * console to show an onboarding screen.
 */
export interface Me {
  readonly user: User;
  readonly memberships: Membership[];
  readonly active_organization: Organization | null;
  readonly session: Session;
}

/** What `POST /v1/organizations/switch` takes. `null` clears the active organization. */
export interface SwitchOrganizationInput {
  readonly organization_id: string | null;
}

/** What the switch answers. */
export interface SwitchOrganizationResult {
  readonly active_organization: Organization | null;
}

/** A domain's trust. **Only `verified` is an origin the service will answer CORS for.** */
export type DomainVerificationStatus = Open<"pending" | "verified" | "revoked">;

/**
 * A website's domain and its verification state.
 *
 * @remarks
 * Adding a domain claims it; verifying its TXT record proves it. `verification_record` and
 * `verification_token` are what to publish: `_lamido-verify.<domain>` as a TXT record holding the
 * token. Open beyond that — the knowledge base shows these members and no full body.
 */
export interface Domain {
  readonly public_id: string;
  readonly status: DomainVerificationStatus;
  readonly verification_record: string;
  readonly verification_token: string;
  readonly verified_at: string | null;
  readonly last_checked_at: string | null;
  readonly [member: string]: unknown;
}

/** What `POST /v1/websites/{id}/domains` takes. */
export interface AddDomainInput {
  readonly domain: string;
}

/**
 * A tenant's website.
 *
 * @remarks
 * `domains` is embedded, so a console renders the site card from one call. Open beyond the shown
 * members.
 */
export interface Website {
  readonly public_id: string;
  readonly name: string;
  readonly organization: string;
  readonly domains: Domain[];
  readonly [member: string]: unknown;
}

/** What `POST /v1/websites` takes. The organization comes from the session's active one. */
export interface CreateWebsiteInput {
  readonly name: string;
}

/**
 * What `PATCH /v1/websites/{id}` takes.
 *
 * @remarks
 * `primary_domain` must already be a **verified** domain on this website — otherwise
 * `409 domain_not_verified`, a different remedy from `domain_taken`. `null` clears it.
 */
export interface UpdateWebsiteInput {
  readonly name?: string;
  readonly primary_domain?: string | null;
}

/**
 * A website's `apk_` publishable key, as the listing shows it — `last4` and `fingerprint`, never the
 * plaintext. Revoked keys are listed too, so a rotation is not performed twice.
 */
export interface WebsiteKey {
  readonly public_id: string;
  readonly last4: string;
  readonly fingerprint: string;
  readonly [member: string]: unknown;
}

/**
 * A freshly minted key. **Capture `key`** — it appears in this response and never again.
 */
export interface MintedWebsiteKey extends WebsiteKey {
  readonly key: string;
}

/**
 * Which sign-in methods a website offers, and where it may send a browser back to.
 *
 * @remarks
 * The Google client secret is write-only: it goes in through {@link LoginSettingsInput}, and only its
 * `last4` and `fingerprint` come out.
 */
export interface LoginSettings {
  readonly magic_link_enabled: boolean;
  readonly google_enabled: boolean;
  readonly google_client_id: string | null;
  readonly google_client_secret_last4: string | null;
  readonly google_client_secret_fingerprint: string | null;
  /** Every entry must be on a **verified** domain of this website, or the write is a `400`. */
  readonly redirect_urls: string[];
  readonly session_ttl_seconds: number | null;
}

/** What `PATCH /v1/websites/{id}/login-settings` takes. Every member is optional. */
export interface LoginSettingsInput {
  readonly magic_link_enabled?: boolean;
  readonly google_enabled?: boolean;
  /** The **website's** Google client, so the consent screen shows the tenant's brand. */
  readonly google_client_id?: string | null;
  readonly google_client_secret?: string | null;
  readonly redirect_urls?: string[];
}

/**
 * Mail branding — the name is misleading and worth reading twice.
 *
 * @remarks
 * This is the branding of the **email** this service sends on the tenant's behalf: the sender name
 * and the reply-to address. There is no logo here and no colour; anything else is a `400` naming the
 * only two fields it accepts.
 */
export interface Branding {
  readonly sender_name: string | null;
  readonly reply_to: string | null;
}

/** What `PATCH /v1/websites/{id}/branding` takes. */
export interface BrandingInput {
  readonly sender_name?: string | null;
  readonly reply_to?: string | null;
}
