/**
 * `POST /v1/oauth/google/start` — connecting a Gmail mailbox.
 *
 * @remarks
 * On the tenant tier because a tenant may connect their own mailbox without an operator, and in
 * this package because tenant-api §5 addresses the caller as *"a server-side integration, not a
 * browser"* — which is what this package is for. The callback that finishes the flow carries no
 * key of ours and is Google's contract, so it is not here; neither is the disconnect, which is
 * admin-tier.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, passInit, type RequestOptions } from "./call.js";
import type { OauthStartInput, StartedOauthFlow } from "./types.js";

/** The mailbox-connection endpoint of a tenant client. */
export interface OauthMethods {
  /**
   * Begin connecting a Gmail mailbox, so the service can send as it.
   *
   * @param body - The credential slug the callback writes to, and where the browser lands after
   * consent.
   * @param options - `init` only.
   * @returns A consent URL and its expiry — ten minutes out.
   * @throws {@link ./errors.js | EmailApiError} `400` when `return_url` is not under the
   * service's own base URL. Checked here, at the start, so the refusal reaches whoever typed it
   * while the flow is still theirs to fix.
   * @remarks
   * **Nothing is redirected, and that is the whole shape of this route.** It answers a URL;
   * handing it to whoever is connecting the mailbox — an email, a link in your own admin UI — is
   * yours to do. The `state` inside it is signed and stored, single-use, and expires in ten
   * minutes.
   *
   * A tenant may connect two mailboxes by using two `config_id` slugs. There is no tenant-tier
   * disconnect: that is an operator's call.
   *
   * Four permanent costs of a Gmail tenant are in tenant-api.md and worth reading before choosing
   * it — the first is that Gmail reports nothing back, so **no suppression is ever recorded
   * automatically**.
   */
  startGoogleOauth(body: OauthStartInput, options?: RequestOptions): Promise<StartedOauthFlow>;
}

/**
 * Bind the OAuth method to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindOauthMethods(cfg: ResolvedConfig): OauthMethods {
  return {
    startGoogleOauth: (body, options = {}) =>
      call<StartedOauthFlow>(cfg, {
        method: "POST",
        path: "/v1/oauth/google/start",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
