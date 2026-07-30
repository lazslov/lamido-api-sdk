import { describe, expect, it } from "vitest";
import {
  redactExampleHosts,
  replaceServersBlock,
  sanitizeContract,
} from "../scripts/lib/sanitize-contract.js";

describe("replaceServersBlock", () => {
  const contract = [
    "openapi: 3.1.0",
    "servers:",
    "  - url: https://content.lamido.hu",
    "    description: Production",
    "  - url: http://localhost:3000",
    "    description: Local development",
    "",
    "tags:",
    "  - name: health",
  ].join("\n");

  it("replaces every server entry with one templated URL", () => {
    const result = replaceServersBlock(contract, "https://content.example.com");
    expect(result.replaced).toBe(true);
    expect(result.yaml).toContain('- url: "{baseUrl}"');
    expect(result.yaml).toContain("default: https://content.example.com");
    expect(result.yaml).not.toContain("lamido.hu");
    expect(result.yaml).not.toContain("localhost");
  });

  it("leaves the keys after the block untouched", () => {
    const result = replaceServersBlock(contract, "https://content.example.com");
    expect(result.yaml).toMatch(/\ntags:\n {2}- name: health$/);
  });

  it("reports when no block was found, rather than silently doing nothing", () => {
    // A rename upstream must surface as a failure — silence is how a host ships.
    const result = replaceServersBlock("openapi: 3.1.0\ntags: []\n", "https://x.example.com");
    expect(result.replaced).toBe(false);
    expect(result.yaml).toBe("openapi: 3.1.0\ntags: []\n");
  });
});

describe("redactExampleHosts", () => {
  it("rewrites the deployment domain, keeping the subdomain", () => {
    const result = redactExampleHosts("url: https://payment.lamido.hu/v1/ipn");
    expect(result.yaml).toBe("url: https://payment.example.com/v1/ipn");
    expect(result.rewrites).toBe(1);
  });

  it("rewrites the bare deployment domain", () => {
    expect(redactExampleHosts("host: lamido.hu").yaml).toBe("host: example.com");
  });

  it("normalises the fictional merchant domain upstream uses in examples", () => {
    const result = redactExampleHosts("payeeEmail: shop@acme.hu");
    expect(result.yaml).toBe("payeeEmail: shop@acme.example.com");
  });

  it("counts every rewrite", () => {
    const result = redactExampleHosts("a: content.lamido.hu\nb: https://acme.hu/x\n");
    expect(result.rewrites).toBe(2);
  });
});

describe("sanitizeContract", () => {
  it("leaves no trace of the deployment host anywhere", () => {
    const result = sanitizeContract(
      [
        "servers:",
        "  - url: https://payment.lamido.hu",
        "",
        "x: https://payment.lamido.hu/ipn",
      ].join("\n"),
      "https://payment.example.com",
    );
    expect(result.serversReplaced).toBe(true);
    expect(result.hostRewrites).toBe(1);
    expect(result.yaml).not.toContain("lamido.hu");
  });
});
