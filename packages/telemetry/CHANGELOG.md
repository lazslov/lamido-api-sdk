# @lazslov/telemetry

## 1.1.3

Verified against knowledge base `714f2ee`: content-service `0048426`, invoice-service `706dc63`,
payment-service `e3828d2`, auth-service `bbeb4d4`, booking-service `18846e1`,
email-service `23051b9`, webshop-service `529003d`. The pins move for the four new service packages
beside this one; nothing in this package reads a contract.

### Patch Changes

- Re-pin the contracts at knowledge base `714f2ee`, so the changelog inside each tarball names the
  commits these packages were verified against — now including the four services that gained a
  package in this release: auth-service, booking-service, email-service and webshop-service.

  No public surface moves in the five packages that already existed. Every operation and schema
  that changed upstream is outside what this SDK ships, and the regenerated types say so: two new
  admin routes (`POST /v1/admin/integrations/test` and
  `POST /v1/admin/invoices/{public_id}/revoke-download-links`), a `stats:read` admin scope,
  `signing_state` on an admin health body, and `publicly_enumerable` on a dataset **field
  descriptor** — which is dataset structure, written by staff, and referenced nowhere in
  `@lazslov/content`.

## 1.1.2

Verified against knowledge base `9b8228c`: content-service `eb0b88d`, invoice-service `7fdc5ec`,
payment-service `2cd0a4e`. The contract pins do not move in this release — it changes the logger
and no generated type.

### Patch Changes

- The emit-time deny-list carries all four of OB-6 item 2's container names: `values`,
  `variables` and `payload` join `body`.

  `1.1.0` added `body` alone, and one of four names is not the rule. The other three are the
  reason four of the five services on this package wrap the logger — the strip lives in the
  wrapper, because it did not live here — and a wrapper is bypassed the moment its service
  adopts `requestMiddleware` without passing `createLogger`. That made the strip and OB-2's
  ambient `request_id` two rules in one standard pulling one edit in opposite directions.
  Carrying item 2 here retires the wrappers and the trap together.

  **What a consumer sees.** Any metadata member named `values`, `variables` or `payload`, at
  any depth, now reads `[redacted]` in the line and in an alert's fields. A number or a boolean
  under one of those names survives, exactly as it does under `body` since `1.1.0`: `values: 3`
  is a count of them, not a body. A service that logs a container it means to keep renames the
  member — narrowing the pattern is how a deny-list stops denying.

  **The test to copy, not the assertion.** `packages/telemetry/test/telemetry.test.ts` names
  every planted inner member `card`. The obvious plant is a credential-shaped inner name, and it
  makes three of these four _pass against the unfixed code_: item 4's pattern eats
  `values: { token_value: … }` and `payload: { secret_thing: … }` while the container they sit in
  stays whole. That reads as an item-2 pass and is not one. Item 2 is asserted on the container.

## 1.1.1

Verified against knowledge base `9b8228c`: content-service `eb0b88d`, invoice-service `7fdc5ec`,
payment-service `2cd0a4e`.

### Patch Changes

- Re-pin the contracts at knowledge base `9b8228c`, so the changelog inside the tarball names the
  commits these packages were verified against.

  No public surface moves in these three. The one shape that changed is payment-service's
  `DrainSummary`, which renamed `deadLettered` to `dead_lettered` at the service's `95c66a3`: it is
  the `/api/cron/webhooks` drain report, and this SDK has never exposed it.

## 1.1.0

Verified against knowledge base `5191225`: content-service `ecf20fd`, invoice-service `3aa099f`,
payment-service `62a1799`.

### Minor Changes

