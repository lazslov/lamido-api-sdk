# @lamido/telemetry

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
  the request logger, emits one `http.request` summary line per request, and schedules
  the sink flush off the response path.

## Usage

```ts
import { createTelemetry } from "@lamido/telemetry";

const telemetry = createTelemetry({ service: "payment-service", env: "production" });
export const { logger, alert, flush } = telemetry;
export const createLogger = telemetry.createLogger;
```

## Vendoring

The whole SDK is deliberately a single import-free file (`src/index.ts`). A service that
cannot take the npm dependency may vendor that file verbatim, per OB-7 — **if** a test
pins the copy byte-identical against this source. Drift without a failing test is the
one outcome that rule exists to prevent.
