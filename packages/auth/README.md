# @lazslov/auth

Consumer SDK for auth-service — browser sign-in for platform people and for a website's own
customers, the authorization decision, entitlements, and the events it emits.

**What ships in it:** both credential tiers behind two constructors, the cross-device sign-in flow
with its stop condition as a function, the authorization decision, entitlements, customers and
session verification, the tenancy routes, RFC 9457 error triage by `type` and `code`, webhook
verification, and the webhook route handler on `@lazslov/auth/next`.

## Install

```sh
pnpm add @lazslov/auth
```

Zero runtime dependencies except `@lazslov/api-core`, which is the shared transport.

## Configuration comes from your environment

```ini
AUTH_SERVICE_BASE_URL=https://auth.example.com
AUTH_SERVICE_PUBLISHABLE_KEY=apk_YOUR_WEBSITE_KEY
AUTH_SERVICE_APPLICATION_KEY=ask_YOUR_APPLICATION_KEY
AUTH_SERVICE_WEBHOOK_SECRET=whsec_YOUR_SIGNING_SECRET
```

All four names are **this SDK's proposal**. The knowledge base documents the credentials but no
variable name for any of them: the service folder names its own deployment's variables, and those
belong to auth-service rather than to a consumer. There is **no fallback host**: a missing base URL
is a configuration error the SDK reports, never a silent default.

## Two tiers, two constructors

```ts
createAuthPublicClient(); // apk_ → /v1/public/*  — the browser
createAuthClient(); // ask_ → /v1/*          — your backend
```

Not one client with a tier option. The two keys have different blast radii and different browser
rules, so separate constructors mean the import graph shows which tier a module touches.

**`apk_` is publishable on purpose.** It ships in front-end JavaScript, it identifies **which
website** a browser is signing into, and it grants nothing beyond that website's own public surface.
Anyone who can view the site can read it out of the bundle, and that is fine.

**An `ask_` key must never reach a browser.** It answers the authorization decision for every
principal in an organization. The service enforces this itself: any request to `/v1/*` carrying an
`Origin` or `Sec-Fetch-Dest` header is refused with a `403` **before authentication runs**.
`createAuthClient` throws earlier still, at construction — because by the time that `403` arrives the
key has shipped to every visitor, and the only remedy is **rotating** it. Your Node backend is
unaffected: undici sends only `Sec-Fetch-Mode`, which is deliberately not the signal, and the SDK
sets no `mode` of its own.

Both constructors apply the guard **per key prefix rather than per client**, so the browser tier
throws too when it is handed an `ask_` in a browser — which is the mistake the service's own tripwire
exists to catch, caught a step earlier. An `apk_` in a browser is fine, and that is the whole point
of the tier.

`tryCreateAuthPublicClient()` and `tryCreateAuthClient()` return `null` instead of throwing when
nothing is configured, so a site boots with no `AUTH_SERVICE_*` variables at all and sign-in degrades
to a disabled button. A leaked key still throws: that is not a missing configuration.

**CORS is served on `/v1/public/*` only, and only to a website's *verified* domains.** A refused
origin does not look refused — the preflight answers `204` with every CORS header except
`Access-Control-Allow-Origin`, the browser reports a generic error, and nothing appears in your
logs. If browser calls fail while backend calls succeed, check the domain's verification status
first.

## Signing somebody in

**The device that clicks the emailed link is never signed in by clicking it.** The browser that
started the sign-in is.

```ts
import { createAuthPublicClient, isTerminalLoginStatus } from "@lazslov/auth";

const auth = createAuthPublicClient();

const { login_request, matching_code } = await auth.requestCustomerMagicLink({ email });
show(matching_code); // six digits — the approval page asks the person for exactly these

let poll = await auth.getCustomerMagicLinkStatus(login_request);
while (!isTerminalLoginStatus(poll)) {
  await sleep(poll.poll_interval_ms ?? 2000);
  poll = await auth.getCustomerMagicLinkStatus(login_request);
}

if (poll.status === "approved" && poll.exchange_code) {
  await auth.exchangeCustomerMagicLink({ login_request, exchange_code: poll.exchange_code });
}
```

**Display `matching_code` or nobody can sign in.** The person clicking the link gets a page asking
for digits only the initiating device was shown. A front end that drops the field cannot complete a
sign-in, and the failure looks like the link being broken.

