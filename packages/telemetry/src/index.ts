/**
 * @lamido/telemetry — the estate's shared logging, shipping and alerting layer.
 *
 * Implements the observability house rules (`standards/observability-house-rules.md`,
 * OB-1…OB-15): one canonical log envelope on stdout, an additive batched sink, alerts
 * raised at the point of decision and posted to Telegram, and the request middleware
 * that binds `request_id` and emits the `http.request` summary line.
 *
 * DELIBERATELY A SINGLE FILE WITH ZERO IMPORTS. OB-7 lets a service vendor this SDK as
 * one file when it cannot take the npm dependency, held byte-identical by a pin test.
 * One import-free source file is what makes that copy possible to check.
 */

// ─── The envelope (OB-2) ───────────────────────────────────────────────────────────

/** Log severities, ordered. */
export type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured fields attached to a log line. */
export type LogMeta = Record<string, unknown>;

/** A logger, optionally carrying bindings that every line it writes inherits. */
export type Logger = {
  debug: (message: string, meta?: LogMeta) => void;
  info: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  error: (message: string, meta?: LogMeta) => void;
  /** A logger that adds `bindings` to every line, on top of any it already carries. */
  child: (bindings: LogMeta) => Logger;
};

/** The `env` envelope member. Comes from the platform environment, never guessed. */
export type TelemetryEnv = "production" | "preview" | "development";

/** Alert severities (OB-12). `critical` pages harder than `warning`; there is no third level. */
export type AlertSeverity = "warning" | "critical";

/** What a service passes once, at module scope, to build its telemetry. */
export interface TelemetryConfig {
  /** The service slug, e.g. `payment-service`. Constant per deployment; also the sink label. */
  service: string;
  /** The platform environment. Resolve it from `VERCEL_ENV`/`NODE_ENV`, never guess. */
  env: TelemetryEnv;
  /**
   * Supplier of the active log level. Must never throw — wrap a validated env read in a
   * try/catch that degrades to `"info"`. Defaults to reading `process.env.LOG_LEVEL`.
   */
  level?: () => Level;
}

/**
 * Emit-time deny-list (OB-6 item 4). Any metadata key matching this pattern is replaced
 * with `[redacted]` inside the logger, so no call site can leak a credential by naming it.
 */
const SENSITIVE_KEY = /key|secret|password|token|authorization|credential/i;

/**
 * `JSON.stringify` replacer that redacts sensitive keys at any depth. The root call has
 * an empty key and is never redacted. Two deliberate carve-outs from OB-6 item 4:
 *
 * - the literal member name `key` — OB-13 requires every alert to carry a stable rule
 *   `key` and the vendor layer groups by it, so redacting it would break alerting;
 * - numbers and booleans — a count or a flag is never a credential, and the OB-15
 *   heartbeat must carry `failing_credentials: 0` for the vendor layer to threshold.
 */
function redactingReplacer(key: string, value: unknown): unknown {
  if (key === "" || key === "key" || !SENSITIVE_KEY.test(key)) return value;
  return typeof value === "number" || typeof value === "boolean" ? value : "[redacted]";
}

/** The error's name, never its message — runtimes put URLs and secrets into messages (OB-6 item 6). */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}

function defaultLevel(): Level {
  const raw = process.env.LOG_LEVEL;
  return raw === "debug" || raw === "info" || raw === "warn" || raw === "error" ? raw : "info";
}

// ─── The sink (OB-8…OB-11) ─────────────────────────────────────────────────────────

/** How long one flush may take before its batch is dropped (OB-9). */
const FLUSH_TIMEOUT_MS = 3000;

/** In-memory batch cap; oldest lines are dropped first past it (OB-9). */
const BATCH_CAP_BYTES = 512 * 1024;

/** How long one Telegram post may take (OB-14). */
const ALERT_TIMEOUT_MS = 5000;

/**
 * A vendor sink, resolved from `process.env` at call time — never from a validated env
 * block, so a bad value can only cost the copy, never the service (OB-8).
 */
type SinkConfig =
  | { adapter: "none" }
  | { adapter: "loki"; url: string; user: string; token: string };

/** One buffered stdout line, waiting for the next flush. `debug` never enters (OB-11). */
type BufferedLine = { level: Exclude<Level, "debug">; timeMs: number; line: string };

