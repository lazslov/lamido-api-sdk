# Phase 9 — `@lazslov/auth`

**Goal:** the two consumer tiers of the estate's identity service — the `apk_` browser tier that
signs people and customers in, and the `ask_` client tier that answers *may this principal do this?*
— with the cross-device sign-in traps encoded rather than described, and the event layer's receiver
side. The package that sits in front of every other one: a mistake here is a person who cannot sign
in, or a decision that fails open.

**Depends on:** [phase 2](phase-2-api-core.md). Independent of the other phase 9 packages.

**Reference:** [auth-service/public-api.md](../auth-service/public-api.md),
[client-api.md](../auth-service/client-api.md), [conventions.md](../auth-service/conventions.md),
[data-model.md](../auth-service/data-model.md), [webhooks.md](../auth-service/webhooks.md),
[workflows.md](../auth-service/workflows.md) and [examples.http](../auth-service/examples.http). The
`code` table in conventions.md §3, the cross-device model in public-api.md §3 and the six-item
receiver checklist in webhooks.md §1 are this phase's acceptance criteria, restated as code.
Knowledge base at `714f2ee`, auth-service at `bbeb4d4`.

**Out of scope:** the operator tier (`aad_`), the provider callbacks a browser navigates to
(`/v1/providers/*`), the scheduler (`/api/cron/*`), the sealed inbound namespace (`/v1/hooks/*`) and
`/healthz`.

---

## 0. The scope decision

auth-service has six surfaces. Two of them belong to a consumer, and they belong to **different
consumers of the same application**: the browser signs people in with a publishable key, and the
backend asks questions with a secret one.

**Decision: both tiers ship, behind two constructors.** Not one client with a tier option. The two
keys have different blast radii and different browser rules — an `apk_` ships in front-end
JavaScript on purpose, an `ask_` answers the authorization decision for every principal in an
organization. A single object holding an `ask_` that *can* serve the browser flows is an `ask_` that
ends up in a client component. Two constructors mean the import graph shows which tier a module
touches.

The operator tier is a back office's and stays out. So do the provider callbacks: they are browser
navigations, one of them answers `text/html`, and no key of ours is presented on either.

---

## 1. The clients

```ts
createAuthPublicClient(config?)   // apk_ → /v1/public/*
tryCreateAuthPublicClient(config?)
createAuthClient(config?)         // ask_ → /v1/*
tryCreateAuthClient(config?)
```

Env: `AUTH_SERVICE_BASE_URL`, `AUTH_SERVICE_PUBLISHABLE_KEY`, `AUTH_SERVICE_APPLICATION_KEY` and
`AUTH_SERVICE_WEBHOOK_SECRET`. **All four are the SDK's proposal** — see §7.1.

`assertServerOnly` is applied **per key prefix rather than per client**: `["ask_"]` on both
constructors, so the browser tier also throws when it is handed a secret key in a browser, and an
`apk_` is accepted there because that is the whole point of the tier. The guard fires at
construction, earlier than the service's own tripwire, because by the time that `403` arrives the
key has shipped to every visitor and only rotation helps.

`mode` is never set on a request. conventions.md §2 says the tripwire keys on `Sec-Fetch-Dest`,
which undici does not send, and says in the same breath that the tripwire *is not a security
boundary* — so there is nothing for the SDK to satisfy.

The session token travels in `X-Session-Token` and never in `Authorization`. Every route that acts
for a person takes it as the **first argument**, which is what makes forgetting it a compile error
rather than the `401` every first integration hits.

---

## 2. Endpoints

### The browser tier — `apk_`, eleven methods

