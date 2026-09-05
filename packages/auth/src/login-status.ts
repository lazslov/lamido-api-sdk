/**
 * The one decision a polling loop makes, and the trap it exists to avoid.
 *
 * @remarks
 * Every poll of an **approved** login request mints a fresh `exchange_code` and invalidates the
 * previous one. A loop that keeps running while the exchange is in flight therefore kills the code
 * it is spending, and the exchange answers `409 token_consumed`. This is the single most common
 * integration bug on this API, and it is why the stop condition is a function rather than a sentence.
 */

import type { LoginStatus } from "./types.js";

/**
 * Whether a poll answer is terminal, so the loop must stop.
 *
 * @param status - One poll of `GET …/magic-link/{handle}/status`.
 * @returns `true` when `poll_interval_ms` is `null`.
 * @remarks
 * Reads `poll_interval_ms`, **not** `status`: a terminal status carries `null`, a non-terminal one
 * carries a number, and that is the whole contract — on both surfaces, identically, since 2026-08-27.
 * Branching on `status` would have to enumerate `approved`, `consumed` and `expired`, and would then
 * keep polling forever on a value added later. An unrecognised status with a `null` interval stops the
 * loop, which is what data-model.md asks for.
 *
 * Note `=== null`, not `== null`: the customer surface once omitted the field on approval, and a
 * client that read `undefined` never stopped. The service fixed the omission; this predicate would
 * still have reported `false` against it, which is the honest answer to "did the service say stop?".
 *
 * @example
 * ```ts
 * let poll = await auth.getMagicLinkStatus(login_request);
 * while (!isTerminalLoginStatus(poll)) {
 *   await sleep(poll.poll_interval_ms ?? 2000);
 *   poll = await auth.getMagicLinkStatus(login_request);
 * }
 * if (poll.status === "approved" && poll.exchange_code) {
 *   await auth.exchangeMagicLink({ login_request, exchange_code: poll.exchange_code });
 * }
 * ```
 */
export function isTerminalLoginStatus(status: LoginStatus): boolean {
  return status.poll_interval_ms === null;
}
