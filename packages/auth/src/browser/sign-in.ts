/**
 * `/v1/public/*` sign-in — two parallel surfaces, one shape.
 *
 * @remarks
 * Platform people sign in under `/v1/public/auth/*`; a website's own customers under
 * `/v1/public/customers/auth/*`. The four requests are identical in shape, the `apk_` key is identical,
 * and the only thing that decides which principal you get is the path. They are different tables and
 * different sessions — a person who is both an organization member and a shopper on one of its sites
 * has two identities, and that is correct.
 *
 * The one place the two surfaces answer differently is the exchange, and it is encoded in two return
 * types rather than described: the platform exchange is `200` with a body, the customer exchange is
 * `204` with nothing but a `Set-Cookie` header.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, callWithMeta, passInit, type RequestOptions } from "../call.js";
import type {
  CustomerExchangeResult,
  ExchangeInput,
  GoogleStart,
  GoogleStartInput,
  LoginStatus,
  MagicLinkInput,
  MagicLinkRequested,
  PlatformExchangeResult,
  PlatformSession,
} from "../types.js";

/** The sign-in half of a browser client. */
export interface SignInMethods {
  /**
   * Ask for a magic link for a **platform person**. `202`: the mail is booked, not sent.
   *
   * @param body - The address. Answers `202` whether or not it has an account: first sign-in *is*
   * registration.
   * @returns The `login_request` handle to keep, and the `matching_code` to **display**.
   * @throws {@link ../errors.js | AuthApiError} — a `502 provider_unavailable` when the mail provider
   * refused. **Retry that once, then surface it**: the per-address budget of five links per fifteen
   * minutes is charged *before* the provider is called, so a retry loop exhausts the address having
   * sent nothing.
   * @remarks
   * The device that clicks the emailed link is never signed in by clicking it. The click renders a
   * page asking for the six digits this response carries; typing them approves the request, and the
   * browser that called this method finishes with {@link SignInMethods.getMagicLinkStatus}.
   */
  requestMagicLink(body: MagicLinkInput, options?: RequestOptions): Promise<MagicLinkRequested>;

  /**
   * Poll a platform login request.
   *
   * @param loginRequest - The `login_request` handle. A handle that matches nothing — including one
   * minted on another website — is a `404`, never an endless `pending`.
   * @remarks
   * **Stop the moment `poll_interval_ms` is `null`** — use `isTerminalLoginStatus`. Every poll of an
   * approved request mints a fresh `exchange_code` and invalidates the previous one.
   */
  getMagicLinkStatus(loginRequest: string, options?: RequestOptions): Promise<LoginStatus>;

  /**
   * Exchange an approved platform login request for a session. `200`, with the user.
   *
   * @throws {@link ../errors.js | AuthApiError} with `code` `token_invalid` when nobody has approved
   * the request yet — **on this route that means keep polling**, not "bad link" — `token_consumed`
   * when it was already spent (usually by a poll that ran after approval), or `token_expired`.
   * @remarks
   * Single use. The session arrives as the `__Host-lamido_platform_session` cookie; a browser keeps it,
   * and a backend reads `setCookie`.
   */
  exchangeMagicLink(body: ExchangeInput, options?: RequestOptions): Promise<PlatformExchangeResult>;

  /**
   * Start Google sign-in for a platform person.
   *
   * @returns The URL to send the browser to. The service does not redirect.
   * @remarks
   * The callback is a browser navigation the service handles; nothing in this package calls it. Its
   * five failures are distinct on purpose — `oauth_state_invalid`, `oauth_denied`,
   * `oauth_email_unverified`, `provider_unavailable`, `oauth_not_configured` — and an unverified Google
   * address is **refused**, never warned about, because the address is the identity.
   */
  startGoogle(body?: GoogleStartInput, options?: RequestOptions): Promise<GoogleStart>;

