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
  it("reads the liveness body from /healthz", async () => {
    const stub = fetchStub([jsonResponse({ status: "ok" })]);
    await expect(websiteClient(stub).getHealth()).resolves.toEqual({ status: "ok" });
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/healthz`);
  });

  it("is not unwrapped from a data envelope, because this endpoint has none", async () => {
    const stub = fetchStub([jsonResponse({ status: "ok" })]);
    const health = await websiteClient(stub).getHealth();
    expect(health).not.toHaveProperty("data");
  });

  it("sends no credential requirement it cannot meet, and no query", async () => {
    // The only unauthenticated endpoint on the service. It takes no parameters at all.
    const stub = fetchStub([jsonResponse({ status: "ok" })]);
    await websiteClient(stub).getHealth();
    expect(stub.lastUrl()).not.toContain("?");
  });

  it("throws for any non-2xx, because this endpoint always answers 200", async () => {
    // It used to answer a 503 carrying `{status: "degraded", db: "unreachable"}`, which this
    // package smuggled back out through the error path. As of the service's d013970 the route
    // never touches the database and the `db` member is gone, so a non-2xx here is a network or
    // proxy fault rather than a health report — and must not be returned as one.
    const stub = fetchStub([errorResponse(503, "internal")]);
    await expect(websiteClient(stub).getHealth()).rejects.toBeInstanceOf(ContentApiError);
  });

  it("throws for a failure that is not a health report", async () => {
    const stub = fetchStub([errorResponse(401, "unauthorized")]);
    await expect(websiteClient(stub).getHealth()).rejects.toBeInstanceOf(ContentApiError);
  });

  it("throws for a 503 that carries no body at all", async () => {
    const stub = fetchStub([new Response("<html>gateway</html>", { status: 503 })]);
    await expect(websiteClient(stub).getHealth()).rejects.toMatchObject({ status: 503 });
  });
});
