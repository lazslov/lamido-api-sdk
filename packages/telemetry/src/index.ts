/**
 * @lazslov/telemetry — the estate's shared logging, shipping and alerting layer.
 *
 * Implements the observability house rules (`standards/observability-house-rules.md`,
 * OB-1…OB-15): one canonical log envelope on stdout, an additive batched sink, alerts
 * raised at the point of decision and posted to Telegram, the request middleware that
 * binds `request_id` and emits the `http.request` summary line, the `correlation_id`
 * binding that joins a causal chain across services, and the closed boolean flag
 * vocabulary alert rules key on.
 *
 * OB-16…OB-20 are deliberately absent: they govern the vendor projection — Grafana rule
 * files, probe topology — and the process around adopting a rule. Neither is an npm
 * library's to implement.
 *
 * DELIBERATELY A SINGLE FILE WITH NO STATIC IMPORTS. OB-7 lets a service vendor this
 * SDK as one file when it cannot take the npm dependency, held byte-identical by a pin
 * test. One self-contained source file is what makes that copy possible to check.
 *
 * The one exception is the guarded `import("node:async_hooks")` behind the ambient request
 * scope. It is dynamic, its failure is caught, and a runtime without the module gets a no-op
 * scope — so the file still loads anywhere, and a vendored copy is still one file.
 */

/**
 * The version of this package, as published.
 *
 * @remarks
 * Kept in step with `package.json` by a test, so a release cannot ship a constant that
 * disagrees with the tarball it came from. A vendored copy carries the version it was
 * taken from, which is what lets a service report which cut of this file it holds.
 */
export const VERSION = "1.1.2";

// ─── The envelope (OB-2) ───────────────────────────────────────────────────────────

/** Log severities, ordered. */
export type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * The closed, estate-wide boolean flag vocabulary (OB-5).
 *
 * @remarks
 * A condition an alert rule keys on is a **top-level boolean flag**, and it comes from this set.
 * A service uses the flags that apply and must not invent parallel ones — a rule that keys on
 * `anomaly` cannot also be taught to key on one service's `isAnomalous`.
 *
 * Adding a flag is a change to the table in `standards/observability-house-rules.md`, with a
 * changelog row, exactly like adding an event type to the webhook catalogue.
 *
 * | Flag | Meaning |
 * |---|---|
 * | `alert` | An operator must see this; every OB-12 alert also logs one such line |
 * | `anomaly` | Money mismatch, illegal transition, dead-letter, unknown refund outcome |
 * | `security` | A request or callback crossed a tenant boundary it should not have |
 * | `unmapped` | An upstream vocabulary word with no mapping, e.g. a PSP status |
 * | `external_refund` | State changed at the provider, outside the estate |
 * | `recovered` | An idempotency-recovery path ran; a previous attempt died mid-flight |
 * | `fail_open` | A throttle or guard allowed traffic because its counter store was unreachable |
 */
export type TelemetryFlag =
  | "alert"
  | "anomaly"
  | "security"
  | "unmapped"
  | "external_refund"
  | "recovered"
  | "fail_open";

/**
 * Structured fields attached to a log line.
 *
 * @remarks
 * Open, because a line carries whatever its call site knows. Two groups of member are named
 * rather than left to `unknown`, so a typo in either is a compile error:
 *
 * - the seven {@link TelemetryFlag} booleans (OB-5), which alert rules key on;
 * - `correlation_id` (OB-4), which is what joins one causal chain across services.
 */
export interface LogMeta extends Record<string, unknown> {
  /**
   * The id shared by every line in one causal chain (OB-4).
   *
   * @remarks
   * Copied unchanged from an inbound event into everything emitted while handling it, and equal
   * to `event_id` on a natively-produced one. **One value identifies a whole chain**, which is
   * what turns "a payment succeeded, an invoice was issued, an email was sent" into one query.
   *
   * Prefer {@link Telemetry.correlated} to setting this per line: a chain is only traceable if
   * *every* line carries it, and a binding cannot be forgotten halfway through a handler.
   */
  correlation_id?: string;
  alert?: boolean;
  anomaly?: boolean;
  security?: boolean;
  unmapped?: boolean;
  external_refund?: boolean;
  recovered?: boolean;
  fail_open?: boolean;
}

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
 * Emit-time deny-list (OB-6 item 4), and OB-6 item 2's four container names behind it. Any
 * metadata key matching this pattern is replaced with `[redacted]` inside the logger, so no
 * call site can leak a credential by naming it.
 *
 * @remarks
 * The tail of the pattern — **`body`, `values`, `variables`, `payload`** — is item 2, a
 * different rule with a different reason. Item 4 detects a credential-shaped *name*. Item 2
 * bans a class of *containers*, because a body is where the credentials that have no obvious
 * name live: an integration upsert carries a plaintext provider secret, a customer create
 * carries personal data, a magic-link render carries the token itself. Item 4's pattern
 * cannot see any of that — `body: { value: … }` matches nothing in it, and that is the exact
 * shape the accident takes, a handler passing the thing it just validated.
 *
 * The two lists share one regex because they share one mechanism. **Item 2's list is closed
 * at those four**: adding a name is a change with a changelog row, exactly as adding a flag
 * to OB-5's table is.
 *
 * `body` shipped alone in `1.1.0`. The other three arrive for the reason that release's own
 * changelog recorded and could not then act on: four of the five services on this package
 * wrap the logger *only* to strip these names, and a wrapper is bypassed the moment its
 * service adopts `requestMiddleware` without passing `createLogger`. The strip and OB-2's
 * ambient `request_id` were therefore two rules in one standard pulling one edit in opposite
 * directions. Carrying item 2 here retires all four wrappers, and the trap with them.
 */
