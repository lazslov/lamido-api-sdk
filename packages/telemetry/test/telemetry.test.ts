import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetry, type Level } from "../src/index.js";

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

function testTelemetry(level: Level = "info") {
  return createTelemetry({ service: "test-service", env: "development", level: () => level });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LOG_SINK", "none");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the envelope (OB-2)", () => {
  it("writes one JSON line carrying time, service, env, level and message", () => {
    const lines = captureLines();
    testTelemetry().logger.info("hello", { paymentId: "pay_1" });
    expect(lines).toHaveLength(1);
    const line = must(lines[0]);
    expect(line.service).toBe("test-service");
    expect(line.env).toBe("development");
    expect(line.level).toBe("info");
    expect(line.message).toBe("hello");
    expect(line.paymentId).toBe("pay_1");
    // RFC 3339 UTC with millisecond precision.
    expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("keeps the level/message-always-win invariant, and extends it to the envelope", () => {
    const lines = captureLines();
    testTelemetry().logger.warn("real message", {
      message: "impostor",
      level: "info",
      service: "impostor-service",
    });
    const line = must(lines[0]);
    expect(line.message).toBe("real message");
    expect(line.level).toBe("warn");
    expect(line.service).toBe("test-service");
  });

  it("call-site meta wins over bindings; child bindings stack", () => {
    const lines = captureLines();
    const log = testTelemetry().createLogger({ a: 1 }).child({ b: 2 });
    log.info("x", { a: 99 });
    expect(lines[0]).toMatchObject({ a: 99, b: 2 });
  });

  it("filters below the active level and degrades to info when the supplier throws", () => {
    const lines = captureLines();
    const throwing = createTelemetry({
      service: "test-service",
      env: "development",
      level: () => {
        throw new Error("no env");
      },
    });
    throwing.logger.debug("dropped");
    throwing.logger.info("kept");
    expect(lines).toHaveLength(1);
    expect(must(lines[0]).message).toBe("kept");
  });
});

describe("the deny-list (OB-6)", () => {
  it("redacts sensitive keys at any depth, inside the logger", () => {
    const lines = captureLines();
    testTelemetry().logger.info("x", {
      authorization: "Bearer sk_live_123",
      nested: { apiKeySecret: "shh", fine: "visible" },
    });
    const line = must(lines[0]);
    expect(line.authorization).toBe("[redacted]");
    expect((line.nested as Record<string, unknown>).apiKeySecret).toBe("[redacted]");
    expect((line.nested as Record<string, unknown>).fine).toBe("visible");
    expect(JSON.stringify(line)).not.toContain("sk_live_123");
  });

  it("spares counts and flags: a number or boolean is never a credential", () => {
    const lines = captureLines();
    testTelemetry().logger.info("heartbeat", {
      failing_credentials: 0,
      token_rotation_due: true,
      api_key_hint: "still-redacted",
    });
    const line = must(lines[0]);
    expect(line.failing_credentials).toBe(0);
    expect(line.token_rotation_due).toBe(true);
    expect(line.api_key_hint).toBe("[redacted]");
  });
});

describe("the sink (OB-1, OB-8…OB-11)", () => {
  it("stdout is identical with the sink unset and with it unreachable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    vi.stubEnv("LOG_SINK", "");
    let lines = captureLines();
    const bare = testTelemetry();
    bare.logger.info("same line", { n: 1 });
    await bare.flush();
    const withoutSink = lines.filter((l) => l.message === "same line");

    vi.unstubAllEnvs();
    vi.stubEnv("LOG_SINK", "loki");
    vi.stubEnv("LOG_SINK_URL", "https://loki.example.com/push");
    vi.stubEnv("LOG_SINK_TOKEN", "tok");
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    lines = captureLines();
    const sinking = testTelemetry();
    sinking.logger.info("same line", { n: 1 });
    await sinking.flush();
    const withSink = lines.filter((l) => l.message === "same line");

    const strip = (l: Record<string, unknown>) => ({ ...l, time: "T" });
    expect(withSink.map(strip)).toEqual(withoutSink.map(strip));
    fetchSpy.mockRestore();
  });

  it("a failed flush drops the batch and logs one warn with the error name only", async () => {
    vi.stubEnv("LOG_SINK", "loki");
    vi.stubEnv("LOG_SINK_URL", "https://loki.example.com/push");
    vi.stubEnv("LOG_SINK_TOKEN", "super-secret-token");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      // A realistic runtime failure message: it embeds the push URL, credentials included.
      Object.assign(new Error("connect failed for user:super-secret-token at the sink host"), {
        name: "TypeError",
      }),
    );
    const lines = captureLines();
    const t = testTelemetry();
    t.logger.info("payload");
    await t.flush();
    const warns = lines.filter((l) => l.message === "Log sink flush failed; batch dropped");
    expect(warns).toHaveLength(1);
    expect(must(warns[0]).error).toBe("TypeError");
    expect(JSON.stringify(lines)).not.toContain("user:super-secret-token");
    // No retry: a second flush ships nothing.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    await t.flush();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("ships info and above, never debug (OB-11), with only service/env/level as labels (OB-10)", async () => {
    vi.stubEnv("LOG_SINK", "loki");
    vi.stubEnv("LOG_SINK_URL", "https://loki.example.com/push");
    vi.stubEnv("LOG_SINK_TOKEN", "tok");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    captureLines();
    const t = testTelemetry("debug");
    t.logger.debug("local only");
    t.logger.info("ships");
    t.logger.error("ships too", { request_id: "r1" });
    await t.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = must(fetchSpy.mock.calls[0]);
    const body = JSON.parse(String(must(call[1]).body)) as {
      streams: { stream: Record<string, string>; values: [string, string][] }[];
    };
    const shipped = body.streams.flatMap((s) => s.values.map(([, line]) => line));
    expect(shipped.some((l) => l.includes("local only"))).toBe(false);
    expect(shipped.some((l) => l.includes("ships"))).toBe(true);
    for (const s of body.streams) {
      expect(Object.keys(s.stream).sort()).toEqual(["env", "level", "service"]);
    }
  });

  it("warns exactly once per boot per missing variable (OB-8)", async () => {
    vi.stubEnv("LOG_SINK", "loki");
    vi.stubEnv("LOG_SINK_URL", "");
    const lines = captureLines();
    const t = testTelemetry();
    t.logger.info("a");
    await t.flush();
    t.logger.info("b");
    await t.flush();
    const warns = lines.filter((l) => l.variable === "LOG_SINK_URL");
    expect(warns).toHaveLength(1);
  });

  it("caps the buffer, drops oldest first, and records how many (OB-9)", async () => {
    vi.stubEnv("LOG_SINK", "loki");
    vi.stubEnv("LOG_SINK_URL", "https://loki.example.com/push");
    vi.stubEnv("LOG_SINK_TOKEN", "tok");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    captureLines();
    const t = testTelemetry();
    const big = "x".repeat(64 * 1024);
    for (let i = 0; i < 10; i += 1) t.logger.info(`line ${i}`, { pad: big });
    await t.flush();
    const call = must(fetchSpy.mock.calls[0]);
    const body = JSON.parse(String(must(call[1]).body)) as {
      streams: { values: [string, string][] }[];
    };
    const shipped = body.streams.flatMap((s) => s.values.map(([, line]) => line));
    expect(shipped.some((l) => l.includes("line 0"))).toBe(false);
    const droppedLine = must(shipped.find((l) => l.includes("telemetry.lines_dropped")));
    expect((JSON.parse(droppedLine) as { dropped: number }).dropped).toBeGreaterThan(0);
  });
});

