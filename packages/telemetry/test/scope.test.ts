import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetry, type TelemetryRequestContext } from "../src/index.js";

/**
 * The ambient request scope (OB-2).
 *
 * @remarks
 * OB-2 asks that a line written while handling a request carries that request's `request_id`.
 * The clause used to hold only for lines written through `c.get("log")`; a helper that imports
 * `telemetry.logger` had no context to read and so wrote no id. These tests guard the mechanism
 * that closes the gap, and the four properties that make it safe to adopt by a version bump:
 * absence is not an error, an explicit binding still wins, two requests never see each other's
 * id, and a runtime without `node:async_hooks` keeps exactly the behaviour it has today.
 */

/** Capture every console line the logger writes, parsed back from JSON. */
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

/** A minimal Hono-shaped context, enough to drive the middleware. */
function fakeContext(headers: Record<string, string> = {}) {
  const vars = new Map<string, unknown>();
  const c: TelemetryRequestContext = {
    req: {
      method: "GET",
      path: "/v1/things/th_1",
      routePath: "/v1/things/:id",
      header: (name) => headers[name.toLowerCase()] ?? headers[name],
    },
    res: { status: 200 },
    set: (key, value) => vars.set(key, value),
    get: (key) => vars.get(key),
    header: () => {},
  };
  return c;
}

const telemetry = () =>
  createTelemetry({ service: "test-service", env: "development", level: () => "info" });

/** The one line a test wrote, found by its message rather than by position. */
const lineFor = (lines: Record<string, unknown>[], message: string) =>
  must(lines.find((line) => line.message === message));

beforeEach(() => vi.stubEnv("LOG_SINK", "none"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the ambient request scope (OB-2)", () => {
  it("gives the service logger the request id, with no context passed to it", async () => {
    const lines = captureLines();
    const t = telemetry();
    // Stands for the helper three files from the route: it holds the module-scope logger and
    // has never seen `c`. This is the call site the clause used to miss.
    const helper = () => t.logger.warn("last_used_at refresh failed");

    await t.requestMiddleware({ mintId: () => "req_1" })(fakeContext(), async () => {
      helper();
    });

    expect(lineFor(lines, "last_used_at refresh failed").request_id).toBe("req_1");
  });

  it("reaches through await points, not just the synchronous handler body", async () => {
    const lines = captureLines();
    const t = telemetry();

    await t.requestMiddleware({ mintId: () => "req_2" })(fakeContext(), async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      t.logger.info("after two await points");
    });

    expect(lineFor(lines, "after two await points").request_id).toBe("req_2");
  });

  it("still carries the id in work that outlives the response", async () => {
    const lines = captureLines();
    const t = telemetry();
    // The 8-of-24 case threading cannot reach at all: a drain started inside the request that
    // finishes after the summary line. The scope follows the promise, so the id survives.
    let drain: Promise<void> | undefined;

    await t.requestMiddleware({ mintId: () => "req_3" })(fakeContext(), async () => {
      drain = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        t.logger.info("queue drained");
      })();
    });

    await drain;
    expect(lineFor(lines, "queue drained").request_id).toBe("req_3");
  });

  it("writes no request_id outside a request", () => {
    const lines = captureLines();
    telemetry().logger.info("cron tick");
    expect(lineFor(lines, "cron tick")).not.toHaveProperty("request_id");
  });

  it("lets an explicit binding win over the ambient one", async () => {
    const lines = captureLines();
    const t = telemetry();

    await t.requestMiddleware({ mintId: () => "req_4" })(fakeContext(), async () => {
      t.createLogger({ request_id: "explicit" }).info("bound elsewhere");
      t.logger.child({ request_id: "child" }).info("bound on a child");
    });

    expect(lineFor(lines, "bound elsewhere").request_id).toBe("explicit");
    expect(lineFor(lines, "bound on a child").request_id).toBe("child");
  });

  it("keeps two concurrent requests apart", async () => {
    const lines = captureLines();
    const t = telemetry();
    const handle = (id: string) =>
      t.requestMiddleware({ mintId: () => id })(fakeContext(), async () => {
        // Interleave deliberately: both handlers are suspended at the same time.
        await new Promise((resolve) => setTimeout(resolve, 0));
        t.logger.info(`handled ${id}`);
      });

    await Promise.all([handle("req_a"), handle("req_b")]);

    expect(lineFor(lines, "handled req_a").request_id).toBe("req_a");
    expect(lineFor(lines, "handled req_b").request_id).toBe("req_b");
  });

  it("carries the id onto a correlated logger that was given no parent", async () => {
    const lines = captureLines();
    const t = telemetry();

    await t.requestMiddleware({ mintId: () => "req_5" })(fakeContext(), async () => {
      t.correlated("corr_1").info("Invoice issued");
    });

    expect(lineFor(lines, "Invoice issued")).toMatchObject({
      request_id: "req_5",
      correlation_id: "corr_1",
    });
  });

  it("carries the id onto an alert raised inside the request", async () => {
    const lines = captureLines();
    const t = telemetry();

    await t.requestMiddleware({ mintId: () => "req_6" })(fakeContext(), async () => {
      await t.alert("critical", "payments.anomaly");
    });

    expect(lineFor(lines, "Alert: payments.anomaly").request_id).toBe("req_6");
  });

  it("carries the id on the summary line of a request that threw", async () => {
    const lines = captureLines();
    const t = telemetry();
    const boom = t.requestMiddleware({ mintId: () => "req_7" })(fakeContext(), async () => {
      t.logger.error("handler failed");
      throw new Error("boom");
    });

    await expect(boom).rejects.toThrow("boom");
    expect(lineFor(lines, "handler failed").request_id).toBe("req_7");
    expect(lineFor(lines, "Request handled").request_id).toBe("req_7");
  });
});

describe("a runtime without node:async_hooks", () => {
  afterEach(() => {
    vi.doUnmock("node:async_hooks");
    vi.resetModules();
  });

  it("loads, serves the request, and writes exactly today's line", async () => {
    // The Edge Runtime and workerd do not carry the module unconditionally. A static import
    // would throw here; the guarded load leaves the scope a no-op instead.
    vi.doMock("node:async_hooks", () => {
      throw new Error("Cannot find module 'node:async_hooks'");
    });
    vi.resetModules();
    const fresh = await import("../src/index.js");

    const lines = captureLines();
    const t = fresh.createTelemetry({
      service: "test-service",
      env: "development",
      level: () => "info",
    });
    await t.requestMiddleware({ mintId: () => "req_8" })(fakeContext(), async () => {
      t.logger.info("no scope here");
    });

    // The request logger still carries the id — that binding never depended on the scope.
    expect(lineFor(lines, "Request handled").request_id).toBe("req_8");
    expect(lineFor(lines, "no scope here")).not.toHaveProperty("request_id");
  });
});