/**
 * The sink adapter surface (OB-7). One adapter per vendor; `loki` ships first and `none`
 * is the default. Swapping the vendor is a new implementation of this and nothing else.
 */
export interface SinkAdapter {
  push(lines: BufferedLine[]): Promise<void>;
}

// ─── The request middleware (OB-3, HR-20) ──────────────────────────────────────────

/** Header carrying the request id, in and out (HR-20). */
export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * What we are willing to echo back and write into logs. An inbound id is
 * attacker-controlled text that ends up in a log aggregator and a response header, so it
 * is bounded and restricted to characters that cannot forge a log line or split a header.
 */
export const SANE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The slice of a Hono-shaped request context the middleware needs. Structural, so this
 * file imports nothing; a service adapts its typed context with one cast.
 */
export interface TelemetryRequestContext {
  req: {
    method: string;
    path: string;
    /** The matched route template, e.g. `/v1/payments/:id`. Set after routing. */
    routePath?: string;
    header(name: string): string | undefined;
  };
  res: { status: number };
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  header(name: string, value: string): void;
}

/** `await next()` in the host framework. */
export type TelemetryNext = () => Promise<void>;

/** The middleware shape {@link Telemetry.requestMiddleware} returns. */
export type TelemetryMiddleware = (
  c: TelemetryRequestContext,
  next: TelemetryNext,
) => Promise<void>;

/** Service-supplied hooks for the request middleware. */
export interface RequestMiddlewareOptions {
  /** Mints a fresh request id when the inbound one is absent or insane. Default: UUIDv4. */
  mintId?: () => string;
  /** Reads the credential tier (`"merchant"`, `"admin"`) from the context after the handler ran. */
  tier?: (c: TelemetryRequestContext) => string | undefined;
  /**
   * Schedules the post-response sink flush. On Vercel pass a `waitUntil`-backed runner;
   * the default runs the flush unawaited, which is correct anywhere the process lives on.
   */
  scheduleFlush?: (work: () => Promise<void>) => void;
}

/** `err.status` when it is a plausible HTTP status, else undefined. */
function statusOfError(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 100 && status <= 599 ? status : undefined;
}

// ─── The telemetry instance ────────────────────────────────────────────────────────

/** Everything a service wires once and uses everywhere. Built by {@link createTelemetry}. */
export interface Telemetry {
  /** Build a logger carrying fixed `bindings`, on top of the service envelope. */
  createLogger(bindings?: LogMeta): Logger;
  /** The unbound service logger, for module scope and background work. */
  logger: Logger;
  /**
   * Raise an operator alert at the point of decision (OB-12…OB-14). Logs a line with
   * `alert: true` first (the sink-side backstop), then posts to Telegram. Never throws;
   * a channel failure is one logged warning. Callers on a request path should detach the
   * returned promise; a cron may await it.
   */
  alert(severity: AlertSeverity, key: string, fields?: LogMeta): Promise<void>;
  /**
   * Ship the buffered lines to the sink once (OB-9). Fire-and-forget from the request
   * middleware; a cron or CLI awaits it before exit, because `waitUntil` is a no-op
   * off-platform. Never rejects; a failed flush drops the batch and logs one warning.
   */
  flush(): Promise<void>;
  /**
   * The request middleware (HR-20 + OB-3): accepts or mints the request id, binds
   * `request_id` onto the request logger under the `log` context key, echoes the header,
   * emits exactly one `http.request` summary line per request, and schedules the flush.
   */
  requestMiddleware(options?: RequestMiddlewareOptions): TelemetryMiddleware;
}

/**
 * Build the service's telemetry. Call once at module scope and re-export the pieces —
 * call sites keep using the `Logger` type and the `c.get('log')` convention unchanged.
 *
 * @example
 * ```ts
 * const telemetry = createTelemetry({ service: "payment-service", env: platformEnv() });
 * export const { logger } = telemetry;
 * ```
 */