- 86bf208: `requestMiddleware` builds its request logger through a service-supplied factory, so the
  ambient `request_id` scope and a service's own logger wrapper can both be had (OB-2 with
  OB-6 item 2).

  `RequestMiddlewareOptions` gains `createLogger?: (bindings: LogMeta) => Logger`, defaulted
  to the instance's own `createLogger`. Nothing is removed, no signature changes, and a
  consumer that passes no hook gets exactly today's behaviour.

  **Why this is needed before the ambient scope ships, not after.** The scope is entered only
  inside `requestMiddleware`, and that middleware built the request logger from this package's
  own factory — so a service whose `lib/logger.ts` wraps the logger had that wrapper bypassed
  on every request-scoped line the moment it adopted the middleware. **Four of the five
  services on this package wrap it**, because OB-6 item 2's container strip lives in exactly
  that wrapper and this package does not carry the strip. So adopting the middleware meant
  choosing between two rules in the same standard, and every one of the four chose the strip.

  That is the whole reason the scope reached nobody. `1.0.0` shipped before the scope existed,
  so no service could have adopted it yet — which makes this the one moment the design costs
  nothing to correct. **A feature that lands unreleased is the only kind that can be fixed for
  free**; every comparable finding in this estate arrived after a service had already paid for
  it.

  **What a consumer does.** One argument, at the single seam it already has:

  ```ts
  // src/lib/logger.ts — the service's only importer of this package
  const telemetry = createTelemetry({
    service: SERVICE_NAME,
    env: platformEnv(),
  });

  export const createLogger = (b?: LogMeta): Logger =>
    guarded(telemetry.createLogger(b));

  // The request logger and the OB-3 summary line now both go through `guarded`.
  export const requestId = telemetry.requestMiddleware({ createLogger });
  ```

  The returned logger is used for the `log` context key **and** for the `http.request` summary
  line, so one hook covers both. `telemetry.logger` is untouched: a service that wraps the
  module logger keeps doing that in its own file, which is a different seam.

  **Why a factory hook rather than exporting `runInScope`.** Exposing the scope directly would
  also let a hand-rolled middleware have both, and it would leave the _supported_ path —
  `requestMiddleware` — still discarding every service's strip. A default that violates a rule
  is a default that will be used by whoever reads the README next. This way the conformant
  path is the easy one.

  Raised from email-service's observability re-measure, which found the conflict while scoring
  OB-2 after adopting this package.

- 3917034: Bind `request_id` into an ambient request scope, so every line written inside a request
  carries it (OB-2).

  `requestMiddleware` now runs the handler inside an `AsyncLocalStorage` scope holding the
  request id, and every line reads that scope as it is written. Nothing is removed, no
  signature changes, and no service changes a call site: a service adopts this by bumping
  the package.

  **Why it belongs here and not in each service.** OB-2 asks that a line written while
  handling a request carries that request's `request_id`. The package offered two ways to get
  a logger and only one could obey: a handler reads `c.get("log")`, which is bound, while a
  helper three files away imports `telemetry.logger`, which was not — because it has no
  context to read, and taking one would change its signature and every signature above it up
  to the route. Five services failed the clause and every one failed it the same way; the most
  recently audited column measured `request_id` reaching 2 of 29 module-logger call sites with
  24 of the 29 reachable inside a request. The one service that passed did not pass by
  threading harder — it bound the id into a scope. A rule four disciplined services obey
  partially, and one obeys completely by changing the mechanism, is a rule about the mechanism.

  Threading could not have closed it anyway. Work scheduled after the response — an inline
  queue drain, a detached alert, the sink flush — runs where there is no context left to pass;
  in the audited service that was 8 of the 24 sites. The scope follows the promise rather than
  the call graph, so it reaches them.

  **What a consumer sees.** A module-scope logger, `telemetry.correlated(id)` with no parent
  passed, and `telemetry.alert(...)` all gain `request_id` when they run inside a request:

  ```ts
  // A helper with no context, three files from the route. Unchanged.
  import { logger } from "./logger.js";
  logger.warn("last_used_at refresh failed", { error: err.name });
  // → before: { level: "warn", service, env, … }
  // → after:  { level: "warn", service, env, request_id: "…", … }
  ```

  `correlated(id)` no longer needs `c.get("log")` passed to keep the request id, which is what
  unblocks it on the paths that hold a chain id and no context: an event emitter, a delivery
  worker. Its `from` parameter stays, for the cases that want an explicit parent.

  **Migration — one thing can turn a consumer's suite red.** A log line gains a field. A test
  that asserts a line by exact equality rather than by `toMatchObject` will fail on a
  `request_id` that was not there before. The fix is to loosen the assertion, or to assert the
  id it now expects. Nothing else changes: outside a request the scope is empty, so a cron, a
  CLI and a queue drain write exactly the line they write today, and a logger given
  `request_id` explicitly keeps its own value — the scope only fills in what nothing else set.

  **Runtimes without `node:async_hooks`.** The module is loaded with a guarded dynamic import
  rather than a static one, so the Vercel Edge Runtime and workerd — which do not carry it
  unconditionally — get a no-op scope instead of a throw at import time, and therefore exactly
  today's behaviour. No runtime dependency is added; `AsyncLocalStorage` is a platform API like
  `fetch` and `crypto.subtle`. The file keeps its zero static imports, so it still vendors as
  one file under OB-7.

  Raised from webshop-service, whose observability audit produced the measurements.