| Method | Path | Notes |
|---|---|---|
| `requestMagicLink(body)` | `POST /v1/public/auth/magic-link` | `202` — booked, not sent. Answers the same way whether or not the address has an account |
| `getMagicLinkStatus(handle)` | `GET …/auth/magic-link/{handle}/status` | Stop when `poll_interval_ms` is `null`. An unknown handle is a `404` |
| `exchangeMagicLink(body)` | `POST …/auth/magic-link/exchange` | `200` with the user, plus the raw `Set-Cookie` |
| `startGoogle(body?)` | `POST …/auth/google/start` | Answers a URL. Nothing is redirected |
| `requestCustomerMagicLink(body)` | `POST /v1/public/customers/auth/magic-link` | Same contract; `login_method_disabled` when the website turned it off |
| `getCustomerMagicLinkStatus(handle)` | `GET …/customers/auth/magic-link/{handle}/status` | Identical to the platform poll since 2026-08-27 |
| `exchangeCustomerMagicLink(body)` | `POST …/customers/auth/magic-link/exchange` | **`204`, no body.** Returns `{ setCookie }` alone |
| `startCustomerGoogle(body?)` | `POST …/customers/auth/google/start` | The website's own Google client |
| `getInvitation(token)` | `GET /v1/public/invitations/{token}` | The one browser route that answers content to a person with no session |
| `acceptInvitation(token, session)` | `POST …/accept` | Needs the person's session as well. Emits `membership.created` |
| `declineInvitation(token, session)` | `POST …/decline` | Leaves the invitation `revoked`; not re-openable |

### The client tier — `ask_`, thirty-five methods

| Group | Methods | Credential |
|---|---|---|
| Authorization | `authorize`, `listPermissions` | key only — **no session header** |
| Entitlements | `listSubscriptions`, `listPlans`, `listFeatures` | key only |
| Customers | `listCustomers`, `createCustomer`, `getCustomer`, `verifyCustomerSession` | key only |
| Sessions | `getMe`, `logout`, `listSessions`, `revokeSession` | key **and** session |
| Organizations | `listOrganizations`, `createOrganization`, `getOrganization`, `switchOrganization`, `listInvitations`, `createInvitation`, `revokeInvitation` | key **and** session |
| Websites | `listWebsites`, `createWebsite`, `getWebsite`, `updateWebsite`, `listDomains`, `addDomain`, `verifyDomain`, `removeDomain`, `listWebsiteKeys`, `mintWebsiteKey`, `revokeWebsiteKey`, `getLoginSettings`, `updateLoginSettings`, `getBranding`, `updateBranding` | key **and** session |

Notes that shape the signatures:

- **The two authorization routes take no session header**, deliberately. They ask a question *about*
  a person who is named inside the request; borrowing somebody's session to ask about them is the
  wrong credential for the question.
- **`CustomerScope.website` is required**, because omitting `?website=` is a `404` rather than a
  `400` — so a forgotten parameter looks exactly like *no such endpoint*. The type makes forgetting
  it a compile error instead.
- **`EntitlementScope.organization_id` is required** for the same reason: an organization that is not
  the key's own is a `404`.
- **Four collections read as bare arrays.** `listPermissions`, `listFeatures`, `listDomains` and
  `listWebsiteKeys` answer the collection envelope but declare no `limit` or `cursor` in the pinned
  contract, so `callUnpaginated` returns the rows and drops an always-`null` cursor. `listPlans`
  **does** declare both, so it reads a page although the Markdown says the set is registry-bounded.
- **`mintWebsiteKey` takes a required `IdempotencyKey`**; the three other creates take an optional
  one. See §5.
- **`logout` and `exchangeCustomerMagicLink` read no body** (`read: { kind: "none" }`), because both
  answer `204` and reading one is the T-24 crash.

---

## 3. The five traps, encoded rather than described

Each of these is a documented incident, and each is a function or a type rather than a paragraph.

1. **`matching_code` must be displayed.** `MagicLinkRequested.matching_code` is required and its
   TSDoc says a front end that drops it cannot sign anybody in. The SDK cannot force a render, so
   this is the one trap that stays prose — noted here because it is the only one.
2. **Stop polling when `poll_interval_ms` is `null`.** `isTerminalLoginStatus` reads the interval and
   **not** `status`: a terminal status carries `null` on both surfaces, and branching on the status
   would have to enumerate `approved`, `consumed` and `expired` and would then loop forever on a
   value added later. `=== null`, not `== null`, because the customer surface once omitted the field
   and a client reading `undefined` never stopped.
3. **The customer exchange answers `204` with only a `Set-Cookie` header.**
   `CustomerExchangeResult` declares `setCookie` and nothing else, so a caller cannot read a body
   that does not exist. `sessionTokenFromSetCookie` is the reader a backend needs, and it matches the
   two documented cookie names only.
4. **`decision` cannot grow.** `AuthorizationDecision` is the one closed enum in the package, and
   `readDecision` throws a `TypeError` on a third value rather than widening it. Every other union
   carries an open `string & {}` arm, per data-model.md §3.