export function createTelemetry(config: TelemetryConfig): Telemetry {
  const level = config.level ?? defaultLevel;
  const buffer: BufferedLine[] = [];
  let bufferedBytes = 0;
  let dropped = 0;
  /** Variables already warned about, so each is loud exactly once per boot (OB-8). */
  const warnedVars = new Set<string>();

  /**
   * Write one line. stdout is the record and is never conditional on the sink (OB-1);
   * the buffer copy is additive. `ship: false` marks the sink's own diagnostics, which
   * must not re-enter the buffer they report on.
   */
  function emit(bindings: LogMeta, lvl: Level, message: string, meta?: LogMeta, ship = true): void {
    if (order[lvl] < order[safeLevel()]) return;
    const timeMs = Date.now();
    // The envelope members are spread last so no call-site metadata can displace the
    // line's identity: `level`/`message` (the existing estate invariant) and the OB-2
    // `time`/`service`/`env` members always win. Call-site meta still wins over bindings.
    const line = JSON.stringify(
      {
        ...bindings,
        ...meta,
        time: new Date(timeMs).toISOString(),
        service: config.service,
        env: config.env,
        level: lvl,
        message,
      },
      redactingReplacer,
    );
    if (lvl === "error") console.error(line);
    else if (lvl === "warn") console.warn(line);
    else console.log(line);
    if (ship && lvl !== "debug") bufferLine({ level: lvl, timeMs, line });
  }

  /** Reading the level must never be the thing that crashes the service. */
  function safeLevel(): Level {
    try {
      return level();
    } catch {
      return "info";
    }
  }

  function bufferLine(entry: BufferedLine): void {
    buffer.push(entry);
    bufferedBytes += entry.line.length;
    // Bounded, oldest-first (OB-9). Byte counts are approximate (UTF-16 code units);
    // the cap guards memory, it is not an accounting surface.
    while (bufferedBytes > BATCH_CAP_BYTES && buffer.length > 1) {
      const oldest = buffer.shift();
      if (oldest) bufferedBytes -= oldest.line.length;
      dropped += 1;
    }
  }

  /** Warn once per boot per variable; unset is loud, never silent (OB-8). */
  function warnOnce(variable: string, message: string): void {
    if (warnedVars.has(variable)) return;
    warnedVars.add(variable);
    emit({}, "warn", message, { variable }, false);
  }

  /** Resolve the sink from `process.env` at call time, degrading loudly (OB-8). */
  function sinkConfig(): SinkConfig {
    const name = process.env.LOG_SINK?.trim();
    if (!name) {
      warnOnce("LOG_SINK", "LOG_SINK is unset; logs stay on stdout only");
      return { adapter: "none" };
    }
    if (name === "none") return { adapter: "none" };
    if (name !== "loki") {
      warnOnce("LOG_SINK", "LOG_SINK names an unknown adapter; logs stay on stdout only");
      return { adapter: "none" };
    }
    const url = process.env.LOG_SINK_URL?.trim();
    const token = process.env.LOG_SINK_TOKEN?.trim();
    if (!url) {
      warnOnce("LOG_SINK_URL", "LOG_SINK_URL is unset; logs stay on stdout only");
      return { adapter: "none" };
    }
    if (!token) {
      warnOnce("LOG_SINK_TOKEN", "LOG_SINK_TOKEN is unset; logs stay on stdout only");
      return { adapter: "none" };
    }
    return { adapter: "loki", url, user: process.env.LOG_SINK_USER?.trim() ?? "", token };
  }

  /**
   * The Grafana Loki push adapter. Indexes exactly `service`, `env` and `level` as
   * labels (OB-10); everything else stays in the line body and is queried by content.
   */
  function lokiAdapter(cfg: Extract<SinkConfig, { adapter: "loki" }>): SinkAdapter {
    return {
      async push(lines) {
        const byLevel = new Map<string, BufferedLine[]>();
        for (const entry of lines) {
          const group = byLevel.get(entry.level);
          if (group) group.push(entry);
          else byLevel.set(entry.level, [entry]);
        }
        const streams = [...byLevel.entries()].map(([lvl, entries]) => ({
          stream: { service: config.service, env: config.env, level: lvl },
          values: entries.map((e) => [`${e.timeMs}000000`, e.line]),
        }));
        const auth = cfg.user ? `Basic ${btoa(`${cfg.user}:${cfg.token}`)}` : `Bearer ${cfg.token}`;
        const response = await fetch(cfg.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: auth },
          body: JSON.stringify({ streams }),
          signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw Object.assign(new Error(`sink answered ${response.status}`), {
            name: `SinkHttp${response.status}`,
          });
        }
      },
    };
  }

  async function flush(): Promise<void> {
    const cfg = sinkConfig();
    const batch = buffer.splice(0);
    bufferedBytes = 0;
    const droppedNow = dropped;
    dropped = 0;
    if (cfg.adapter === "none" || batch.length === 0) return;
    if (droppedNow > 0) {
      // The final line records how many were dropped (OB-9), built through the normal
      // envelope so it is searchable like everything else.
      const timeMs = Date.now();
      batch.push({
        level: "warn",
        timeMs,
        line: JSON.stringify({
          event: "telemetry.lines_dropped",
          dropped: droppedNow,
          time: new Date(timeMs).toISOString(),
          service: config.service,
          env: config.env,
          level: "warn",
          message: "Log batch overflowed; oldest lines were dropped before shipping",
        }),
      });
    }
    try {
      await lokiAdapter(cfg).push(batch);
    } catch (err) {
      // Lossy by design: one stdout warning, error name only, no retry (OB-9, OB-6).
      emit(
        {},
        "warn",
        "Log sink flush failed; batch dropped",
        { error: errorName(err), lines: batch.length },
        false,
      );
    }
  }

  function createLogger(bindings: LogMeta = {}): Logger {
    return {
      debug: (message, meta) => emit(bindings, "debug", message, meta),
      info: (message, meta) => emit(bindings, "info", message, meta),
      warn: (message, meta) => emit(bindings, "warn", message, meta),
      error: (message, meta) => emit(bindings, "error", message, meta),
      child: (extra) => createLogger({ ...bindings, ...extra }),
    };
  }

  async function alert(severity: AlertSeverity, key: string, fields: LogMeta = {}): Promise<void> {
    // The backstop first (OB-14): a line with `alert: true` ships whether or not the
    // Telegram post succeeds, so a vendor rule still fires when the channel is down.
    const lvl: Level = severity === "critical" ? "error" : "warn";
    emit({}, lvl, `Alert: ${key}`, {
      ...fields,
      event: "alert.raised",
      alert: true,
      severity,
      key,
    });

    const token = process.env.TELEGRAM_ALERT_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim();
    if (!token || !chatId) {
      // An unconfigured channel is loud on every alert, never silent (OB-14).
      emit({}, "warn", "Telegram alert channel is not configured; alert logged only", {
        key,
        variable: !token ? "TELEGRAM_ALERT_BOT_TOKEN" : "TELEGRAM_ALERT_CHAT_ID",
      });
      return;
    }
    const emoji = severity === "critical" ? "🚨" : "⚠️";
    const detail = Object.entries(JSON.parse(JSON.stringify(fields, redactingReplacer)) as LogMeta)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
    const text = `${emoji} ${config.service} ${severity}: ${key}${detail ? `\n${detail}` : ""}`;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      });
      if (!response.ok) {
        emit({}, "warn", "Telegram alert delivery failed", { key, status: response.status });
      }
    } catch (err) {
      // The bot token is part of the URL, so: error name only, never the message (OB-6).
      emit({}, "warn", "Telegram alert delivery failed", { key, error: errorName(err) });
    }
  }

  function requestMiddleware(options: RequestMiddlewareOptions = {}): TelemetryMiddleware {
    const mintId = options.mintId ?? (() => crypto.randomUUID());
    const scheduleFlush = options.scheduleFlush ?? ((work) => void work());
    return async (c, next) => {
      const inbound = c.req.header(REQUEST_ID_HEADER);
      const id = inbound && SANE_REQUEST_ID.test(inbound) ? inbound : mintId();
      c.set("requestId", id);
      const log = createLogger({ request_id: id });
      c.set("log", log);
      c.header(REQUEST_ID_HEADER, id);

      const started = Date.now();
      const finish = (status: number): void => {
        const tier = options.tier?.(c);
        log.info("Request handled", {
          event: "http.request",
          route: c.req.routePath ?? c.req.path,
          method: c.req.method,
          status,
          duration_ms: Date.now() - started,
          ...(tier ? { tier } : {}),
        });
        scheduleFlush(flush);
      };

      try {
        await next();
      } catch (err) {
        // The summary must exist on a 500 too; the framework's error handler answers
        // after this middleware unwinds, so the status is taken from the error itself.
        finish(statusOfError(err) ?? 500);
        throw err;
      }
      finish(c.res.status);
    };
  }

  return { createLogger, logger: createLogger(), alert, flush, requestMiddleware };
}
