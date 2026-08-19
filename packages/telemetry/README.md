# @lazslov/telemetry

Estate telemetry for the Lamido services. One shared implementation of the
[observability house rules](https://github.com/lazslov/knowledge-base) (OB-1…OB-15):

- **The envelope** — structured JSON to stdout, one object per line. Every line carries
  `time`, `service`, `env`, `level`, `message`; `level` and `message` always win over
  call-site metadata. A deny-list redacts sensitive keys at emit time.
- **The sink** — an additive, batched, fire-and-forget copy of the stdout stream.
  stdout is the record; the sink is lossy by design. Configured from `LOG_SINK`,
  `LOG_SINK_URL`, `LOG_SINK_USER`, `LOG_SINK_TOKEN`, read at call time so a bad value
  can never break the service. The first adapter is Grafana Loki; labels are exactly
  `service`, `env`, `level`.
- **Alerts** — `alert(severity, key, fields)` posts to Telegram
  (`TELEGRAM_ALERT_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`) and always also logs a line
  with `alert: true` as the sink-side backstop. Never throws.
- **Request middleware** — accepts or mints the `X-Request-Id`, binds `request_id` onto
  the request logger, runs the handler inside an ambient scope so every line written during
  the request carries the id, emits one `http.request` summary line per request, and
  schedules the sink flush off the response path.

## Usage

```ts
import { createTelemetry } from "@lazslov/telemetry";

const telemetry = createTelemetry({ service: "payment-service", env: "production" });
export const { logger, alert, flush } = telemetry;
export const createLogger = telemetry.createLogger;
```

## The request scope (OB-2)

`requestMiddleware` runs the handler inside an ambient scope carrying `request_id`, so **every**
line written while a request is in flight carries it — including lines written through the
module-scope `logger` by a helper that never saw the request context:

```ts
// A helper three files from the route. No context, no signature change.
import { logger } from "./logger.js";

logger.warn("last_used_at refresh failed", { error: err.name });
// → { level: "warn", service, env, request_id: "…", … }
```

Three things to know:

- **Outside a request there is no id**, and no error either. A cron, a CLI and a queue drain
  write exactly the line they write without the middleware.
- **An explicit binding wins.** A logger built with `createLogger({ request_id })` keeps its own
  value; the scope only fills in what nothing else set.
- `c.get("log")` **is still correct** and still the right thing to use where the context is in
  hand. The scope is for the code that cannot reach it.

### If your service wraps the logger, pass `createLogger`

**Required whenever `lib/logger.ts` wraps the logger**, which is every service enforcing OB-6
item 2 — the container strip that replaces `body`, `values`, `variables` and `payload`
wholesale, and which this package does not carry:

```ts
export const createLogger = (b?: LogMeta): Logger => guarded(telemetry.createLogger(b));

// Without the hook the middleware builds the request logger from this package's own
// factory, and `guarded` never runs on a single request-scoped line.
export const requestId = telemetry.requestMiddleware({ createLogger });
```

The logger the hook returns is used for the `log` context key **and** for the `http.request`
summary line, so one argument covers both. `telemetry.logger` is a different seam: wrap that
one in your own file and export the wrapped value.

*The scope and the strip were mutually exclusive until this option existed, and four of the
five services on this package chose the strip — so the scope reached nobody.*

## Vendoring

The whole SDK is deliberately a single self-contained file (`src/index.ts`) with no static
imports. A service that cannot take the npm dependency may vendor that file verbatim, per
OB-7 — **if** a test pins the copy byte-identical against this source. Drift without a
failing test is the one outcome that rule exists to prevent.

The one dynamic import is `node:async_hooks`, behind the request scope. It is guarded,
so a runtime without the module gets a no-op scope rather than a throw, and the file still
vendors as one file.
