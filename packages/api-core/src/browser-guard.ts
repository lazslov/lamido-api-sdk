/** Options for {@link assertServerOnly}. */
export interface ServerOnlyOptions {
  /**
   * Key prefixes that must never reach a browser.
   *
   * @remarks
   * Parameterised because the services differ: content-service has a genuinely browser-safe
   * `cpk_` tier, while `csk_`, `isk_` and `pmk_` are all server-only.
   */
  readonly serverOnlyPrefixes: readonly string[];
  readonly serviceName: string;
  /** The environment variable this key most likely came from, named in the message. */
  readonly envVar?: string;
}

/**
 * Throw if a server-only key is being used in a browser.
 *
 * @param apiKey - The key about to be stored on a client.
 * @param options - Which prefixes are server-only, and for which service.
 * @throws When `window` exists and the key carries a server-only prefix.
 * @remarks
 * Called at **client construction**, not per request, so the accident — a gateway module
 * imported into a React client component — surfaces at the earliest possible moment.
 *
 * This is a tripwire, not a boundary. It does not replace `import "server-only"` at the top of
 * a gateway file: a build error beats a runtime throw, and this catches the case where nobody
 * added one. Note the message's instruction to *rotate*: a key that reached a bundle has been
 * published to every visitor, and hiding it afterwards changes nothing.
 */
export function assertServerOnly(apiKey: string, options: ServerOnlyOptions): void {
  if (typeof window === "undefined") return;

  const prefix = options.serverOnlyPrefixes.find((candidate) => apiKey.startsWith(candidate));
  if (!prefix) return;

  const source = options.envVar ? ` ${options.envVar}` : "";
  throw new Error(
    `${options.serviceName}: a ${prefix} key is server-only and this code is running in a browser. ` +
      `Move the client into a server module (add \`import "server-only"\` at the top of your gateway file) ` +
      `and keep${source} out of anything a bundler ships. This key has been exposed to every visitor: ` +
      `rotate it — hiding it now does nothing.`,
  );
}
