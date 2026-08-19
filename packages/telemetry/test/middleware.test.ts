import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTelemetry,
  type Logger,
  type LogMeta,
  REQUEST_ID_HEADER,
  type TelemetryRequestContext,
} from "../src/index.js";

/** A minimal Hono-shaped context, enough to drive the middleware. */
function fakeContext(headers: Record<string, string> = {}, routePath = "/v1/things/:id") {
  const vars = new Map<string, unknown>();
  const responseHeaders = new Map<string, string>();
  const c: TelemetryRequestContext = {
    req: {
      method: "GET",
      path: "/v1/things/th_1",
      routePath,
      header: (name) => headers[name.toLowerCase()] ?? headers[name],
    },
    res: { status: 200 },
    set: (key, value) => vars.set(key, value),
    get: (key) => vars.get(key),
    header: (name, value) => responseHeaders.set(name, value),
  };
  return { c, vars, responseHeaders };
}

function captureLines() {
  const lines: Record<string, unknown>[] = [];
  const push = (raw: unknown) => lines.push(JSON.parse(String(raw)) as Record<string, unknown>);
  vi.spyOn(console, "log").mockImplementation(push);
  vi.spyOn(console, "warn").mockImplementation(push);
  vi.spyOn(console, "error").mockImplementation(push);
  return lines;
}

/** Narrow away `undefined` without a non-null assertion; fails the test when absent. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value to be present");
  return value;
}

const telemetry = () =>
  createTelemetry({ service: "test-service", env: "development", level: () => "info" });

beforeEach(() => vi.stubEnv("LOG_SINK", "none"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("request middleware (HR-20 + OB-3)", () => {
  it("accepts a sane inbound id, echoes it, and binds request_id on the log", async () => {
    const lines = captureLines();
    const { c, vars, responseHeaders } = fakeContext({ "x-request-id": "trace-me" });
    await telemetry().requestMiddleware()(c, async () => {});
    expect(vars.get("requestId")).toBe("trace-me");
    expect(responseHeaders.get(REQUEST_ID_HEADER)).toBe("trace-me");
    expect(lines.some((l) => l.request_id === "trace-me")).toBe(true);
  });

  it("mints a fresh id when the inbound one is insane", async () => {
    captureLines();
    const { c, vars } = fakeContext({ "x-request-id": "bad id with spaces\n" });
    await telemetry().requestMiddleware({ mintId: () => "minted" })(c, async () => {});
    expect(vars.get("requestId")).toBe("minted");
  });

  it("emits exactly one http.request summary with the route template, not the raw path", async () => {
    const lines = captureLines();
    const { c } = fakeContext();
    await telemetry().requestMiddleware({ tier: () => "merchant" })(c, async () => {});
    const summaries = lines.filter((l) => l.event === "http.request");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      route: "/v1/things/:id",
      method: "GET",
      status: 200,
      tier: "merchant",
    });
    expect(typeof must(summaries[0]).duration_ms).toBe("number");
  });

  it("emits the summary on a thrown error too, with the error's status", async () => {
    const lines = captureLines();
    const { c } = fakeContext();
    const boom = Object.assign(new Error("no"), { status: 401 });
    await expect(
      telemetry().requestMiddleware()(c, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    const summaries = lines.filter((l) => l.event === "http.request");
    expect(summaries).toHaveLength(1);
    expect(must(summaries[0]).status).toBe(401);
  });

  it("schedules the flush through the provided hook, off the response path", async () => {
    captureLines();
    const scheduled: (() => Promise<void>)[] = [];
    const { c } = fakeContext();
    await telemetry().requestMiddleware({ scheduleFlush: (work) => scheduled.push(work) })(
      c,
      async () => {},
    );
    expect(scheduled).toHaveLength(1);
    await expect(must(scheduled[0])()).resolves.toBeUndefined();
  });

  it("a hanging sink cannot delay the middleware: flush is scheduled, not awaited", async () => {
    vi.stubEnv("LOG_SINK", "loki");
    vi.stubEnv("LOG_SINK_URL", "https://loki.example.com/push");
    vi.stubEnv("LOG_SINK_TOKEN", "tok");
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    captureLines();
    const { c } = fakeContext();
    // The middleware promise settles even though the sink fetch never will.
    await telemetry().requestMiddleware()(c, async () => {});
  });
});

/**
 * The service logger factory (OB-2 composed with OB-6 item 2).
 *
 * @remarks
 * Without this hook the middleware built its request logger from the SDK's own factory, so a
 * service that wraps the logger — which every service enforcing OB-6 item 2 does, because the
 * container strip lives in that wrapper — had the wrapper bypassed on every request-scoped line
 * the moment it adopted the middleware. **Four of the five services on this package chose the
 * strip, so the ambient scope reached nobody.** These tests pin the composition: a service-side
 * wrapper survives, and it survives on the summary line too.
 */
