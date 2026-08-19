---
"@lazslov/telemetry": minor
---

`requestMiddleware` builds its request logger through a service-supplied factory, so the
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
const telemetry = createTelemetry({ service: SERVICE_NAME, env: platformEnv() });

export const createLogger = (b?: LogMeta): Logger => guarded(telemetry.createLogger(b));

// The request logger and the OB-3 summary line now both go through `guarded`.
export const requestId = telemetry.requestMiddleware({ createLogger });
```

The returned logger is used for the `log` context key **and** for the `http.request` summary
line, so one hook covers both. `telemetry.logger` is untouched: a service that wraps the
module logger keeps doing that in its own file, which is a different seam.

**Why a factory hook rather than exporting `runInScope`.** Exposing the scope directly would
also let a hand-rolled middleware have both, and it would leave the *supported* path —
`requestMiddleware` — still discarding every service's strip. A default that violates a rule
is a default that will be used by whoever reads the README next. This way the conformant
path is the easy one.

Raised from email-service's observability re-measure, which found the conflict while scoring
OB-2 after adopting this package.
