/**
 * `POST /v1/authorize` and `POST /v1/permissions` — the routes this service exists for.
 *
 * @remarks
 * Both take the `ask_` key alone and **no session header**: they ask a question *about* a person,
 * who is named inside the request by their session token, and borrowing somebody's session to ask a
 * question about them would be the wrong credential for the question.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import { call, callUnpaginated, passInit, type RequestOptions } from "../call.js";
import type { AuthorizeDecision, AuthorizeInput, Permission, PermissionsInput } from "../types.js";

/** The authorization half of an application client. */
export interface AuthorizationMethods {
  /**
   * May this principal do this?
   *
   * @param input - The principal by session token, the key's own organization, optionally a website,
   * and the permission key.
   * @returns `{ decision: "allow" }` or `{ decision: "deny" }`, **and never why.** An invalid session, a
   * principal in another tenant, somebody else's website and a permission nobody registered are four
   * different mistakes and one answer; telling them apart would make the route an oracle. When a human
   * needs the reason, the handle is `requestId` on the response.
   * @throws {@link ../errors.js | AuthApiError} on a `404` when `organization_id` is not the key's own
   * — a fact about your configuration, not an answer about a principal — and on a `400` for the
   * removed `{ kind, public_id }` principal form.
   * @throws `TypeError` when the service answers a decision this SDK does not know. `decision` is the
   * one enum in this API that cannot grow, and an unrecognised value is an outcome you cannot determine,
   * which must fail closed rather than be widened into a type.
   * @remarks
   * Use this to gate the **action**; use {@link AuthorizationMethods.listPermissions} to gate a rendered
   * UI. Never the set alone: a UI that hides a button has not stopped a request. Both ladders must say
   * yes — a role granting the permission *and*, where a feature gates it, a live subscription carrying
   * that feature. An override beats every role.
   *
   * You cannot obtain a session token from this API, so a rehearsal with no readable inbox can execute
   * a `deny` and not an `allow`.
   */
  authorize(input: AuthorizeInput, options?: RequestOptions): Promise<AuthorizeDecision>;

  /**
   * The whole permission set for a principal, for rendering a UI.
   *
   * @returns Flat keys. A principal that does not resolve is an **empty set**, not a `404`: every
   * refusal on the decision route is a `deny`, and the introspection twin of a deny is no permissions.
   * @remarks
   * The same evaluator as `authorize`, so the set and the single answer cannot disagree. Answers the
   * collection envelope but never paginates, so the rows come back alone.
   */
  listPermissions(input: PermissionsInput, options?: RequestOptions): Promise<Permission[]>;
}

/**
 * Bind the authorization methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindAuthorizationMethods(cfg: ResolvedConfig): AuthorizationMethods {
  return {
    async authorize(input, options = {}) {
      const answer = await call<{ decision?: unknown }>(cfg, {
        method: "POST",
        path: "/v1/authorize",
        body: input,
        read: { kind: "raw" },
        ...passInit(options),
      });
      return { decision: readDecision(answer.decision) };
    },

    listPermissions: (input, options = {}) =>
      callUnpaginated<Permission>(cfg, {
        method: "POST",
        path: "/v1/permissions",
        body: input,
        ...passInit(options),
      }),
  };
}

/**
 * Narrow the wire value to the two decisions, refusing anything else.
 *
 * @remarks
 * Hard-coded on purpose. A third value is not "unknown, ignore it" — it is a request whose outcome you
 * cannot determine, and the only safe reading is to refuse loudly.
 */
function readDecision(value: unknown): AuthorizeDecision["decision"] {
  if (value === "allow" || value === "deny") return value;
  throw new TypeError(
    `auth-service answered a decision this SDK does not know (${JSON.stringify(value)}). ` +
      "The decision enum cannot grow, so this is refused rather than read as allow or deny.",
  );
}
