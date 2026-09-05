/**
 * The message lifecycle, and the one decision a consumer makes from it.
 *
 * @remarks
 * The lattice, from tenant-api.md:
 *
 * ```
 * queued ──▶ sending ──▶ sent ──▶ delivered
 *    │           │         │
 *    │           │         ├──▶ bounced
 *    │           │         └──▶ complained
 *    │           └──▶ failed
 *    ├──▶ canceled
 *    └──▶ suppressed
 * ```
 *
 * Transitions are monotonic: a late `sent` after a `delivered` is ignored rather than moving the
 * status backwards.
 */

import type { components } from "./generated/schema.js";

/** The nine statuses the service documents today. */
export type KnownMessageStatus = components["schemas"]["MessageStatus"];

/**
 * Where a message is in its lifecycle.
 *
 * @remarks
 * Three readings the knowledge base insists on:
 *
 * - **`202` means `queued`, not sent.** Nothing has left yet.
 * - **`sent` is not `delivered`.** `sent` means the provider accepted the bytes; only `delivered`
 *   means a receiving server accepted it, and only Resend reports that at all. **For an SMTP
 *   tenant `sent` is terminal** — waiting for `delivered` there waits forever.
 * - **`suppressed` is born, never reached.** The send is refused synchronously with
 *   `409 recipient_suppressed`, and the row is created in that state.
 *
 * `string & {}` keeps the nine literals in autocompletion while still accepting a status added
 * upstream after this SDK shipped: conventions §11 says a new enum value is not a breaking
 * change, and a client that throws on an unknown one turns every addition into an outage.
 */
export type MessageStatus = KnownMessageStatus | (string & Record<never, never>);

/**
 * Whether `cancelMessage` can still succeed.
 *
 * @param status - The message's status.
 * @returns `true` only for `queued`.
 * @remarks
 * The only cancellable state, and the window is short: the inline drain dispatches promptly on a
 * service with traffic. A message in any other status answers `422` to a cancel — including one
 * already `canceled`, deliberately, so a double-submit in your own code stays visible.
 */
export function isCancellable(status: MessageStatus): boolean {
  return status === "queued";
}