describe("the request logger comes from the service seam when one is given", () => {
  /** A wrapper of the shape a service installs: one container member replaced wholesale. */
  function stripping(inner: Logger): Logger {
    const strip = (meta?: LogMeta): LogMeta | undefined =>
      meta && "variables" in meta ? { ...meta, variables: "[redacted]" } : meta;
    return {
      debug: (m, meta) => inner.debug(m, strip(meta)),
      info: (m, meta) => inner.info(m, strip(meta)),
      warn: (m, meta) => inner.warn(m, strip(meta)),
      error: (m, meta) => inner.error(m, strip(meta)),
      child: (b) => stripping(inner.child(b)),
    };
  }

  it("builds the context logger through the supplied factory", async () => {
    captureLines();
    const t = telemetry();
    const seen: LogMeta[] = [];
    const { c, vars } = fakeContext();

    await t.requestMiddleware({
      createLogger: (bindings) => {
        seen.push(bindings);
        return t.createLogger(bindings);
      },
    })(c, async () => {});

    expect(seen).toEqual([{ request_id: expect.any(String) }]);
    expect(vars.get("log")).toBeDefined();
  });

  /**
   * **The regression this option exists to prevent.** A handler logs the body it has just
   * validated; the service wrapper is the only thing standing between that and a log line, and
   * before this hook the middleware handed the handler a logger that had never been through it.
   */
  it("does not bypass a service wrapper on a line the handler writes", async () => {
    const lines = captureLines();
    const t = telemetry();
    const { c } = fakeContext();

    await t.requestMiddleware({ createLogger: (b) => stripping(t.createLogger(b)) })(
      c,
      async () => {
        (c.get("log") as Logger).info("handled a send", {
          variables: { to: "someone@example.com", magic: "magic-link-4f2a" },
        });
      },
    );

    const whole = JSON.stringify(lines);
    expect(whole).not.toContain("someone@example.com");
    expect(whole).not.toContain("magic-link-4f2a");
    expect(lines.some((l) => l.variables === "[redacted]")).toBe(true);
  });

  it("routes the OB-3 summary line through the wrapper too", async () => {
    const lines = captureLines();
    const t = telemetry();
    const { c } = fakeContext();
    const written: string[] = [];

    await t.requestMiddleware({
      createLogger: (b) => {
        const inner = t.createLogger(b);
        return {
          ...inner,
          info: (m: string, meta?: LogMeta) => {
            written.push(m);
            inner.info(m, meta);
          },
        };
      },
    })(c, async () => {});

    expect(written).toContain("Request handled");
    expect(lines.filter((l) => l.event === "http.request")).toHaveLength(1);
  });

  /**
   * The composition, which is the whole reason the hook exists: **a custom factory does not
   * cost the ambient scope, and the scope does not cost the wrapper.** Before this option a
   * service had to give up one to get the other.
   *
   * The wrapper is asserted on the request logger and the scope on a helper's line, because
   * those are the two things each mechanism actually governs — `telemetry.logger` is the SDK's
   * own and no middleware option can wrap it. A service wraps that one in its `lib/logger.ts`
   * and exports the wrapped value, which is a separate seam and has its own tests.
   */
  it("composes with the ambient scope, which is the whole point", async () => {
    const lines = captureLines();
    const t = telemetry();
    const { c } = fakeContext({ "x-request-id": "both-features" });

    await t.requestMiddleware({ createLogger: (b) => stripping(t.createLogger(b)) })(
      c,
      async () => {
        // A helper that never saw the context, writing through the service logger.
        t.logger.warn("a helper three files away", { note: "no context here" });
        // And the request logger, which the wrapper does govern.
        (c.get("log") as Logger).info("from the handler", { variables: { inner: "s" } });
      },
    );

    // The scope reaches a helper that has no context — that is OB-2's clause.
    expect(must(lines.find((l) => l.message === "a helper three files away")).request_id).toBe(
      "both-features",
    );
    // And the wrapper still governs every line the request logger writes.
    expect(must(lines.find((l) => l.message === "from the handler")).variables).toBe("[redacted]");
  });

  it("uses the SDK factory when no hook is given, unchanged", async () => {
    const lines = captureLines();
    const { c } = fakeContext({ "x-request-id": "default-path" });

    await telemetry().requestMiddleware()(c, async () => {});

    expect(lines.some((l) => l.request_id === "default-path")).toBe(true);
  });
});
