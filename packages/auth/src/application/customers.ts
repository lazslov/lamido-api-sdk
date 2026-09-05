/**
 * `/v1/customers` and `POST /v1/customer-sessions/verify` — a website's own identities.
 *
 * @remarks
 * `ask_` only, no session. Identity is keyed on `(website, email)`, so every read names its website
 * and there is no lookup by address alone — a lookup by address is what the sign-in flows answer.
 */

import type { ResolvedConfig } from "@lazslov/api-core";
import {
  call,
  callCursorList,
  callWithMeta,
  type PageOptions,
  pageQuery,
  passInit,
  type RequestOptions,
} from "../call.js";
import type {
  AuthPage,
  CreateCustomerInput,
  CreateCustomerResult,
  Customer,
  CustomerSessionVerdict,
  VerifyCustomerSessionInput,
} from "../types.js";

/** Which website a customer belongs to. Required on every customer read. */
export interface CustomerScope extends RequestOptions {
  /**
   * **Required.** Absent, malformed, and *names a website your organization does not own* are one
   * answer — `404` — because a `400` would confirm that a website id exists. So a forgotten parameter
   * looks exactly like *no such endpoint*; the type makes forgetting it a compile error instead.
   */
  readonly website: string;
}

/** {@link CustomerScope} plus pagination. */
export interface CustomerListOptions extends CustomerScope, PageOptions {}

/** The customer half of an application client. */
export interface CustomerMethods {
  /**
   * One website's customers, keyset-paginated, newest first.
   *
   * @remarks
   * There is no `email` filter and no search on this listing.
   */
  listCustomers(options: CustomerListOptions): Promise<AuthPage<Customer>>;

  /**
   * Create-or-resolve a customer.
   *
   * @param body - `website`, `email`, and optionally `name`. **The field is `website`, not `website_id`.**
   * @returns The customer, and whether this call created it.
   * @remarks
   * Safe to call on every checkout without asking first: `201` when created, `200` when the row already
   * existed, and `created` is read from that status. No idempotency key — the route is idempotent by
   * construction.
   */
  createCustomer(
    body: CreateCustomerInput,
    options?: RequestOptions,
  ): Promise<CreateCustomerResult>;

  /**
   * Read one customer.
   *
   * @param publicId - The customer's `public_id`.
   * @param options - The website, which is required.
   * @throws {@link ../errors.js | AuthApiError} on a `404` — **never `null`**. One answer for *does not
   * exist* and *belongs to another website*, on purpose, so the error names both readings.
   */
  getCustomer(publicId: string, options: CustomerScope): Promise<Customer>;

  /**
   * Is this browser session real? The hot path.
   *
   * @param body - `{ website, token }`. The field is `token`, not `session_token`, and `website` is
   * required — a customer session belongs to one website and cannot be resolved without naming it.
   * @returns A verdict. An invalid, expired or unknown session is **`{ valid: false }`, never a throw**:
   * the request authenticated fine, and the answer is no.
   * @throws {@link ../errors.js | AuthApiError} for a `400` — sending `{ session_token }` answers one
   * with three pointers at once — and for the credential failures every route shares.
   * @remarks
   * **Cache the verdict until `expires_at`**, which is why that field is returned. The route is
   * throttled per key like every consumer route, and an application that verifies on every request it
   * serves will reach the limit. `last_seen_at` is deliberately not touched here.
   */
  verifyCustomerSession(
    body: VerifyCustomerSessionInput,
    options?: RequestOptions,
  ): Promise<CustomerSessionVerdict>;
}

/**
 * Bind the customer methods to one configuration.
 *
 * @param cfg - The resolved configuration.
 * @internal
 */
export function bindCustomerMethods(cfg: ResolvedConfig): CustomerMethods {
  return {
    listCustomers: (options) =>
      callCursorList<Customer>(cfg, {
        method: "GET",
        path: "/v1/customers",
        query: { website: options.website, ...pageQuery(options) },
        ...passInit(options),
      }),

    async createCustomer(body, options = {}) {
      const answer = await callWithMeta<Customer>(cfg, {
        method: "POST",
        path: "/v1/customers",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      });
      // The status is the signal: 201 created it, 200 resolved an existing row.
      return { customer: answer.value, created: answer.status === 201 };
    },

    getCustomer: (publicId, options) =>
      call<Customer>(cfg, {
        method: "GET",
        path: `/v1/customers/${encodeURIComponent(publicId)}`,
        query: { website: options.website },
        read: { kind: "raw" },
        ...passInit(options),
      }),

    verifyCustomerSession: (body, options = {}) =>
      call<CustomerSessionVerdict>(cfg, {
        method: "POST",
        path: "/v1/customer-sessions/verify",
        body,
        read: { kind: "raw" },
        ...passInit(options),
      }),
  };
}