5. **An invalid customer session is `{ valid: false }`, not a `401`.** `verifyCustomerSession` never
   throws for it, and `CustomerSessionVerdict` is a discriminated union so `customer` is unreachable
   until `valid` is checked.

Two more the package encodes without being asked to:

- **`POST /v1/customers` is create-or-resolve and the status code is the signal.**
  `CreateCustomerResult.created` is read from `201` versus `200` through `callWithMeta`, so a caller
  never has to look at a status themselves.
- **A `404` is never mapped to `null`.** See §4.

---

## 4. Errors: branch on `type` and `code`

Every failure is `application/problem+json` under `urn:auth-service:problem:<slug>` over the
estate's closed slug set — core's reader, with this service's name bound to it.

> **RULE — branch on `type` and `code`, never on `title` or `detail`.** A test asserts no module
> reads either.

`AuthProblemCode` is **hand-written from conventions.md §3**, not aliased from the contract: the
pinned OpenAPI declares `Problem.code` as a bare `string`, so there is no generated union. Thirty
values, with a runtime `Set` beside the type and a test that the two agree — which is what makes a
code added upstream a failed test rather than a silent gap.

`retryable` overrides core in two places, both from the service's own table:

| Status | Core says | This package says | Why |
|---|---|---|---|
| `409` | not retryable | **`idempotency_in_flight` only** — retryable after a short wait | The 60-second lease. Every other `409` names a state that does not clear by waiting |
| `422` | retryable later | **not retryable** | Every `422` code auth-service documents says *No*: each needs a different request or a configuration change |

`502` stays retryable, and the TSDoc says what the table means by it: **once**, then surface the
failure. A `502` from a magic-link request has already spent the per-address budget, so a retry loop
exhausts the address having sent nothing.

### The `404` advice

A `404` on this service has **four** documented meanings and only one of them is *does not exist*:
another tenant's resource, an organization that is not the key's own, a customer call missing its
required `website`, and a login handle polled with a different website's key. Every `404` therefore
carries an `advice` string naming all four and both key variables, and **no method maps a `404` to
`null`** — mapping it would turn *you configured the wrong tenant* into *this does not exist yet*,
which is the harder bug to find.

`title` and `detail` are carried for a log and never branched on; `providerError` is carried on a
`502`. Every `401` is byte-identical and has no `code`, and a test asserts the parser never invents
one.

---

## 5. Idempotency

`Idempotency-Key` is **optional** on `createOrganization`, `createWebsite` and `createInvitation`,
and **required** on `mintWebsiteKey`. The SDK generates no key anywhere, and a test greps for it.

The mint is the exception because its plaintext is unrecoverable: workflows.md §4 says a repeat after
a dropped connection answers `409 key_exists` rather than replaying the key you never saw, so a
missing reservation leaves a tenant minting a *second* live credential that has already shipped
inside a page. A required argument is the only way to make that unskippable.

`createCustomer` deliberately sends none. The route is create-or-resolve — `201` created, `200`
resolved — so it is idempotent by construction, and a key would add a failure mode to a call that has
none.

§7.2 records why this does not match conventions.md §8's own sentence.

---

## 6. Webhooks

`verifyAuthWebhook` binds core's `verifySignedBody` to `X-Signature` / `X-Signature-Timestamp` with
a 300-second tolerance; the whole `whsec_` string is the key. Fixtures generated by
`test/fixtures/webhook/generate.mjs` with `node:crypto`: a `subscription.activated`, a
`customer.created`, a `webhook.ping`, a non-ASCII body, and every failure reason including the
stripped-prefix case.

The event model follows [webhooks.md §3](../auth-service/webhooks.md) exactly:

- Envelope: `event_id`, `contract_version`, `occurred_at`, `service`, `account_id` (nullable — a
  tenant provisioned a minute ago, not an error), `tenant` (`kind` always `"organization"`),
  `correlation_id`, `causation_id` (**never absent**, `null` on everything this service emits), `hop`
  and `data`.
- **`data` holds one block per resource, keyed by the resource name** — `data.subscription`,
  `data.customer` — not the resource inline as on email-service.
- `AuthWebhookEventType` is the six catalogue types; `pingEventType` is separate because
  `webhook.ping` is in no catalogue and is not subscribable. The union keeps a `string & {}` arm
  because *"ignore an unrecognised `event_type` and still answer `2xx`"* is checklist item 5.
  `isKnownEvent`, `isSubscriptionEvent`, `isCustomerEvent` and `isPingEvent` are the guards.
