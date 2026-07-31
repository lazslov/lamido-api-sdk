import { describe, expect, it } from "vitest";
import { ContentApiError } from "../src/errors.js";
import {
  errorResponse,
  fetchStub,
  jsonResponse,
  testBaseUrl,
  websiteClient,
} from "./stubs/fetch.js";

describe("getHealth", () => {
  it("reads the plain body on a 200", async () => {
    const stub = fetchStub([jsonResponse({ status: "ok", db: "ok" })]);
    await expect(websiteClient(stub).getHealth()).resolves.toEqual({ status: "ok", db: "ok" });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/api/health`);
  });

  it("returns the degraded body on a 503 instead of throwing", async () => {
    // A monitor that checks response.ok before reading the body never sees the reason.
    const stub = fetchStub([
      jsonResponse({ status: "degraded", db: "unreachable", code: "ECONNREFUSED" }, 503),
    ]);
    await expect(websiteClient(stub).getHealth()).resolves.toEqual({
      status: "degraded",
      db: "unreachable",
      code: "ECONNREFUSED",
    });
  });

  it("is not unwrapped from a data envelope, because this endpoint has none", async () => {
    const stub = fetchStub([jsonResponse({ status: "ok", db: "ok" })]);
    const health = await websiteClient(stub).getHealth();
    expect(health).not.toHaveProperty("data");
  });

  it("still throws for a failure that is not a health report", async () => {
    const stub = fetchStub([errorResponse(401, "unauthorized")]);
    await expect(websiteClient(stub).getHealth()).rejects.toBeInstanceOf(ContentApiError);
  });

  it("throws for a 503 that carries no health body", async () => {
    const stub = fetchStub([new Response("<html>gateway</html>", { status: 503 })]);
    await expect(websiteClient(stub).getHealth()).rejects.toMatchObject({ status: 503 });
  });
});
