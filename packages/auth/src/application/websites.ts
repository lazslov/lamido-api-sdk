/**
 * `/v1/websites/*` — a tenant's own sign-in surfaces: domains, publishable keys, login settings, mail
 * branding.
 *
 * @remarks
 * Every route needs the `ask_` key **and** `X-Session-Token`, and every route reads the session's
 * **active** organization — there is no organization in any path here. The ordering trap of the whole
 * section: a redirect URL must be on a **verified** domain, and a CORS origin *is* a verified domain.
 * So the order is add a domain → publish its TXT record → verify → and only then will
 * `updateLoginSettings` accept a redirect URL or a browser on that origin reach the browser tier at all.
 */

import type { IdempotencyKey, ResolvedConfig } from "@lazslov/api-core";
import {
  type CreateOptions,
  call,
  callCursorList,
  callUnpaginated,
  idempotencyHeader,
  type PageOptions,
  pageQuery,
  passInit,
  type RequestOptions,
  withSession,
} from "../call.js";
import type {
  AddDomainInput,
  AuthPage,
  Branding,
  BrandingInput,
  CreateWebsiteInput,
  Domain,
  LoginSettings,
  LoginSettingsInput,
  MintedWebsiteKey,
  UpdateWebsiteInput,
  Website,
  WebsiteKey,
} from "../types.js";

/** The website half of an application client. */
export interface WebsiteMethods {
  /**
   * The active organization's websites.
   *
   * @throws {@link ../errors.js | AuthApiError} with `code` `no_active_organization` when the session
   * has none — call `switchOrganization` first, which is why the code exists.
   */
  listWebsites(sessionToken: string, options?: PageOptions): Promise<AuthPage<Website>>;

  /** Create a website in the active organization. */
  createWebsite(
    sessionToken: string,
    body: CreateWebsiteInput,
    options?: CreateOptions,
  ): Promise<Website>;

  /** Read one website. `domains` is embedded. */
  getWebsite(sessionToken: string, websiteId: string, options?: RequestOptions): Promise<Website>;

  /**
   * Rename a website, or set its primary domain.
   *
   * @throws {@link ../errors.js | AuthApiError} with `code` `domain_not_verified` when
   * `primary_domain` names a domain whose TXT record has not been seen yet.
   */
  updateWebsite(
    sessionToken: string,
    websiteId: string,
    body: UpdateWebsiteInput,
    options?: RequestOptions,
  ): Promise<Website>;

  /** The website's domains, with each one's verification state. */
  listDomains(sessionToken: string, websiteId: string, options?: RequestOptions): Promise<Domain[]>;

  /**
   * Claim a domain. It starts `pending` and grants nothing.
   *
   * @throws {@link ../errors.js | AuthApiError} with `code` `domain_taken` when another website already
   * claims it — and the error says nothing about which.
   */
  addDomain(
    sessionToken: string,
    websiteId: string,
    body: AddDomainInput,
    options?: RequestOptions,
  ): Promise<Domain>;

  /**
   * Ask the service to check the domain's TXT record.
   *
   * @returns The domain, with `verification_record` and `verification_token` saying exactly what to
   * publish, and `status` still `pending` until the record exists.
   * @remarks
   * **This does not verify anything by itself** — it reads a record you must publish first. Calling it
   * before the record exists is not an error; it is a check that found nothing, which is why it answers
   * `200` with `status` unchanged. Publish the record, then call it again.
   */
  verifyDomain(
    sessionToken: string,
    websiteId: string,
    domainId: string,
    options?: RequestOptions,
  ): Promise<Domain>;

  /**
   * Remove a domain. **Destructive**: any redirect URL or CORS origin resting on it stops working the
   * moment this returns.
   */
  removeDomain(
    sessionToken: string,
    websiteId: string,
    domainId: string,
    options?: RequestOptions,
  ): Promise<void>;

  /**
   * The website's publishable keys, newest first. Revoked keys are listed too.
   *
   * @remarks
   * A tenant asking "what keys does this site have" needs to see the one they revoked last week,
   * because a listing that hides it is how a rotation gets performed twice.
   */
  listWebsiteKeys(
    sessionToken: string,
    websiteId: string,
    options?: RequestOptions,
  ): Promise<WebsiteKey[]>;

  /**
   * Mint an `apk_` publishable key for the website. **Capture `key`** — it appears in this response and
   * never again.
   *
   * @param key - **Required.** The plaintext is unrecoverable, so a dropped connection without a
   * reservation leaves you minting a *second* live credential that has already shipped inside a page.
   * Derive it from the operation, never from the clock.
   * @remarks
   * The one mint the tenant tier offers; a revoked key does not block a new one, so a tenant locked out
   * of their own site is recoverable from here.
   */
  mintWebsiteKey(
    sessionToken: string,
    websiteId: string,
    key: IdempotencyKey,
    options?: RequestOptions,
  ): Promise<MintedWebsiteKey>;

  /** Revoke a publishable key. Immediate: the next browser request carrying it is a `401`. */
  revokeWebsiteKey(
    sessionToken: string,
    websiteId: string,
    keyId: string,
    options?: RequestOptions,
  ): Promise<void>;

