---
"@lazslov/telemetry": minor
---

Bind `request_id` into an ambient request scope, so every line written inside a request
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
