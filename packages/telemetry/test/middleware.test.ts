import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetry, REQUEST_ID_HEADER, type TelemetryRequestContext } from "../src/index.js";

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