- The two `membership.*` arms keep `data` **open**. The knowledge base documents that the events fire
  and never shows their blocks, and a key the SDK guessed would be a type that lies.
- `parseAuthWebhookEvent` requires the block a typed arm promises. A `subscription.activated` with no
  `data.subscription` answers `null`, because a handler reading it would otherwise get `undefined`
  with no type error.

**auth-service is a pure emitter.** It receives no webhooks and `/v1/hooks/*` is sealed with a `404`,
so there is no inbound sender here and no receiver type for one.

The route handler on `./next` is payment's, renamed: required `alreadyProcessed`/`markProcessed`,
verify before parse, `200` for a duplicate and for an unknown type, `500` without `markProcessed`
when `onEvent` throws, secret read per request. It falls back to the payload's own `event_id` when
`X-Event-Id` is absent — the same value, because the payload is frozen at emission.

### `delivered` never means `verified`

webhooks.md §6 records a delivery this service's own test receiver **rejected**, stored as
`delivered, response_status: 204`. Nothing on the operator surface distinguishes a delivery you
processed from one you threw away. So the README says what no code can enforce: **raise your own
alarm when you reject a delivery**, and keep a reconciliation poll, because an auto-disabled endpoint
has no backlog at all.

---

## 7. Divergences from the knowledge base's own wording

Recorded so a later sync knows what was a choice and what was a finding.

1. **No environment-variable name is documented, for any of the four.** The service folder names its
   own deployment's variables (`SERVICE_BASE_URL`, `OAUTH_STATE_SECRET`), which belong to
   auth-service and never to a consumer. `AUTH_SERVICE_BASE_URL`,
   `AUTH_SERVICE_PUBLISHABLE_KEY`, `AUTH_SERVICE_APPLICATION_KEY` and `AUTH_SERVICE_WEBHOOK_SECRET`
   are this SDK's proposal, on the `<SERVICE>_SERVICE_<THING>` pattern content-service and
   invoice-service already document. **Open question for the knowledge base:** adopt them, or name
   its own.
2. **Idempotency scope: the Markdown and the contract disagree.** conventions.md §8 says
   `Idempotency-Key` is *"honoured on `POST /v1/admin/keys` only"*. The pinned contract declares
   `idempotency_body_mismatch` and `idempotency_in_flight` on **thirteen** operations, five of them
   on the client tier — `POST /v1/customers`, `/v1/organizations`,
   `/v1/organizations/{id}/invitations`, `/v1/websites` and `/v1/websites/{id}/keys` — and
   workflows.md §4 tells a caller to send one on three further operator routes conventions.md §8 does not
   mention. The SDK follows the **contract** for the four client-tier creates it exposes.
   **Open question:** conventions.md §8's sentence looks like the surviving Phase-1 scope.
3. **`examples.http` contradicts `public-api.md` inside the same commit.** Line 141 (the platform
   poll) still says *"the customer surface's approved response omits `poll_interval_ms` entirely"*;
   line 199 and public-api.md §3 both say auth-service T-53 fixed that on 2026-08-27 and the two
   surfaces now answer identically. `isTerminalLoginStatus` follows the corrected text, and its
   `=== null` comparison is correct against both.
4. **`webhooks.md` §8 names a route that does not exist.** *"Entitlements are read from
   `GET /v1/entitlements`, which is authoritative at the moment you ask."* There is no such path in
   client-api.md §3 or in the contract; the three that exist are `/v1/subscriptions`, `/v1/plans` and
   `/v1/features`. `listFeatures` is the gate, as client-api.md says.
5. **The webhook envelope differs from email-service's, and both folders call it the estate's.**
   auth's webhooks.md §3 shows `contract_version`, `tenant` and `causation_id`; email-service's shows
   `schema_version` and neither of the other two. The type follows this service's Markdown and the
   parser ignores extra members. **Open question for the knowledge base:** which spelling is the
   estate's. Recorded from the other side in [phase-9-email.md §7](phase-9-email.md).