const SENSITIVE_KEY =
  /key|secret|password|token|authorization|credential|body|values|variables|payload/i;

/**
 * `JSON.stringify` replacer that redacts sensitive keys at any depth. The root call has
 * an empty key and is never redacted. Two deliberate carve-outs from OB-6 item 4:
 *
 * - the literal member name `key` — OB-13 requires every alert to carry a stable rule
 *   `key` and the vendor layer groups by it, so redacting it would break alerting;
 * - numbers and booleans — a count or a flag is never a credential, and the OB-15
 *   heartbeat must carry `failing_credentials: 0` for the vendor layer to threshold.
 *
 * The second carve-out reaches item 2's container names too, and it is meant to: `values: 3`
 * is a count of them, not a body, and `body` has behaved this way since `1.1.0`. A container
 * a service actually wants to log is a container it must name something else.
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

// ─── The ambient request scope (OB-2) ──────────────────────────────────────────────

/**
 * The slice of `AsyncLocalStorage` this file uses.
 *
 * @remarks
 * Declared structurally rather than imported, so the source keeps its zero static imports
 * (OB-7) and the published `.d.ts` needs no `@types/node`.
 */
interface AmbientStore {
  getStore(): LogMeta | undefined;
  run<T>(store: LogMeta, callback: () => T): T;
}

/** The process-wide request scope. `null` until the guarded load succeeds, or forever if it cannot. */
let ambientStore: AmbientStore | null = null;

/** The in-flight load, so concurrent first requests wait on one import rather than racing. */
let ambientLoad: Promise<void> | undefined;

/**
 * Load `AsyncLocalStorage` once per process, and never let its absence be an error.
 *
 * @returns A promise that settles when the scope is ready, or when it is known to be unavailable.
 * @remarks
 * `node:async_hooks` is a platform module on Node, but the Vercel Edge Runtime and workerd do
 * not carry it unconditionally. A static import would therefore throw at **import** time on
 * those runtimes, before a service could catch anything, so the load is dynamic and its failure
 * is swallowed. A runtime without the module keeps exactly today's behaviour: no scope, so no
 * ambient field, so every line is the line it writes now.
 */
function loadAmbientStore(): Promise<void> {
  ambientLoad ??= import("node:async_hooks").then(
    ({ AsyncLocalStorage }) => {
      ambientStore = new AsyncLocalStorage<LogMeta>();
    },
    () => {
      // Nothing to do: `ambientStore` stays null and every scope operation is a no-op.
    },
  );
  return ambientLoad;
}

/**
 * The bindings of the request in flight, or `{}` outside one.
 *
 * @remarks
 * Called at **write** time, never when a logger is built: `telemetry.logger` is constructed once
 * at module scope, long before any request exists.
 */
function currentScope(): LogMeta {
  return ambientStore?.getStore() ?? {};
}

/**
 * Run `work` with `bindings` ambient for everything it awaits.
 *
 * @remarks
 * The scope follows the promise chain rather than the call graph, which is what reaches the code
 * threading a context cannot: a helper three files from the route, and work that outlives the
 * response — an inline queue drain, a detached alert.
 */