**Stop polling the moment `poll_interval_ms` is `null`** — that is what `isTerminalLoginStatus`
reads. Every poll of an **approved** request mints a fresh `exchange_code` and invalidates the
previous one, so a loop still running while you exchange kills the code you are spending, and the
exchange answers `409 token_consumed`. This is the single most common integration bug on this API.
The predicate reads the interval rather than `status`, so a status added upstream still stops the
loop. Note `=== null`, not `== null`: the customer surface once omitted the field on approval.

`202` from a magic-link request means the mail is **booked, not sent**, and it answers the same way
whether or not the address has an account — first sign-in *is* registration. A `502
provider_unavailable` here is the one `502` not to retry blindly: the per-address budget of five per
fifteen minutes is charged **before** the provider is called, so a retry loop exhausts the address
having sent nothing. Retry once, then surface it.

`login_request` is a credential and so is the emailed token, the `matching_code` and the
`exchange_code`. Holding one is not holding another.

### Platform people and website customers are different principals

The four requests above have an identical shape under `/v1/public/auth/*` — `requestMagicLink`,
`getMagicLinkStatus`, `exchangeMagicLink`, `startGoogle` — and the only thing that decides which
identity you get is which method you call. **The same address on two websites is two customers, and
neither is the platform user with that address.** Customer identity is keyed on `(website, email)`,
and the `apk_` key is what names the website. One browser holds both sessions at once whenever a
tenant's staff shop on their own site.

### The two exchanges do not answer the same way

| | Answers | The SDK returns |
| --- | --- | --- |
| `exchangeMagicLink` | `200` with the user and the session's `public_id` | that body, plus `setCookie` |
| `exchangeCustomerMagicLink` | **`204`, no body at all** | `{ setCookie }` and nothing else |

The customer exchange **names neither the customer nor the website**. A browser needs nothing more —
it keeps the cookie. A backend driving the flow reads the token out of the header and asks the other
tier who signed in:

```ts
import { createAuthClient, sessionTokenFromSetCookie } from "@lazslov/auth";

const { setCookie } = await auth.exchangeCustomerMagicLink(body);
const token = sessionTokenFromSetCookie(setCookie); // null in a browser, which stores it itself
if (token) {
  const verdict = await createAuthClient().verifyCustomerSession({ website, token });
}
```

**The session token is never in a response body**, on either surface. `sessionTokenFromSetCookie`
matches the two documented cookie names — `platformSessionCookie` and `customerSessionCookie`, both
`__Host-` prefixed — and returns `null` for anything else, so a CSRF or OAuth-state cookie cannot be
mistaken for a session. A `__Host-` cookie is never stored over plain `http`, so a local browser
flow needs an https tunnel or this reader.

`startGoogle` and `startCustomerGoogle` answer a URL; **the service does not redirect**, and the
callback is a browser navigation nothing in this package calls. Its five failures are distinct on
purpose, and an unverified Google address is **refused** rather than warned about, because the
address is the identity.

## May this principal do this?

```ts
import "server-only";
import { createAuthClient } from "@lazslov/auth";

const auth = createAuthClient();

const { decision } = await auth.authorize({
  principal: { kind: "user", session_token },
  organization_id,
  permission: "shop.orders.refund",
});
if (decision === "deny") return forbidden();
```

**The principal has one form: `{ kind, session_token }`.** The service validates the session as part
of the decision, so identity is checked rather than asserted. The former `{ kind, public_id }` form
is a `400` since 2026-08-24 — it let any holder of the key obtain a decision for any principal in
the organization with no proof of a session — and the type will not compile with it.

**The answer is `allow` or `deny` and never why.** An invalid session, a principal in another tenant,
somebody else's website and a permission nobody registered are four different mistakes and one
answer; telling them apart would make the route an oracle. When a human needs the reason, the handle
is `requestId` on the error or the response's `X-Request-Id`.

**`decision` is the one enum in this API that cannot grow**, so this SDK does not widen it: a third
value throws a `TypeError` rather than being read as `allow` or `deny`. Everywhere else an
unrecognised value is safe to ignore, and every other union here carries an open arm.

`listPermissions` answers the whole set for rendering a UI, from the same evaluator, so the set and
the single answer cannot disagree. **Never the set alone**: a UI that hides a button has not stopped
a request. A principal that does not resolve is an **empty set**, not a `404`.