  /**
   * Ask for a magic link for a **website customer**. Same contract as the platform request.
   *
   * @throws {@link ../errors.js | AuthApiError} with `code` `login_method_disabled` when the website
   * has turned magic links off — a refusal, because a `202` that sends nothing would be
   * indistinguishable from a broken mail provider.
   * @remarks
   * Customer identity is keyed on `(website, email)`: the same address on two websites is two
   * customers, and the `apk_` key is what names the website.
   */
  requestCustomerMagicLink(
    body: MagicLinkInput,
    options?: RequestOptions,
  ): Promise<MagicLinkRequested>;

  /**
   * Poll a customer login request. Same contract and same stop condition as the platform poll.
   *
   * @remarks
   * Literally the same since 2026-08-27: this surface used to omit `poll_interval_ms` on approval and
   * report an expired row as `pending`. A client written against that still works; it no longer needs
   * to.
   */
  getCustomerMagicLinkStatus(loginRequest: string, options?: RequestOptions): Promise<LoginStatus>;

  /**
   * Exchange an approved customer login request. **`204`, with no body.**
   *
   * @returns Only the raw `Set-Cookie` header — `null` in a browser, which stores the cookie itself.
   * @remarks
   * The response names neither the customer nor the website. A browser needs nothing more. A backend
   * reads the token out of `setCookie` with `sessionTokenFromSetCookie`, then calls
   * `verifyCustomerSession` on the **`ask_`** tier to learn who signed in. The T-24 smoke runner assumed
   * a JSON body here and crashed; this method reads none.
   */
  exchangeCustomerMagicLink(
    body: ExchangeInput,
    options?: RequestOptions,
  ): Promise<CustomerExchangeResult>;

  /**
   * Start Google sign-in for a website customer, against the **website's** own Google client.
   *
   * @throws {@link ../errors.js | AuthApiError} with `code` `oauth_not_configured` when the website
   * has no Google client or no return URL allow-listed — refused at the start rather than after a
   * consent screen — or `login_method_disabled`.
   */
  startCustomerGoogle(body?: GoogleStartInput, options?: RequestOptions): Promise<GoogleStart>;
}

/**
 * Bind the sign-in methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindSignInMethods(cfg: ResolvedConfig): SignInMethods {
  const platform = "/v1/public/auth";
  const customers = "/v1/public/customers/auth";
  const status = (surface: string, loginRequest: string) =>
    `${surface}/magic-link/${encodeURIComponent(loginRequest)}/status`;

  return {
    requestMagicLink: (body, options = {}) =>
      call<MagicLinkRequested>(cfg, {
        method: "POST",
        path: `${platform}/magic-link`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getMagicLinkStatus: (loginRequest, options = {}) =>
      call<LoginStatus>(cfg, {
        method: "GET",
        path: status(platform, loginRequest),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async exchangeMagicLink(body, options = {}) {
      const answer = await callWithMeta<PlatformSession>(cfg, {
        method: "POST",
        path: `${platform}/magic-link/exchange`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { ...answer.value, setCookie: answer.headers.get("set-cookie") };
    },

    startGoogle: (body = {}, options = {}) =>
      call<GoogleStart>(cfg, {
        method: "POST",
        path: `${platform}/google/start`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    requestCustomerMagicLink: (body, options = {}) =>
      call<MagicLinkRequested>(cfg, {
        method: "POST",
        path: `${customers}/magic-link`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),

    getCustomerMagicLinkStatus: (loginRequest, options = {}) =>
      call<LoginStatus>(cfg, {
        method: "GET",
        path: status(customers, loginRequest),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async exchangeCustomerMagicLink(body, options = {}) {
      // `none`: the 204 carries no body, and reading one would be the T-24 crash.
      const answer = await callWithMeta<undefined>(cfg, {
        method: "POST",
        path: `${customers}/magic-link/exchange`,
        body,
        read: { kind: "none" },
        ...passInit(options),
      });
      return { setCookie: answer.headers.get("set-cookie") };
    },

    startCustomerGoogle: (body = {}, options = {}) =>
      call<GoogleStart>(cfg, {
        method: "POST",
        path: `${customers}/google/start`,
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