function runInScope<T>(bindings: LogMeta, work: () => T): T {
  return ambientStore ? ambientStore.run(bindings, work) : work();
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
  /**
   * Builds the request logger. Defaults to {@link Telemetry.createLogger}.
   *
   * @remarks
   * **Pass this whenever the service wraps the logger**, which every service enforcing
   * OB-6 item 2 does: the container strip lives in that wrapper, and a request logger built
   * from the SDK's own factory does not carry it. Without this hook a service had to choose
   * between the strip and the ambient `request_id` scope, because adopting the middleware
   * meant discarding whatever `lib/logger.ts` had installed — and four of the five services
   * on this package chose the strip, so the scope reached nobody.
   *
   * The logger this returns is put on the `log` context key **and** used for the OB-3
   * summary line, so a service-side wrapper covers both.
   *
   * @example
   * ```ts
   * // in the service's src/lib/logger.ts, the single seam
   * export const requestId = telemetry.requestMiddleware({ createLogger });
   * ```
   */
  createLogger?: (bindings: LogMeta) => Logger;
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
  /**
   * The unbound service logger, for module scope and background work.
   *
   * @remarks
   * Unbound, not context-free: a line it writes while a request is in flight carries that
   * request's `request_id`, because {@link Telemetry.requestMiddleware} puts the id in an
   * ambient scope that every line is written inside. That is what lets a helper three files
   * from the route obey OB-2 without taking a context parameter. Outside a request it writes
   * exactly the service envelope.
   */
  logger: Logger;
  /**
   * Bind a `correlation_id` onto a logger, so every line it writes carries it (OB-4).
   *
   * @param correlationId - The id from the inbound event's envelope, copied unchanged.
   * @param from - The logger to extend. Defaults to the service logger, which is enough: the
   * ambient request scope adds `request_id` wherever there is a request, including on a path
   * that holds a chain id and no context — an event emitter, a delivery worker. Pass a logger
   * only when you want bindings it carries beyond that.
   * @returns A child logger carrying the id.
   * @remarks
   * The counterpart to what {@link Telemetry.requestMiddleware} does for `request_id`, and
   * separate from it because a correlation id arrives in the **event envelope body**, not in a
   * header — a webhook receiver has it only after parsing, which no middleware can do for it.
   *
   * Use it at the top of any path that holds one: emitting an event, receiving one on
   * `/v1/hooks/{source_service}`, working a delivery. Binding beats passing the id to each call,
   * because a chain is only traceable if no line in it was forgotten.
   *
   * @example
   * ```ts
   * const log = telemetry.correlated(event.correlation_id);
   * log.info("Invoice issued", { event: "invoice.issued", public_id });
   * ```
   */
  correlated(correlationId: string, from?: Logger): Logger;
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
   *
   * @remarks
   * It also runs the handler inside an ambient scope carrying `request_id` (OB-2), so **every**
   * line written while the request is in flight carries it, not only the lines written through
   * `c.get("log")`. `c.get("log")` stays correct and stays the right thing to use where the
   * context is in hand; the scope is for the code that cannot reach it.
   *
   * **A service that wraps the logger MUST pass
   * {@link RequestMiddlewareOptions.createLogger}**, or the wrapper is bypassed for every
   * request-scoped line and the OB-6 item 2 container strip goes with it. Adopting this
   * middleware is otherwise a choice between two rules in the same standard, which is the
   * reason that option exists.
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
    //
    // The ambient scope goes underneath everything, so a logger given `request_id` explicitly
    // keeps its own value. It is read here rather than in `createLogger` because this is the one
    // place a line is built: `alert()` and the sink's own warnings go through it too, and OB-2's
    // clause covers every line written inside a request, not only the ones a logger writes.
    const line = JSON.stringify(
      {
        ...currentScope(),
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
    // The service's own factory when it has one, so a wrapper enforcing OB-6 item 2 is not
    // bypassed by the middleware that carries OB-2's scope. Resolved once per middleware
    // rather than per request: it is configuration, not request state.
    const buildLogger = options.createLogger ?? createLogger;
    // Started when the app wires its middleware and awaited per request: by the first request the
    // import has almost always settled, and the await is one microtask on an already-kept promise.
    const scopeReady = loadAmbientStore();
    return async (c, next) => {
      await scopeReady;
      const inbound = c.req.header(REQUEST_ID_HEADER);
      const id = inbound && SANE_REQUEST_ID.test(inbound) ? inbound : mintId();
      c.set("requestId", id);
      const log = buildLogger({ request_id: id });
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
        // The handler and everything it awaits run inside the scope, so a helper that never saw
        // `c` still writes `request_id`. The summary line below needs no scope: `log` carries
        // the id as an explicit binding.
        await runInScope({ request_id: id }, () => next());
      } catch (err) {
        // The summary must exist on a 500 too; the framework's error handler answers
        // after this middleware unwinds, so the status is taken from the error itself.
        finish(statusOfError(err) ?? 500);
        throw err;
      }
      finish(c.res.status);
    };
  }

  const serviceLogger = createLogger();

  /** OB-4: one binding, so no line in the chain can be written without the id. */
  function correlated(correlationId: string, from: Logger = serviceLogger): Logger {
    return from.child({ correlation_id: correlationId });
  }

  return {
    createLogger,
    logger: serviceLogger,
    correlated,
    alert,
    flush,
    requestMiddleware,
  };
}