An `organization_id` that is not the key's own is a **`404`, not a `deny`** — a fact about your
configuration rather than an answer about a principal. A `customer` principal with no `website_id` is
a `deny`, because a customer session cannot be validated without its website.

**You cannot obtain a session token from this API.** A session is minted only by a clicked email link
or a Google callback, so a rehearsal with no readable inbox can execute a `deny` and cannot execute
an `allow`.

## Entitlements

```ts
const features = await auth.listFeatures({ organization_id });
const gated = features.some((feature) => feature.key === "shop.refunds");
```

**`listFeatures` is the gate; `listPlans` is not.** A permission is entitlement-gated when at least
one feature includes it, and the effective set is computed from the live subscription. Reading the
plan and inferring the features re-implements a join that already has an endpoint — and gets
`past_due` wrong.

**`past_due` still has access.** A grace window runs from `past_due_at`. `canceled` and `expired` are
terminal, and a renewal is a **new** row rather than a revived one. `period_end` is **exclusive**, so
`>= period_end` is over.

`listSubscriptions` is keyset-paged with **no `total`** — there is none anywhere on this service.
Follow `nextCursor` until it is `null`, or hand the method to `collectAllCursor` from
`@lazslov/api-core`:

```ts
import { collectAllCursor } from "@lazslov/api-core";

const all = await collectAllCursor((page) => auth.listSubscriptions({ organization_id, ...page }));
```

`listFeatures` and `listPermissions` answer the collection envelope but declare no pagination
parameter, so this SDK returns their rows as a plain array.

## Customers, and the hot path

```ts
const { customer, created } = await auth.createCustomer({ website, email });
```

**`POST /v1/customers` is create-or-resolve, and the status code is the signal** — `201` when it
created the row, `200` when one already existed. `created` is read from that status, so this is safe
to call on every checkout without asking first, and it takes no idempotency key. **The field is
`website`, not `website_id`.**

```ts
const verdict = await auth.verifyCustomerSession({ website, token });
if (verdict.valid) cache(verdict.customer, verdict.expires_at);
```

**An invalid, expired or unknown session is `200` with `{ valid: false }`, never a `401`.** The
request authenticated fine; the *answer* is no. `verifyCustomerSession` therefore does not throw for
it, and the verdict is a discriminated union so `customer` is only reachable once `valid` is true.
The field is `token`, not `session_token`, and `website` is required — sending `{ session_token }`
answers a `400` with three pointers at once.

**Cache the verdict until `expires_at`**, which is why that field is returned. The route is throttled
per key at 300 requests a minute, and an application that verifies on every request it serves will
reach the limit.

`getCustomer` and `listCustomers` need `?website=`, and the type makes forgetting it a compile error
— because omitting it is a `404` rather than a `400`, so a forgotten parameter looks exactly like
*no such endpoint*. There is no `email` filter and no search on the listing.

## Tenancy — the routes that act for a person

Every method here takes the session token as its **first argument** and sends it as
`X-Session-Token`; the `ask_` key rides on the same call in `Authorization`. They are checked in that
order, so a session with no key is a `401` — the failure every first integration hits.

```ts
const me = await auth.getMe(sessionToken);
if (!me.active_organization) await auth.switchOrganization(sessionToken, { organization_id });
const websites = await auth.listWebsites(sessionToken);
```

**Most website routes read the session's *active* organization** rather than taking one in a path —
`createWebsite` has no organization field anywhere. Miss `switchOrganization` and every website route
answers `422 no_active_organization`, which is why that code exists.

The ordering trap of the whole section: a redirect URL must be on a **verified** domain, and a CORS
origin *is* a verified domain. So the order is `addDomain` → publish the TXT record → `verifyDomain`
→ and only then will `updateLoginSettings` accept a redirect URL, or a browser on that origin reach
the browser tier at all. `verifyDomain` **does not verify anything by itself**: it reads a record you
must publish first, and calling it too early answers `200` with `status` still `pending`.

```ts
import { derivedIdempotencyKey } from "@lazslov/api-core";

const minted = await auth.mintWebsiteKey(
  sessionToken,
  websiteId,
  derivedIdempotencyKey(`rotate-${websiteId}`, 1),
);
await store(minted.key); // it appears in this response and never again
```

