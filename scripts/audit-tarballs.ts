/**
 * Pack every package, extract it, and assert nothing forbidden is inside.
 *
 * Usage: `pnpm audit:tarballs` (after `pnpm build`)
 *
 * The last line of defence before publish: it inspects what npm would actually ship,
 * including `.d.ts` and any sourcemap, rather than what the source tree looks like.
 * Phase 1 §5.2.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { formatFindings, loadTenantSlugs, scanText } from "./lib/forbidden-strings.js";
import { packageDirs, packagePath, repoRoot } from "./lib/paths.js";
import { checkTarball, type PackedManifest, type Violation } from "./lib/tarball-rules.js";
import { isTextFile, listFiles } from "./lib/walk.js";

/** Scratch directory for pack output and extraction. Git-ignored, removed on each run. */
const workDir = path.join(repoRoot, ".audit-tarballs");

/** Run a command, returning stdout. */
function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

/**
 * Pack one package and extract it.
 *
 * @returns Directory containing the tarball's `package/` contents.
 */
function packAndExtract(packageDir: string): string {
  const destination = path.join(workDir, packageDir);
  mkdirSync(destination, { recursive: true });

  run("pnpm", ["pack", "--pack-destination", destination], packagePath(packageDir));
  const tarball = listFiles(destination).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error(`${packageDir}: pnpm pack produced no tarball`);

  // bsdtar ships with Windows 11 and GNU tar with every CI image, so one invocation works
  // everywhere and avoids a tar library in devDependencies.
  run("tar", ["-xf", path.basename(tarball)], destination);
  return path.join(destination, "package");
}

function main(): void {
  rmSync(workDir, { recursive: true, force: true });
  const tenantSlugs = loadTenantSlugs();
  const failures: string[] = [];

  for (const packageDir of packageDirs) {
    const extracted = packAndExtract(packageDir);
    const files = listFiles(extracted).map((file) =>
      path.relative(extracted, file).replaceAll("\\", "/"),
    );
    const manifest = JSON.parse(
      readFileSync(path.join(extracted, "package.json"), "utf8"),
    ) as PackedManifest;

    const violations: Violation[] = checkTarball({ packageDir, files, manifest });

    let leaks = 0;
    for (const relative of files) {
      const full = path.join(extracted, relative);
      if (!isTextFile(full)) continue;
      const findings = scanText(readFileSync(full, "utf8"), { tenantSlugs });
      if (findings.length === 0) continue;
      leaks += findings.length;
      console.error(formatFindings(`${manifest.name}/${relative}`, findings));
    }

    for (const violation of violations) {
      console.error(`  ${manifest.name}  [${violation.rule}] ${violation.detail}`);
    }

    if (violations.length > 0 || leaks > 0) {
      failures.push(packageDir);
    } else {
      console.log(`${String(manifest.name).padEnd(20)} ${files.length} file(s), clean.`);
    }
  }

  rmSync(workDir, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nTarball audit failed for: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll ${packageDirs.length} tarballs are publishable.`);
}

main();
