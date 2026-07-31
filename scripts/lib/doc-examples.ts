/**
 * Pulling the JSON examples out of the knowledge base, and making them safe to commit.
 *
 * @remarks
 * Every JSON block in those documents is a free, authoritative fixture: it is what the service's own
 * maintainers wrote down as the shape of a request or a response. Asserting the SDK's types against them
 * costs nothing and has a second benefit — when a doc example and the SDK disagree, **one of them is
 * wrong**, and finding out at commit time is the whole reason this repository exists.
 *
 * Extraction is line-based and deliberately dumb. Anything that is not valid JSON is skipped rather than
 * repaired: a partially-elided example (`"…": "all other fields"`) is documentation prose, not a fixture,
 * and guessing at what it meant would put invented data in a test.
 */

import { isAllowedHost } from "./forbidden-strings.js";
import { redactExampleHosts } from "./sanitize-contract.js";

/** One extracted example, with enough provenance to find it again upstream. */
export interface DocExample {
  /** Path relative to the service folder, e.g. `client-api.md`. */
  readonly file: string;
  /** 1-based line of the opening fence or the body's first line. */
  readonly line: number;
  /**
   * The nearest preceding Markdown heading, or the `.http` request line.
   *
   * @remarks
   * The only signal available for *what* an example is. Not used to pick a type — that mapping is
   * hand-curated, because a heading is prose — but it is what makes a fixture readable in a diff and
   * findable when one starts failing.
   */
  readonly context: string;
  /** The example, reserialised. */
  readonly json: unknown;
}

/**
 * Credential-shaped tokens, which the docs use freely and this repository may not commit.
 *
 * @remarks
 * The leak guard rejects a key prefix followed by 12+ characters unless the tail is a `YOUR_`/`EXAMPLE_`
 * placeholder. Upstream writes `isk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` and `csk_9Kd2mQx7…`, neither of
 * which is a real key — but the guard cannot know that, and it must not learn to make exceptions.
 */
const credentialShaped = /\b(cpk|csk|cad|isk|iad|pmk|pad|whsec)_[A-Za-z0-9_-]{8,}/g;

/** Any absolute URL's host, so it can be checked against the guard's own allowlist. */
const urlHost = /\b(https?:\/\/)([A-Za-z0-9._:-]+)/g;

/**
 * Replace every host the leak guard would reject, and every credential-shaped token.
 *
 * @remarks
 * Broader than the contract sanitiser on purpose, and the reason is what running it first turned up: the
 * documents' examples contain a **real client's domain**, a PSP's sandbox host, and a Vercel Blob host.
 * None is a secret, but a tenant's identity is not ours to commit and this repository is bound for a
 * public remote — so anything outside the documentation allowlist is rewritten rather than reasoned about
 * one host at a time.
 *
 * The allowlist is imported from the guard rather than restated. Two copies would drift, and the one that
 * drifted would be this one — which fails **open**.
 *
 * Host values are never asserted on: every classifier checks key sets, so rewriting a host costs nothing.
 */
export function sanitizeExample(text: string): string {
  // First the two named families, so `lamido.hu` becomes `example.com` rather than a generic placeholder.
  const { yaml: withoutKnownHosts } = redactExampleHosts(text);

  const withoutForeignHosts = withoutKnownHosts.replace(
    urlHost,
    (match, scheme: string, host: string) =>
      isAllowedHost(host) ? match : `${scheme}redacted.example.com`,
  );

  return withoutForeignHosts.replace(
    credentialShaped,
    (_match, prefix: string) => `${prefix}_YOUR_KEY`,
  );
}

/**
 * Whether an example elides part of itself.
 *
 * @remarks
 * The docs abbreviate long objects with a literal ellipsis key — `"…": "all other Invoice fields"` — which
 * is, unhelpfully, **valid JSON**. So it parses, and asserting it against a type would fail on every field
 * the author left out. That is a documentation choice, not a contract change, and a fixture built from one
 * would be permanently red for no reason. Dropped at extraction rather than classified later, because it
 * is not a fixture at all.
 */
function isElided(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isElided);
  if (typeof value !== "object" || value === null) return false;

  const entries = Object.entries(value);
  return (
    entries.some(([key]) => key.includes("…") || key === "...") ||
    entries.some(([, nested]) => isElided(nested))
  );
}

/**
 * Parse text as JSON, or answer `null`.
 *
 * @remarks
 * `null` covers "not JSON at all", a bare scalar — which is not a fixture of any type — and an elided
 * example. Nothing is repaired: guessing at what an author left out would put invented data in a test.
 */
function parseObject(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    return isElided(value) ? null : value;
  } catch {
    return null;
  }
}

/** The nearest preceding ATX heading, searching upwards from `index`. */
function headingAbove(lines: readonly string[], index: number): string {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const heading = /^#{1,6}\s+(.*)$/.exec(lines[cursor] ?? "");
    if (heading?.[1]) return heading[1].trim();
  }
  return "(no heading)";
}

/**
 * Extract every fenced ```json block from a Markdown document.
 *
 * @param source - The document.
 * @param file - Its name, for provenance.
 */
export function extractFromMarkdown(source: string, file: string): DocExample[] {
  const lines = sanitizeExample(source).split(/\r?\n/);
  const examples: DocExample[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^```json\s*$/.test(lines[index] ?? "")) continue;

    const close = lines.findIndex((line, at) => at > index && /^```\s*$/.test(line));
    if (close === -1) break;

    const json = parseObject(lines.slice(index + 1, close).join("\n"));
    if (json !== null) {
      examples.push({ file, line: index + 1, context: headingAbove(lines, index), json });
    }
    index = close;
  }

  return examples;
}

/**
 * Extract every JSON request body from an `.http` collection.
 *
 * @param source - The collection.
 * @param file - Its name, for provenance.
 * @remarks
 * A body is the block after a blank line following the headers, up to the next `###` separator. These are
 * **requests**, which is the half the Markdown examples cover least well — most doc blocks are responses.
 */
export function extractFromHttp(source: string, file: string): DocExample[] {
  const lines = sanitizeExample(source).split(/\r?\n/);
  const examples: DocExample[] = [];

  let requestLine = "(no request line)";
  let bodyStart = -1;

  /** Close the body being accumulated, if it parses. */
  const flush = (end: number): void => {
    if (bodyStart === -1) return;
    const json = parseObject(lines.slice(bodyStart, end).join("\n"));
    if (json !== null) {
      examples.push({ file, line: bodyStart + 1, context: requestLine, json });
    }
    bodyStart = -1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (/^###/.test(line)) {
      flush(index);
      continue;
    }

    // A request line resets the context and ends any body before it.
    if (/^(GET|POST|PUT|PATCH|DELETE)\s+\S/.test(line)) {
      flush(index);
      requestLine = line.trim();
      continue;
    }

    // A body starts at the first `{` or `[` at column 0 after a request line.
    if (bodyStart === -1 && /^[{[]/.test(line)) {
      bodyStart = index;
    }
  }

  flush(lines.length);
  return examples;
}