6. **Almost every response type is hand-written, because the contract has no schemas.** The pinned
   OpenAPI's own header says *"response SCHEMAS are `{}` on most operations… do not generate a write
   client from this file"*, and it names six components: `Problem`, `Collection`,
   `AuthorizeDecision`, `Subscription`, `WebhookEndpoint` (operator-tier) and
   `CustomerSessionVerdict`. So `AuthorizationDecision`, `Subscription` and
   `CustomerSessionVerdict` are held to the generated schema by a `satisfies` chain in
   `test/type-safety.test.ts`, and everything else comes from the Markdown and from the responses
   `examples.http` shows.
7. **A resource whose full member list is never shown stays open.** `Customer`, `User`, `Plan`,
   `Organization`, `Membership`, `Session`, `Invitation`, `InvitationPreview`, `Domain`, `Website`
   and `WebsiteKey` all carry `[member: string]: unknown`. Inventing a complete-looking schema is how
   that folder became dangerous the first time, and an open type says *this is what is documented*
   rather than *this is everything*.
8. **`Subscription` is hand-written with all ten members required**, although the generated schema
   marks every one optional. The documented example carries all ten and the webhook block carries six
   of them; a `satisfies` chain in `test/type-safety.test.ts` proves the hand-written shape still
   fits the generated one.
9. **`CustomerSessionVerdict` is a discriminated union**, although the generated schema types
   `customer` as a bare `object | null` — which would make the one member a backend needs
   unreadable.
10. **The collection envelope is renamed.** `{ data, next_cursor }` becomes
    `{ items, nextCursor }` so core's `collectAllCursor` reads it, and the wire envelope stays
    internal. This is the one renaming in the package; every other wire name is kept verbatim,
    `public_id` and `poll_interval_ms` included, because those are the strings in the service's own
    docs and in every `curl` an integrator will paste.
11. **`/healthz` is not exposed.** conventions.md §2 lists it under *health*, not under a consumer
    tier, and nothing in either consumer surface reads it.
12. **The package's own prose miscounts the contract's schemas.** `src/types.ts` says the contract
    *"names a schema for four things only"* and then lists five. A one-word fix, left alone here
    because this phase's brief is documentation rather than source — flagged for the coordinator.

### Open questions

- **Does an unknown login handle answer `404` before or after a format check?** public-api.md §3
  says a handle that matches nothing is a `404`. The live case sends a well-formed 32-character
  base64url handle so the answer is the lookup's; a `400` would mean the format is validated first.
- **Does `POST /v1/authorize` validate the body before resolving the organization?** The live case
  for the removed `{kind, public_id}` principal sends a stranger's `organization_id`, so a `404`
  instead of a `400` would mean the tenant lookup runs first. Either answer is documented behaviour;
  which one runs first is not.
- **What does `data` carry on `membership.created` and `membership.revoked`?** Neither webhooks.md
  §7 nor `examples.http` shows a block. The arms stay open until it is written down.

---

## Public API surface

```ts
// @lazslov/auth
export { createAuthPublicClient, tryCreateAuthPublicClient, createAuthClient, tryCreateAuthClient }
export { AuthApiError, authProblemCodes, type AuthProblemCode }
export { isTerminalLoginStatus }
export { sessionTokenFromSetCookie, platformSessionCookie, customerSessionCookie }
export { verifyAuthWebhook, parseAuthWebhookEvent }
export { isKnownEvent, isSubscriptionEvent, isCustomerEvent, isPingEvent, pingEventType }
export { signatureHeader, timestampHeader, eventIdHeader, deliveryIdHeader, sessionTokenHeader }
export { VERSION }
// plus the wire types, the two client interfaces, the six method-group interfaces,
// and the request/page option types.

// @lazslov/auth/next
export { createAuthWebhookHandler }
```

---

## Exit criteria

- [x] Both tiers reachable, and only through their own constructor. The browser client offers the
      two sign-in surfaces and the invitation pages; the client offers the thirty-five documented
      client-tier routes. Both key sets asserted exactly.
- [x] No operator route, no provider callback, no scheduler route and no inbound receiver is named
      anywhere in the code. Grep-asserted.
- [x] `createAuthClient` throws in a browser naming rotation; `createAuthPublicClient` accepts an
      `apk_` there and refuses an `ask_`; neither falls back to the other's variable.
- [x] `tryCreate*` answer `null` with no environment at all and with half a configuration, and still
      throw for a leaked key.