`mintWebsiteKey` is the one call here whose idempotency key is a **required argument** rather than an
option: the plaintext is unrecoverable, so a dropped connection without a reservation leaves you
minting a *second* live credential that has already shipped inside a page. Derive the key from the
operation, never from the clock. The SDK mints no key of its own, anywhere.

`createOrganization`, `createWebsite` and `createInvitation` accept an optional `idempotencyKey`.
`listWebsiteKeys` lists revoked keys too, because a listing that hides them is how a rotation gets
performed twice. Invitation roles are `owner` or `member` — **there is no `admin`**, and it is the
value people guess first.

## Errors

Every failure is `application/problem+json` under `urn:auth-service:problem:<slug>` over the estate's
closed slug set. **Branch on `type` and `code`, never on `title` or `detail`** — `title` comes from a
status→string map, so a `422` whose type is `conflict` reads "Unprocessable Entity". Nothing in this
package reads either.

```ts
import { AuthApiError } from "@lazslov/auth";

try {
  await auth.exchangeMagicLink(body);
} catch (error) {
  if (!(error instanceof AuthApiError)) throw error;
  if (error.code === "token_invalid") return keepPolling(); // here it means "not approved yet"
  if (error.code === "token_consumed") return alreadySignedIn();
  throw error;
}
```

`error.code` is narrowed to the thirty values the service documents; a code it does not document came
from a proxy and is dropped rather than widened. A few rows are worth knowing before you meet them:

| Situation | What to do |
| --- | --- |
| **Every `401`** | Byte-identical, and it carries **no `code`**. Do not try to tell an unknown key from a revoked one, an expired session or a deactivated user. |
| `token_invalid` | **Two meanings.** On the exchange it is *nobody has approved it yet* — keep polling. On a callback it is *a bad link*. Branch on the route. |
| `token_expired` · `token_consumed` | Three token codes, three different user-facing messages. Collapsing them is what produces support tickets. |
| `invitation_consumed` · `_revoked` · `_expired` | The same, for invitations. A single "invalid invitation" wastes the one piece of information the person needs. |
| `409 idempotency_in_flight` | The **only** retryable `409`. Pause, then send the same key. |
| Any `422` | **Not retryable**, unlike core's default — every documented `422` code needs a different request or a configuration change. |
| `502 provider_unavailable` | Retryable **once**, then surface it. On a magic-link request the address budget is already spent. |
| `domain_taken` vs `domain_not_verified` | Different remedies: choose another domain, or wait and re-verify. |

### A `404` has four documented meanings

Only one of them is *does not exist*. The others are: the resource belongs to another tenant, the
organization is not this key's own, a customer call omitted its required `website`, and a login handle
minted on one website was polled with another website's key. Each is a `404` deliberately, because a
`403` or a `400` would confirm that an id exists.

So **no method here maps a `404` to `null`.** Mapping it would turn *you configured the wrong tenant*
into *this does not exist yet*, which is the harder bug to find — and the error's message names all
four readings and both key variables.

## Webhooks

**auth-service is a pure emitter.** It receives no events and `/v1/hooks/*` is sealed with a `404`,
so there is nothing to send it and nothing in this package that would.

```ts
export const runtime = "nodejs"; // an edge runtime may transform the body

export async function POST(request: Request) {
  const rawBody = await request.text(); // BEFORE any parsing
  const verdict = await verifyAuthWebhook({
    secret: process.env.AUTH_SERVICE_WEBHOOK_SECRET!,
    rawBody,
    headers: request.headers,
  });
  if (!verdict.ok) return new Response(verdict.reason, { status: 401 });

  const eventId = request.headers.get("x-event-id")!;
  if (await alreadyProcessed(eventId)) return new Response(null, { status: 200 });

  const event = parseAuthWebhookEvent(rawBody);
  if (!event) return new Response("malformed", { status: 400 });

  if (isSubscriptionEvent(event)) await enqueue(event.data.subscription);
  await markProcessed(eventId);
  return new Response(null, { status: 200 });
}
```

- Verification and parsing are two functions, so a handler cannot parse before it verifies.
- The whole `whsec_…` string is the key — the prefix is key material, not a label to strip.
- **Dedupe on `X-Event-Id`**, which is stable across every retry *and* every operator redelivery;
  `X-Delivery-Id` is per attempt and would let one event through up to eight times. The store must
  outlive your restart: the ladder spans about 3.5 days.
