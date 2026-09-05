import { describe, expect, it } from "vitest";
import { scanText } from "../scripts/lib/forbidden-strings.js";
import {
  redactExampleCredentials,
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

describe("redactExampleCredentials", () => {
  it("rewrites the placeholder key upstream writes, because the guard cannot tell it apart", () => {
    // booking-service's contract carries this one, and it reaches a published `.d.ts` as an
    // `@example` tag. The `x` characters make it obviously fake to a human and not to the scanner.
    const result = redactExampleCredentials(
      "key: { type: string, example: bsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx }",
    );
    expect(result.rewrites).toBe(1);
    expect(result.yaml).toContain("bsk_YOUR_BSK_KEY");
    expect(scanText(result.yaml)).toEqual([]);
  });

  it("leaves a tail the guard already accepts alone, so the diff does not churn", () => {
    const already = "example: csk_YOUR_SECRET_KEY_HERE";
    expect(redactExampleCredentials(already)).toEqual({ yaml: already, rewrites: 0 });
  });

  it("rewrites every tier, so a new service needs no new rule", () => {
    const result = redactExampleCredentials(
      ["a: apk_aaaaaaaaaaaaaaaa", "b: wsk_bbbbbbbbbbbbbbbb", "c: whsec_cccccccccccccccc"].join(
        "\n",
      ),
    );
    expect(result.rewrites).toBe(3);
    expect(scanText(result.yaml)).toEqual([]);
  });

  it("leaves a short token alone, which is what the guard does too", () => {
    // Under twelve characters of payload is not a credential shape either scanner objects to.
    const short = "prefix: bsk_short";
    expect(redactExampleCredentials(short)).toEqual({ yaml: short, rewrites: 0 });
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

  it("leaves nothing the leak guard would reject, which is the whole contract of this module", () => {
    // Both families at once, because the two transforms run in sequence and the second reads the
    // first's output. A contract that survives this is a contract that can be committed.
    const result = sanitizeContract(
      [
        "servers:",
        "  - url: https://booking.lamido.hu",
        "",
        "callback: https://acme.hu/hooks",
        "key: { type: string, example: bsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx }",
      ].join("\n"),
      "https://booking.example.com",
    );

    expect(result.credentialRewrites).toBe(1);
    expect(scanText(result.yaml)).toEqual([]);
  });
});