describe("alert() (OB-12…OB-14)", () => {
  it("always emits the alert:true backstop line, even with the channel unconfigured", async () => {
    const lines = captureLines();
    await testTelemetry().alert("critical", "payments.anomaly", {
      paymentId: "pay_1",
      expected: 100,
    });
    const backstop = lines.find((l) => l.alert === true);
    expect(backstop).toMatchObject({
      level: "error",
      severity: "critical",
      key: "payments.anomaly",
      event: "alert.raised",
      paymentId: "pay_1",
    });
    // Unconfigured is loud, never silent.
    const warn = lines.find(
      (l) => l.message === "Telegram alert channel is not configured; alert logged only",
    );
    expect(warn).toBeDefined();
  });

  it("posts to Telegram with the severity emoji and never carries redacted values", async () => {
    vi.stubEnv("TELEGRAM_ALERT_BOT_TOKEN", "bot-token-123");
    vi.stubEnv("TELEGRAM_ALERT_CHAT_ID", "-100");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    captureLines();
    await testTelemetry().alert("warning", "credentials.failing", {
      merchantId: "m_1",
      apiKeySecret: "leak-me-not",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = must(fetchSpy.mock.calls[0]);
    expect(String(url)).toContain("api.telegram.org");
    const body = JSON.parse(String(must(init).body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe("-100");
    expect(body.text).toContain("⚠️ test-service warning: credentials.failing");
    expect(body.text).toContain("merchantId: m_1");
    expect(body.text).not.toContain("leak-me-not");
  });

  it("a channel failure never throws: one warn, error name only, backstop intact", async () => {
    vi.stubEnv("TELEGRAM_ALERT_BOT_TOKEN", "bot-token-123");
    vi.stubEnv("TELEGRAM_ALERT_CHAT_ID", "-100");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("https://api.telegram.org/botbot-token-123/sendMessage failed"), {
        name: "TypeError",
      }),
    );
    const lines = captureLines();
    await expect(testTelemetry().alert("critical", "inbound.refused")).resolves.toBeUndefined();
    expect(lines.some((l) => l.alert === true)).toBe(true);
    const warns = lines.filter((l) => l.message === "Telegram alert delivery failed");
    expect(warns).toHaveLength(1);
    expect(must(warns[0]).error).toBe("TypeError");
    expect(JSON.stringify(lines)).not.toContain("bot-token-123");
  });
});
