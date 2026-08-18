# Proposal — an ambient request scope in `@lazslov/telemetry`

**Scope:** one additive change to `packages/telemetry`. It closes OB-2's *"every line written
inside a request carries `request_id`"* clause in **five services at once**, with no call site in
any of them changing.

**This file answers:** what is the defect? · why does it belong to the SDK rather than to each
service? · what is the proposed shape? · what does it cost, and what could it break?

> **STATUS: proposed. Nothing here is built.** It is written for a maintainer to accept, amend or
> refuse. Section 6 lists the three questions the author could not answer from this repository
> alone. Raised from `webshop-service`, which paid the audit that produced it.

---

## 1 · The defect

OB-2 asks that a line written while handling a request carries that request's `request_id`. The
package offers a service two ways to get a logger, and only one of them can obey:

| | Where it comes from | Carries `request_id` |
|---|---|:--:|
| The request logger | `c.get("log")`, bound by `requestMiddleware` | yes |
| The service logger | `telemetry.logger`, imported at module scope | no |

A handler reads the first, because it has the context in its hand. **A helper three files away
imports the second**, because it has no context to read — and taking one would change its
signature, and every signature above it, up to the route.

So the clause is obeyed exactly as far as the author was editing, and no further.

## 2 · Why this is the SDK's and not each service's

**Five services fail the clause and every one fails it the same way.** webshop-service, content,
booking, invoice and payment. The most recently audited column measured it precisely:
`request_id` reaches **2 of 29** module-logger call sites, and **24 of the 29 are reachable inside
a request**.

**auth-service is the only column that passes it, and it does not pass by threading harder.** It
binds `request_id` into an `AsyncLocalStorage` scope, so a helper that never saw the context still
writes the id.

> *A rule that four disciplined services obey partially, and that one obeys completely by changing
> the mechanism, is a rule about the mechanism.*

The alternative is five separate remediations. Each is roughly a day, changes about nine function
signatures, and **still does not close the clause**: work scheduled after the response — an inline
queue drain, a detached alert, the sink flush — runs where there is no context left to thread. In
the audited service that is 8 of the 24 sites. Threading cannot reach them at all; an ambient
scope reaches them for free, because it follows the promise rather than the call graph.

## 3 · The proposed shape

Everything below is inside `packages/telemetry/src/index.ts`. The package already owns both ends
of the scope: `requestMiddleware` is where a request begins, and `createLogger` is where every
line is written.

**One — enter the scope in the middleware.** It already mints the id and builds the request
logger; the only new thing is that `next()` runs inside a store.

```ts
const log = createLogger({ request_id: id });
c.set("log", log);
c.header(REQUEST_ID_HEADER, id);

// today:  await next();
// proposed:
await runInScope({ request_id: id }, () => next());
```

**Two — read the scope when a line is written.** `createLogger` closes over its bindings and
passes them to `emit`. The ambient store goes underneath them, so an explicit binding always wins:

```ts
function createLogger(bindings: LogMeta = {}): Logger {
  const merged = () => ({ ...currentScope(), ...bindings });
  return {
    debug: (message, meta) => emit(merged(), "debug", message, meta),
    // …the other three, and `child`, unchanged in shape
  };
}
```

Read at **write** time, never at construction time: `telemetry.logger` is built once at module
scope, long before any request exists.

**Three — absent is not an error.** `currentScope()` answers `{}` outside a request, so a CLI, a
cron and a drain write exactly the line they write today.

### What it gives each service

```ts
// A helper with no context, three files from the route. Unchanged.
import { logger } from "./logger.js";
logger.warn("last_used_at refresh failed", { error });
// → today:    { level: "warn", service, env, … }
// → proposed: { level: "warn", service, env, request_id: "…", … }
```

No service changes a call site, a signature or an import. A service adopts this by bumping the
package.

### `correlated()` gets the same benefit

`correlated(id)` currently defaults `from` to the service logger, and its own doc-comment tells a
caller to pass `c.get("log")` *"so `request_id` survives too"*. That instruction is the OB-2
defect in miniature: on a path that holds a chain id but no context — a queue handler emitting an
event, a delivery worker — there is nothing to pass, so the line carries the chain and no request.
With the scope, `correlated(id)` carries both wherever both exist, and the `from` parameter stays
for the cases that want an explicit parent.

**This is the second cell the change closes.** OB-4 is currently blocked behind OB-2 in at least
one service for exactly this reason: binding a chain id onto a logger nothing threads reproduces
the same defect one field over.

## 4 · Cost and risk

| | |
|---|---|
| **Semver** | **minor.** Nothing is removed, renamed, or made required, and no signature changes. It is the *"a response type gaining a field"* row of [CONTRIBUTING](../../CONTRIBUTING.md#what-counts-as-a-breaking-change), one layer over |
| **Runtime dependencies** | none. `AsyncLocalStorage` is a platform API, like `fetch` and `crypto.subtle` |
| **Surface added** | none required. The scope can be entirely internal — see question 2 |

**The one real risk: a line gains a field.** A service whose test asserts a log line by exact
equality rather than by `toMatchObject` will see it fail on a `request_id` that was not there
before. That is a green-to-red in a consumer's suite on a `pnpm update`, so it belongs in the
changelog entry as a named migration note even though the semver table calls it minor.

**The one real unknown: runtimes without `node:async_hooks`.** Node 20.19+ has it; the Vercel Edge
Runtime and workerd do not have it unconditionally. The package declares `>=20.19` and is consumed
by services rather than by client sites, so this may be moot — but the safe shape is a guarded
load, where a runtime without the module gets a no-op scope and therefore exactly today's
behaviour, rather than a throw at import time.

## 5 · What this does not do

- It does not touch the four consumer packages. Telemetry depends on none of them and they do not
  depend on it.
- It does not make `request_id` mandatory anywhere, and it does not fail when there is no request.
- It does not replace `c.get("log")`. A handler that has the context should keep using it: the
  scope is for the code that cannot.
- It does not remove any service's obligation under OB-2. It makes the obligation satisfiable.

## 6 · Questions the author could not answer from this repository

1. **Is the Edge Runtime a supported target for `@lazslov/telemetry`?** If it is not, the guarded
   load in §4 is unnecessary and a direct `node:async_hooks` import is simpler and clearer.
2. **Should the scope be public API?** The change needs no new export. But a service with
   background work that *starts* outside a request — a cron worker that then handles a batch —
   might reasonably want to open a scope of its own, which would mean exporting a `withScope`.
   Deliberately left out of this proposal: it is a second decision, and it can be added later
   without breaking the first.
3. **Should the ambient store carry more than `request_id`?** `correlation_id` is the obvious
   second member and §3 already gets it for free through `correlated()`. Making the store a
   general `LogMeta` bag invites call sites to push arbitrary context into it, which is a
   different and much larger feature. This proposal keeps the store to what the middleware knows.
