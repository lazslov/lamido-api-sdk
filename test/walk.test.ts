import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isTextFile, listFiles } from "../scripts/lib/walk.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lamido-walk-"));
  mkdirSync(path.join(root, "dist"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), "{}");
  writeFileSync(path.join(root, "dist", "index.d.ts"), "export {};");
  writeFileSync(path.join(root, "node_modules", "left-pad", "index.js"), "");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Paths relative to the fixture root, with forward slashes. */
function walked(): string[] {
  return listFiles(root).map((file) => path.relative(root, file).replaceAll("\\", "/"));
}

describe("listFiles", () => {
  it("descends into dist, because build output is what actually ships", () => {
    expect(walked()).toContain("dist/index.d.ts");
  });

  it("skips node_modules", () => {
    expect(walked().some((file) => file.startsWith("node_modules/"))).toBe(false);
  });

  it("returns an empty list for a missing directory", () => {
    expect(listFiles(path.join(root, "nope"))).toEqual([]);
  });
});

describe("isTextFile", () => {
  it("treats declaration files and sourcemaps as text", () => {
    expect(isTextFile("dist/index.d.ts")).toBe(true);
    expect(isTextFile("dist/index.js.map")).toBe(true);
  });

  it("skips binaries", () => {
    expect(isTextFile("logo.png")).toBe(false);
    expect(isTextFile("bundle.tgz")).toBe(false);
  });

  it("treats an unknown extension as text, failing towards scanning", () => {
    expect(isTextFile("notes.whatever")).toBe(true);
  });
});
