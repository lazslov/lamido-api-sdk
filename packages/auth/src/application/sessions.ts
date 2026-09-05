/**
 * `/v1/auth/me`, `/v1/auth/logout`, `/v1/sessions` — a signed-in person and their devices.
 *
 * @remarks
 * Every route here needs the `ask_` key **and** `X-Session-Token`. The key says which backend is
 * calling; the session says for whom. They are checked in that order, so a session with no key is a
 * `401` — and every `401` is byte-identical, whatever caused it.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import {
  call,
  callCursorList,
  type PageOptions,
  pageQuery,
  passInit,
  type RequestOptions,
  withSession,
} from "../call.js";
import type { AuthPage, Me, Session } from "../types.js";

/** The session half of an application client. */
export interface SessionMethods {
  /**
   * The person, their memberships, and the active organization.
   *
   * @param sessionToken - The person's session, sent as `X-Session-Token`.
   * @remarks
   * `memberships` is a real list — the claim that it was always `[]` has been false since Phase 2. A
   * fresh user has none, which is what tells a console to show an onboarding screen.
   */
  getMe(sessionToken: string, options?: RequestOptions): Promise<Me>;

  /**
   * Sign the person out. `204`; the session is revoked server-side, immediately, on every instance.
   *
   * @remarks
   * Also clears the cookie. Run it last: it revokes the session every other call depends on.
   */
  logout(sessionToken: string, options?: RequestOptions): Promise<void>;

  /**
   * The person's live sessions, every device. The current one is flagged.
   *
   * @remarks
   * A session's lifetime is 30 days, **absolute** — not extended by use, because a sliding expiry keeps
   * a stolen token alive exactly as long as it is being used.
   */
  listSessions(sessionToken: string, options?: PageOptions): Promise<AuthPage<Session>>;

  /**
   * Revoke another session by its `public_id` — "sign out my other laptop".
   *
   * @remarks
   * Revoking the current session this way is allowed, and indistinguishable from logging out.
   */
  revokeSession(sessionToken: string, publicId: string, options?: RequestOptions): Promise<void>;
}

/**
 * Bind the session methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindSessionMethods(cfg: ResolvedConfig): SessionMethods {
  return {
    getMe: (sessionToken, options = {}) =>
      call<Me>(cfg, {
        method: "GET",
        path: "/v1/auth/me",
        headers: withSession(sessionToken),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async logout(sessionToken, options = {}) {
      await call<undefined>(cfg, {
        method: "POST",
        path: "/v1/auth/logout",
        headers: withSession(sessionToken),
        read: { kind: "none" },
        ...passInit(options),
      });
    },

    listSessions: (sessionToken, options = {}) =>
      callCursorList<Session>(cfg, {
        method: "GET",
        path: "/v1/sessions",
        query: pageQuery(options),
        headers: withSession(sessionToken),
        ...passInit(options),
      }),

    async revokeSession(sessionToken, publicId, options = {}) {
      await call<unknown>(cfg, {
        method: "DELETE",
        path: `/v1/sessions/${encodeURIComponent(publicId)}`,
        headers: withSession(sessionToken),
        read: { kind: "raw" },
        ...passInit(options),
      });
    },
  };
}