- [x] A caught error carries no credential.
- [x] `isTerminalLoginStatus` is `false` while pending whatever the interval, `true` for every
      terminal status, stops on a status it has never heard of when the interval is `null`, and does
      **not** read an absent interval as `null`.
- [x] The customer exchange reads no body and answers `{ setCookie }`; the platform exchange answers
      the body plus the header; both report `null` where the runtime withholds it.
- [x] `sessionTokenFromSetCookie` binds the two documented cookie names, ignores the attributes,
      finds the cookie inside a combined header, and answers `null` for an empty value and for a
      header naming neither.
- [x] `authorize` posts the principal by session token with no session header, passes `website_id`
      through when given, answers `deny` as a value rather than a throw, and **refuses a decision it
      does not know**. A third value is a compile error, and nothing else in the package compares to
      `allow` or `deny`.
- [x] The removed `{ kind, public_id }` principal is a compile error.
- [x] `listPermissions` posts the decision body minus `permission` and answers an empty set for a
      principal that does not resolve.
- [x] `verifyCustomerSession` answers `{ valid: false }` without throwing, still throws for the `400`
      that `{ session_token }` produces, and narrows so `customer` is only reachable on a true
      verdict.
- [x] `createCustomer` reports `created` from `201` versus `200` and sends no `Idempotency-Key`.
- [x] `getCustomer` throws on a `404` and names the missing-`website` reading; every `404` carries
      the four-meanings advice and both key variables.
- [x] Every one of the thirty codes is recognised, an undocumented one is dropped, and a `401` never
      carries one.
- [x] `retryable` is `false` for every `422`, `true` for `idempotency_in_flight` alone among the
      `409`s, and `true` for `429`, `500` and `502`. `retry_after` is read from the member.
- [x] A list carries no `total` — reading one is a compile error — and `collectAllCursor` walks a
      subscription list with the cursor passed back verbatim.
- [x] `mintWebsiteKey` has no overload without an `IdempotencyKey`, rejects a raw string, and sends
      no body. The package mints no key of its own. Grep-asserted.
- [x] The session-bearing routes take the session first and send it as `X-Session-Token`.
- [x] `verifyAuthWebhook` passes every pinned fixture, including a non-ASCII body and the
      stripped-prefix case; it reads headers case-insensitively, rejects a re-serialised body,
      verifies the identical delivery twice, and never throws.
- [x] `parseAuthWebhookEvent` keeps a `webhook.ping`, a membership event with whatever `data` it
      carries, and a type it has never heard of; answers `null` when a typed arm's block is missing.
      Reading `data.subscription` on an unknown arm is a compile error.
- [x] The route handler dedupes on `X-Event-Id` and not `X-Delivery-Id`, falls back to the payload's
      `event_id`, marks only after `onEvent` resolves, answers `500` without marking on a throw,
      `200` for a duplicate and for an unknown type, `401` naming the edge runtime, and `500` naming
      the variable when unset. It imports nothing from `next` (node baseline).
- [x] No request sets `mode`; no module reads a problem's `title` or `detail`; there is no default
      base URL and no deployment host anywhere. Grep-asserted.
- [x] Every documented JSON example is claimed: **36 examples, 20 key-checked across 13 distinct
      types**, with the admin tier, the sealed `/v1/hooks/*` namespace and the bare collection
      envelope classified out of scope by name.
- [ ] Live: `401` for an unknown `ask_` key, `403` for the tripwire before authentication, `404` for
      a stranger's customer id, `404` for a login handle on the browser tier, `400` for the removed
      principal form. **Not run** — no `AUTH_SERVICE_*` credentials in this environment.
- [ ] Live: an `allow` decision. **Cannot be rehearsed at all.**
      [client-api.md §2](../auth-service/client-api.md) says a session is minted by exactly two
      acts — a clicked email link and the Google callback — and *"there is no operator route, no CLI
      command and no test hook that mints one"*. So a rehearsal with no readable inbox can execute a
      `deny` and not an `allow`, and no live case asserts one. Proving it needs a person to open a
      mailbox once and a 30-day token reused from there.

## Out of scope here

The operator tier and its fourteen webhook-admin routes, the provider callbacks, the scheduler, the
sealed inbound namespace, `/healthz` — and, because the service has none: passwords, MFA, passkeys,
SAML, SCIM, a lookup of a customer by email address alone, any way to mint a session, bulk
endpoints, money of any kind, and a `total` on any list.
