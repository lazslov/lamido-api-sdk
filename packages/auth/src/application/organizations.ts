/**
 * `/v1/organizations` and its invitations — what a person belongs to, and how a second person joins.
 *
 * @remarks
 * Every route needs the `ask_` key **and** `X-Session-Token`. A non-member reading an organization
 * gets a `404`, never a `403`: *exists but not yours* and *does not exist* must be indistinguishable
 * from outside.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import {
  type CreateOptions,
  call,
  callCursorList,
  idempotencyHeader,
  type PageOptions,
  pageQuery,
  passInit,
  type RequestOptions,
  withSession,
} from "../call.js";
import type {
  AuthPage,
  CreateInvitationInput,
  CreateOrganizationInput,
  Invitation,
  Organization,
  SwitchOrganizationInput,
  SwitchOrganizationResult,
} from "../types.js";

/** The organization half of an application client. */
export interface OrganizationMethods {
  /** The organizations this person is a member of — not every organization. */
  listOrganizations(sessionToken: string, options?: PageOptions): Promise<AuthPage<Organization>>;

  /**
   * Create an organization. The creator becomes its **owner**.
   *
   * @remarks
   * The only way a membership appears without an invitation, which is what breaks the chicken-and-egg
   * for a person nobody invited.
   */
  createOrganization(
    sessionToken: string,
    body: CreateOrganizationInput,
    options?: CreateOptions,
  ): Promise<Organization>;

  /** Read one. A `404` if this person is not a member — never a `403`. */
  getOrganization(
    sessionToken: string,
    publicId: string,
    options?: RequestOptions,
  ): Promise<Organization>;

  /**
   * Change the session's active organization.
   *
   * @remarks
   * Most tenancy routes read the session's **active** organization rather than taking one in the path —
   * `POST /v1/websites` has no organization field anywhere. Miss this call and every website route
   * answers `422 no_active_organization`. Passing `null` clears it, which is what a console does when a
   * person leaves a tenant.
   */
  switchOrganization(
    sessionToken: string,
    body: SwitchOrganizationInput,
    options?: RequestOptions,
  ): Promise<SwitchOrganizationResult>;

  /** The organization's invitations. The token is never in a listing — a listing is not a way to obtain one. */
  listInvitations(
    sessionToken: string,
    organizationId: string,
    options?: PageOptions,
  ): Promise<AuthPage<Invitation>>;

  /**
   * Invite somebody. The role is `owner` or `member`; there is no `admin`.
   *
   * @throws {@link ../errors.js | AuthApiError} — a `502 provider_unavailable` when the mail provider
   * refused, **and the invitation row is still created**. Read the listing before you retry, or you
   * will invite twice. Throttled to 50 per organization per hour.
   */
  createInvitation(
    sessionToken: string,
    organizationId: string,
    body: CreateInvitationInput,
    options?: CreateOptions,
  ): Promise<Invitation>;

  /** Withdraw an invitation. The token stops working immediately. */
  revokeInvitation(
    sessionToken: string,
    organizationId: string,
    invitationId: string,
    options?: RequestOptions,
  ): Promise<void>;
}

/**
 * Bind the organization methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindOrganizationMethods(cfg: ResolvedConfig): OrganizationMethods {
  const organization = (publicId: string) => `/v1/organizations/${encodeURIComponent(publicId)}`;

  return {
    listOrganizations: (sessionToken, options = {}) =>
      callCursorList<Organization>(cfg, {
        method: "GET",
        path: "/v1/organizations",
        query: pageQuery(options),
        headers: withSession(sessionToken),
        ...passInit(options),
      }),

    createOrganization: (sessionToken, body, options = {}) =>
      call<Organization>(cfg, {
        method: "POST",
        path: "/v1/organizations",
        body,
        headers: { ...withSession(sessionToken), ...idempotencyHeader(options) },
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getOrganization: (sessionToken, publicId, options = {}) =>
      call<Organization>(cfg, {
        method: "GET",
        path: organization(publicId),
        headers: withSession(sessionToken),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    switchOrganization: (sessionToken, body, options = {}) =>
      call<SwitchOrganizationResult>(cfg, {
        method: "POST",
        path: "/v1/organizations/switch",
        body,
        headers: withSession(sessionToken),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    listInvitations: (sessionToken, organizationId, options = {}) =>
      callCursorList<Invitation>(cfg, {
        method: "GET",
        path: `${organization(organizationId)}/invitations`,
        query: pageQuery(options),
        headers: withSession(sessionToken),
        ...passInit(options),
      }),

    createInvitation: (sessionToken, organizationId, body, options = {}) =>
      call<Invitation>(cfg, {
        method: "POST",
        path: `${organization(organizationId)}/invitations`,
        body,
        headers: { ...withSession(sessionToken), ...idempotencyHeader(options) },
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async revokeInvitation(sessionToken, organizationId, invitationId, options = {}) {
      await call<unknown>(cfg, {
        method: "DELETE",
        path: `${organization(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
        headers: withSession(sessionToken),
        read: { kind: "raw" },
        ...passInit(options),
      });
    },
  };
}