### Patch Changes

- 1c5f6b0: Deny `body` at emit time (OB-6 item 4).

  The pattern now matches `body`, so a metadata member named `body` — or one ending in
  `_body_excerpt` — is replaced with `[redacted]` like every other credential-shaped name.

  Found while invoice-service adopted the standard. Its service-local deny-list carried
  `body` before this package existed, and that list is where OB-6 item 4 came from: the
  route `PUT /v1/admin/clients/:id/integrations` takes a plaintext provider secret in its
  body, so one `log.info('upsert', { body })` would put a provider credential on stdout.
  The name was lost when the mechanism moved here, which is the direction a consolidation
  must not go — a shared implementation that redacts less than the service it replaced is a
  regression every service inherits at once.

  OB-6 item 2 already bans bodies outright. This is the emit-time net under that rule, for
  the same reason the rest of the list exists: a rule that has to be re-obeyed at every call
  site eventually is not.

## 1.0.0

Verified against knowledge base `5191225`: content-service `ecf20fd`, invoice-service `3aa099f`,
payment-service `62a1799`.

**First published release, at `1.0.0` rather than in `0.x`.** A caret range does not cross a minor
below `1.0.0`, so `^0.2.0` refuses `0.3.0`: every rule this package gains would cost each service a
bump of its own. This package exists so one log envelope is shared across the estate, and drift
between services is the failure it prevents — a range that lets minors arrive on their own serves
that better than the caution `0.x` signals.

**Renamed from `@lamido/telemetry` before its first publish.** The repository had already settled
on the `@lazslov` user scope for every package — `@lamido` on npm resolves to an account that may
not be ours, and a user scope needs no organisation, no membership and no paid plan. This package
was added afterwards and did not follow it. `Lamido` stays where it names the **project**: the
repository, `LAMIDO_KB_PATH`, and the services. Nothing depended on the old name, and nothing was
published under it.

### Major Changes

- Implement OB-4 and OB-5, the two envelope rules the package shipped without.

  The observability house rules were merged as OB-1…OB-20 after this package was written against a
  draft. The numbering matches; two rules inside its own scope were not covered.

  - **OB-4 — `correlation_id`.** `telemetry.correlated(id, from?)` binds the id onto a logger so
    every line it writes carries it. Deliberately not part of `requestMiddleware`: a correlation id
    arrives in the **event envelope body**, not a header, so a webhook receiver only has it after
    parsing and no middleware can bind it for them. It is what turns "a payment succeeded, an
    invoice was issued, an email was sent" into one query.
  - **OB-5 — the flag vocabulary.** `LogMeta` now names the seven closed, estate-wide boolean flags
    — `alert`, `anomaly`, `security`, `unmapped`, `external_refund`, `recovered`, `fail_open` — so a
    typo in one is a compile error. `correlation_id` is typed too. The record stays open; only these
    members are named.

  OB-16…OB-20 are deliberately not implemented: they govern the vendor projection (Grafana rule
  files, probe topology) and the process for adopting a rule. Neither is an npm library's to carry.

  Nothing was removed, and no existing call site changes.

## 0.1.0

Initial release: the OB-1…OB-15 mechanics. The canonical log envelope (`time`, `service`,
`env`, `level`, `message`, emit-time redaction deny-list), the batched lossy sink with the
Grafana Loki adapter, `alert()` with the Telegram channel and the `alert: true` log
backstop, and the request middleware (`request_id` binding, `http.request` summary,
scheduled flush).
