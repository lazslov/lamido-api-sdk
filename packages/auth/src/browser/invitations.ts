/**
 * `/v1/public/invitations/*` — the browser tier's third flow.
 *
 * @remarks
 * The token is in the emailed URL. The preview is the only browser-tier route that answers useful
 * content to a person with no session, and it has to be: they must see **who** invited them to
 * **what** before they decide. Accepting and declining both need the person's session as well, because
 * each is a statement by the invited person — an unauthenticated decline would let anyone holding a
 * leaked URL burn somebody's invitation.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions, withSession } from "../call.js";
import type { InvitationPreview } from "../types.js";

/** The invitation half of a browser client. */
export interface InvitationMethods {
  /**
   * Read an invitation before signing in — who invited, to which organization, which role.
   *
   * @param token - The token from the emailed URL.
   * @throws {@link ../errors.js | AuthApiError} with one of three codes that **deserve three
   * different messages**: `invitation_consumed` (already accepted), `invitation_revoked` (withdrawn,
   * or refused — not re-openable), `invitation_expired` (past its fourteen days). A single "invalid
   * invitation" wastes the one piece of information the person needs.
   */
  getInvitation(token: string, options?: RequestOptions): Promise<InvitationPreview>;

  /**
   * Join. Emits `membership.created`.
   *
   * @param token - The token from the emailed URL.
   * @param sessionToken - The signed-in person's session; accepting binds them to the membership.
   * @remarks
   * Accepting when already a member **succeeds** rather than failing — the invitation is spent and
   * the membership exists, which is the caller's goal.
   */
  acceptInvitation(token: string, sessionToken: string, options?: RequestOptions): Promise<void>;

  /** Refuse. Leaves the invitation `revoked`; it cannot be re-opened. */
  declineInvitation(token: string, sessionToken: string, options?: RequestOptions): Promise<void>;
}

/**
 * Bind the invitation methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindInvitationMethods(cfg: ResolvedConfig): InvitationMethods {
  const invitation = (token: string) => `/v1/public/invitations/${encodeURIComponent(token)}`;

  return {
    getInvitation: (token, options = {}) =>
      call<InvitationPreview>(cfg, {
        method: "GET",
        path: invitation(token),
        read: { kind: "raw" },
        ...passInit(options),
      }),

    async acceptInvitation(token, sessionToken, options = {}) {
      // The answer's body is not documented, so nothing is read from it: success is the 2xx.
      await call<unknown>(cfg, {
        method: "POST",
        path: `${invitation(token)}/accept`,
        headers: withSession(sessionToken),
        read: { kind: "raw" },
        ...passInit(options),
      });
    },

    async declineInvitation(token, sessionToken, options = {}) {
      await call<unknown>(cfg, {
        method: "POST",
        path: `${invitation(token)}/decline`,
        headers: withSession(sessionToken),
        read: { kind: "raw" },
        ...passInit(options),
      });
    },
  };
}
