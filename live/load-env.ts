/**
 * Load `.env.live` into `process.env`, if there is one.
 *
 * @remarks
 * Hand-parsed rather than pulling in `dotenv`, because this repository has a zero-dependency policy for
 * anything that could reach a tarball and a near-zero one for everything else — and the format needed
 * here is `NAME=value`, one per line.
 *
 * `.env.live` is untracked (`.env.*` is in `.gitignore`) and must stay that way: it holds real
 * credentials for real tenants. An existing environment variable always wins, so CI secrets are not
 * overwritten by a file that happened to be left on a runner.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.live");

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const name = trimmed.slice(0, separator).trim();
    // Surrounding quotes are stripped; nothing else is interpreted, so a `#` inside a secret survives.
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");

    // Never overwrite: a CI job's secrets outrank a file.
    if (process.env[name] === undefined) process.env[name] = value;
  }
}
