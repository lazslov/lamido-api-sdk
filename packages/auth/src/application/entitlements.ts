/**
 * `GET /v1/subscriptions`, `GET /v1/plans`, `GET /v1/features` — what has this tenant paid for?
 *
 * @remarks
 * `ask_` only, no session. **`features` is the gate, `plans` is not**: a permission is
 * entitlement-gated when at least one feature includes it, and the effective set is computed from the
 * live subscription. Reading the plan and inferring the features re-implements a join that already has
 * an endpoint — and gets `past_due` wrong.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import {
  callCursorList,
  callUnpaginated,
  type PageOptions,
  pageQuery,
  passInit,
  type RequestOptions,
} from "../call.js";
import type { AuthPage, Feature, Plan, Subscription } from "../types.js";

/** Which tenant an entitlement read is about. */
export interface EntitlementScope extends RequestOptions {
  /** **Required.** An organization that is not the key's own is a `404` — a `403` would confirm it exists. */
  readonly organization_id: string;
  /** Narrows to one website. Somebody else's is a `404`. */
  readonly website_id?: string;
}

/** {@link EntitlementScope} plus pagination, for the one entitlement list that grows. */
export interface SubscriptionListOptions extends EntitlementScope, PageOptions {}

/** The entitlement half of an application client. */
export interface EntitlementMethods {
  /**
   * The tenant's subscriptions, newest first.
   *
   * @remarks
   * `past_due` **still has access** — a grace window runs from `past_due_at`. `canceled` and `expired`
   * are terminal, and a renewal is a **new** row. `period_end` is exclusive.
   */
  listSubscriptions(options: SubscriptionListOptions): Promise<AuthPage<Subscription>>;

  /**
   * The plans on offer, for a pricing page. Not for a gate.
   *
   * @remarks
   * The contract declares `limit` and `cursor` here, so this reads a page; the Markdown notes the set
   * is registry-bounded and `nextCursor` is always `null` in practice.
   */
  listPlans(options?: PageOptions): Promise<AuthPage<Plan>>;

  /**
   * **The effective feature set** — what this tenant may use right now.
   *
   * @remarks
   * Computed from the live subscription, `past_due` included. This is the gate. Answers the collection
   * envelope but declares no pagination parameter, so the rows come back alone.
   */
  listFeatures(options: EntitlementScope): Promise<Feature[]>;
}

/**
 * Bind the entitlement methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindEntitlementMethods(cfg: ResolvedConfig): EntitlementMethods {
  return {
    listSubscriptions: (options) =>
      callCursorList<Subscription>(cfg, {
        method: "GET",
        path: "/v1/subscriptions",
        query: {
          organization_id: options.organization_id,
          website_id: options.website_id,
          ...pageQuery(options),
        },
        ...passInit(options),
      }),

    listPlans: (options = {}) =>
      callCursorList<Plan>(cfg, {
        method: "GET",
        path: "/v1/plans",
        query: pageQuery(options),
        ...passInit(options),
      }),

    listFeatures: (options) =>
      callUnpaginated<Feature>(cfg, {
        method: "GET",
        path: "/v1/features",
        query: { organization_id: options.organization_id, website_id: options.website_id },
        ...passInit(options),
      }),
  };
}