  /** Which sign-in methods the website offers, and where it may send a browser back to. */
  getLoginSettings(
    sessionToken: string,
    websiteId: string,
    options?: RequestOptions,
  ): Promise<LoginSettings>;

  /**
   * Change them.
   *
   * @throws {@link ../errors.js | AuthApiError} on a `400` pointing at `/redirect_urls/<n>` when a URL
   * is not on a **verified** domain of this website — the ordering trap biting.
   * @remarks
   * `google_client_secret` is write-only: only its `last4` and `fingerprint` ever come back.
   */
  updateLoginSettings(
    sessionToken: string,
    websiteId: string,
    body: LoginSettingsInput,
    options?: RequestOptions,
  ): Promise<LoginSettings>;

  /** The branding of the **email** this service sends on the tenant's behalf. Two fields; no logo, no colour. */
  getBranding(sessionToken: string, websiteId: string, options?: RequestOptions): Promise<Branding>;

  /** Change the sender name and the reply-to address. Anything else is a `400` naming the two fields. */
  updateBranding(
    sessionToken: string,
    websiteId: string,
    body: BrandingInput,
    options?: RequestOptions,
  ): Promise<Branding>;
}

/**
 * Bind the website methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindWebsiteMethods(cfg: ResolvedConfig): WebsiteMethods {
  const website = (websiteId: string) => `/v1/websites/${encodeURIComponent(websiteId)}`;
  const domain = (websiteId: string, domainId: string) =>
    `${website(websiteId)}/domains/${encodeURIComponent(domainId)}`;

  /** A read or write of one website sub-resource, with the session attached. */
  const request = <T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    sessionToken: string,
    options: RequestOptions,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    call<T>(cfg, {
      method,
      path,
      ...(body === undefined ? {} : { body }),
      headers: { ...withSession(sessionToken), ...headers },
      read: { kind: "raw" },
      ...passInit(options),
    });

  return {
    listWebsites: (sessionToken, options = {}) =>
      callCursorList<Website>(cfg, {
        method: "GET",
        path: "/v1/websites",
        query: pageQuery(options),
        headers: withSession(sessionToken),
        ...passInit(options),
      }),

    createWebsite: (sessionToken, body, options = {}) =>
      request<Website>(
        "POST",
        "/v1/websites",
        sessionToken,
        options,
        body,
        idempotencyHeader(options),
      ),

    getWebsite: (sessionToken, websiteId, options = {}) =>
      request<Website>("GET", website(websiteId), sessionToken, options),

    updateWebsite: (sessionToken, websiteId, body, options = {}) =>
      request<Website>("PATCH", website(websiteId), sessionToken, options, body),

    listDomains: (sessionToken, websiteId, options = {}) =>
      callUnpaginated<Domain>(cfg, {
        method: "GET",
        path: `${website(websiteId)}/domains`,
        headers: withSession(sessionToken),
        ...passInit(options),
      }),

    addDomain: (sessionToken, websiteId, body, options = {}) =>
      request<Domain>("POST", `${website(websiteId)}/domains`, sessionToken, options, body),

    verifyDomain: (sessionToken, websiteId, domainId, options = {}) =>
      request<Domain>("POST", `${domain(websiteId, domainId)}/verify`, sessionToken, options),

    async removeDomain(sessionToken, websiteId, domainId, options = {}) {
      await request<unknown>("DELETE", domain(websiteId, domainId), sessionToken, options);
    },

    listWebsiteKeys: (sessionToken, websiteId, options = {}) =>
      callUnpaginated<WebsiteKey>(cfg, {
        method: "GET",
        path: `${website(websiteId)}/keys`,
        headers: withSession(sessionToken),
        ...passInit(options),
      }),

    mintWebsiteKey: (sessionToken, websiteId, key, options = {}) =>
      request<MintedWebsiteKey>(
        "POST",
        `${website(websiteId)}/keys`,
        sessionToken,
        options,
        undefined,
        {
          "Idempotency-Key": key,
        },
      ),

    async revokeWebsiteKey(sessionToken, websiteId, keyId, options = {}) {
      await request<unknown>(
        "DELETE",
        `${website(websiteId)}/keys/${encodeURIComponent(keyId)}`,
        sessionToken,
        options,
      );
    },

    getLoginSettings: (sessionToken, websiteId, options = {}) =>
      request<LoginSettings>("GET", `${website(websiteId)}/login-settings`, sessionToken, options),

    updateLoginSettings: (sessionToken, websiteId, body, options = {}) =>
      request<LoginSettings>(
        "PATCH",
        `${website(websiteId)}/login-settings`,
        sessionToken,
        options,
        body,
      ),

    getBranding: (sessionToken, websiteId, options = {}) =>
      request<Branding>("GET", `${website(websiteId)}/branding`, sessionToken, options),

    updateBranding: (sessionToken, websiteId, body, options = {}) =>
      request<Branding>("PATCH", `${website(websiteId)}/branding`, sessionToken, options, body),
  };
}