- **Answer `2xx` within 5 seconds** and do the real work asynchronously. Eight failed attempts
  dead-letter the delivery, and five consecutive failures disable your endpoint — which then has
  **no backlog**, so nothing arrives later to say what you missed.
- **Ignore an event type you do not recognise and still answer `2xx`.** `isKnownEvent`,
  `isSubscriptionEvent`, `isCustomerEvent` and `isPingEvent` are the guards; a new type is additive.
- **Raise your own alarm when you reject a delivery.** A `2xx` tells the service you answered, never
  that you verified — a delivery a receiver refused is still recorded as delivered.

Six event types: `customer.created`, `membership.created`, `membership.revoked`,
`subscription.activated`, `subscription.canceled` and `subscription.expired` — plus `webhook.ping`
from an operator's test, which is signed exactly like a real delivery and is therefore a live test of
your verification. `customer.created` carries **no status in its type**: read `data.customer.status`
rather than assuming it. `data.customer.email` is present only on an endpoint whose operator enabled
it, and its absence is not a customer without an address.

`tenant.kind` is always `"organization"` from this service. `account_id` can be `null` — a tenant
provisioned a minute ago, not an error. `correlation_id` equals `event_id` and `causation_id` is
`null` on everything this service emits, because nothing here reacts to another service's event.

**Ordering is not guaranteed.** Reconcile against `occurred_at` and the block's own `status`, never
against arrival order — and keep a reconciliation poll, because the retry ladder is a floor and a
disabled endpoint receives nothing at all.

## `@lazslov/auth/next` — the route handler, written for you

```ts
// app/api/webhooks/auth/route.ts
export const runtime = "nodejs"; // an edge runtime may transform the body, which breaks the HMAC

import { isSubscriptionEvent } from "@lazslov/auth";
import { createAuthWebhookHandler } from "@lazslov/auth/next";

export const POST = createAuthWebhookHandler({
  alreadyProcessed: (id) => db.webhookEvents.exists(id),
  markProcessed: (id) => db.webhookEvents.insert(id),
  onEvent: async (event) => {
    if (!isSubscriptionEvent(event)) return; // a ping, or a type added after this SDK shipped
    await queue.push({ type: event.event_type, subscription: event.data.subscription.public_id });
  },
});
```

**`alreadyProcessed` and `markProcessed` are required parameters.** Delivery is at-least-once, the
dedupe is not optional, and the SDK owns no storage — so the most it can do is make forgetting them a
compile error. Back them with a unique constraint in your own database, not an in-memory set, which
is empty again on the next cold start.

| Answer | When |
| --- | --- |
| `401` | verification failed — the body names the edge runtime, which is the cause far more often than a wrong secret |
| `400` | verified, but the body is not an event |
| `200` `duplicate` | already processed. `onEvent` is **not** called — a duplicate is a success |
| `200` `accepted` | enqueued and marked — including for a `webhook.ping` and for a type this SDK does not know |
| `500` | `onEvent` threw. `markProcessed` is **not** reached, so the sender retries |

`onEvent` runs only after the dedupe passes, and `markProcessed` only after `onEvent` resolves — a
crash in between yields a redelivery, which is the safe direction. Outside production the handler
warns once if `onEvent` takes over 3 seconds. When `X-Event-Id` is absent the payload's own
`event_id` is used; it is the same value, because the payload is frozen at emission.

This subpath imports **nothing** from `next`: the handler takes a `Request` and answers a `Response`,
so it runs unchanged in any Web-standard runtime, and this package declares no peer dependency. An
unset `AUTH_SERVICE_WEBHOOK_SECRET` answers `500` on delivery rather than throwing at import.

## What is not here

The operator tier (`aad_`), the provider callbacks a browser navigates to (`/v1/providers/*`), the
scheduler (`/api/cron/*`), the sealed inbound namespace (`/v1/hooks/*`) and `/healthz` — none of them
is a consumer's to call. Also absent because the service has none: passwords, MFA, passkeys, SAML,
SCIM, a lookup of a customer by email address alone, any way to mint a session, bulk endpoints, money
of any kind, and a `total` on any list.

## Licence

MIT.
