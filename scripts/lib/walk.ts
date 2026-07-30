import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Directories never worth walking into.
 *
 * @remarks
 * `dist` is deliberately absent. Build output is precisely where the leak guard and the
 * tarball audit have to look — a generated `.d.ts` is what actually ships.
 */
const skipDirectories = new Set(["node_modules", ".git"]);

/**
 * Extensions that hold no readable text. Anything else is treated as text and scanned —
 * failing open on an unknown extension is the wrong direction for a leak guard.
 */
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".zip",
  ".tgz",
  ".gz",
  ".node",
]);

/**
 * List every file under a directory, recursively.
 *
 * @param root - Directory to walk. A missing directory yields an empty list.
 * @returns Absolute file paths.
 */
export function listFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const full = path.join(root, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return skipDirectories.has(entry) ? [] : listFiles(full);
    return stats.isFile() ? [full] : [];
  });
}

/** True when a path's extension suggests it holds text worth scanning. */
export function isTextFile(file: string): boolean {
  return !binaryExtensions.has(path.extname(file).toLowerCase());
}
