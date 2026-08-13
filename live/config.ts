/**
 * What the live suite needs, and how it reports having none of it.
 *
 * @remarks
 * This suite is the only one that proves the SDK's *understanding of the services* is still true. The
 * unit suites prove the SDK does what it was written to do; a pinned fixture proves it agrees with a
 * document. Neither notices when a service changes.
 *
 * > **RULE — verify against a real provisioned tenant, not against the code.** Two of the reference
 * > build's sharpest bugs were found only by pointing a site at a live dev tenant, and **a keyless
 * > build actively hid one of them.**
 *
 * Credentials come from the environment, or from an untracked `.env.live` — never from a file in this
 * repository, and never from this suite's source. See `docs/live-testing.md` for how to provision a
 * sandbox tenant and what may safely be pointed at it.
 */

/** One service's live configuration, or the reason there is none. */
export interface LiveTarget {
  readonly service: string;
  readonly baseUrl: string | undefined;
  readonly keys: Readonly<Record<string, string | undefined>>;
  /** Variable names that are set to something usable. */
  readonly missing: readonly string[];
  /** True when every variable this service's cases need is present. */
  readonly ready: boolean;
}

/** Read a variable, treating whitespace and the empty string as unset. */
function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Resolve one service's target.
 *
 * @param service - Named in the skip message.
 * @param baseUrlVar - The base-URL variable.
 * @param keyVars - The credential variables, by the name this suite uses for each.
 */
function target(
  service: string,
  baseUrlVar: string,
  keyVars: Readonly<Record<string, string>>,
): LiveTarget {
  const baseUrl = read(baseUrlVar);
  const keys = Object.fromEntries(
    Object.entries(keyVars).map(([alias, variable]) => [alias, read(variable)]),
  );

  const missing = [
    ...(baseUrl === undefined ? [baseUrlVar] : []),
    ...Object.entries(keyVars)
      .filter(([alias]) => keys[alias] === undefined)
      .map(([, variable]) => variable),
  ];

  return { service, baseUrl, keys, missing, ready: missing.length === 0 };
}

/**
 * content-service's target.
 *
 * @remarks
 * The publishable key is optional: only the case that proves a `cpk_` is refused on the client tier
 * needs it, and that case skips on its own rather than blocking the other five.
 */
export const contentTarget = target("content-service", "CONTENT_SERVICE_BASE_URL", {
  secret: "CONTENT_SERVICE_SECRET_KEY",
});

/** The publishable key, when one is configured. Read separately — see {@link contentTarget}. */
export const contentPublishableKey = read("CONTENT_SERVICE_PUBLISHABLE_KEY");

/** invoice-service's target. */
export const invoiceTarget = target("invoice-service", "INVOICE_SERVICE_BASE_URL", {
  client: "INVOICE_SERVICE_CLIENT_KEY",
});

/**
 * The `provider_config_id` the invoice cases may name.
 *
 * @remarks
 * Needed by the prefix-mismatch case, which asserts a `400` **without** issuing anything. There is no
 * default: guessing a config id would either fail for the wrong reason or, far worse, name a real one.
 */
export const invoiceProviderConfigId = read("INVOICE_SERVICE_PROVIDER_CONFIG_ID");

/** payment-service's target. Note `_URL`, not `_BASE_URL` — the service documents it that way. */
export const paymentTarget = target("payment-service", "PAYMENT_SERVICE_URL", {
  merchant: "PAYMENT_SERVICE_KEY",
});

/**
 * Whether this run is allowed to create anything.
 *
 * @remarks
 * Off by default, and the reason is in payment-service's own operations doc: as deployed, its preview
 * and production environments **share one `DATABASE_URL` and one `PUBLIC_BASE_URL`**, so a payment
 * created from a preview is a real production row. Every case that writes is therefore behind an
 * explicit opt-in rather than behind "it looked like a sandbox".
 *
 * Set `LIVE_ALLOW_WRITES=true` only when the target is a scratch database you are willing to leave
 * rows in — see `docs/live-testing.md`.
 */
export const allowWrites = read("LIVE_ALLOW_WRITES") === "true";

/**
 * The throwaway page slug a content write may touch.
 *
 * @remarks
 * > **GOTCHA — a probe that publishes is not a read-only probe.** Any call to `POST …/publish` makes
 * > every unpublished draft on that page live.
 *
 * So no case here publishes, ever, and the one write case reads a value and patches it back
 * **unchanged** — which proves the value shape and changes nothing. This slug exists so even that
 * touches a page nobody is editing.
 */
export const contentScratchSlug = read("CONTENT_SERVICE_SCRATCH_SLUG");

/**
 * Run a call that is expected to fail, and return the error it threw.
 *
 * @param call - The request. Deferred rather than a promise, so nothing is in flight before the
 * assertion is set up.
 * @returns The thrown value, typed as the error the caller expects.
 * @throws When the call **succeeds**, which is what makes these cases real: a `.catch()` that returns
 * the error would otherwise compare `undefined` against `undefined` and pass on a `200`.
 * @remarks
 * Every negative case in this suite goes through here. Several of them send a deliberately wrong key or
 * a deliberately malformed body, and the assertion is about *which* refusal arrives — so a success is a
 * finding, not a skip.
 */
export async function failure<E>(call: () => Promise<unknown>): Promise<E> {
  try {
    await call();
  } catch (error) {
    return error as E;
  }
  throw new Error("expected this request to fail, but the service accepted it");
}

/** Every target, for the summary. */
const targets = [contentTarget, invoiceTarget, paymentTarget];

/**
 * Why a service's cases were skipped, phrased for someone who expected them to run.
 *
 * @param service - The target.
 */
export function skipReason(service: LiveTarget): string {
  return `${service.service}: not configured — set ${service.missing.join(", ")}`;
}

/**
 * Print what this run can and cannot prove.
 *
 * @throws When `LIVE_REQUIRE_CONFIGURED=true` and any service is unconfigured — see below.
 * @remarks
 * Loud on purpose. A live suite that silently skips everything reports green and proves nothing, which
 * is worse than no live suite at all: the green is what stops anyone looking.
 *
 * Loud is enough for a developer running this by hand, and **not** enough for the release workflow,
 * which gates a publish on this suite. There, a missing secret would otherwise skip every case and hand
 * back the same green as a full pass — so the release sets `LIVE_REQUIRE_CONFIGURED=true` and an
 * unconfigured service becomes a failed release instead of an unverified one.
 */
export function reportConfiguration(): void {
  const ready = targets.filter((service) => service.ready);
  const required = read("LIVE_REQUIRE_CONFIGURED") === "true";

  if (ready.length === 0 && !required) {
    console.warn(
      "\n  No live credentials found. This suite proves NOTHING until it runs against a\n" +
        "  provisioned sandbox tenant. See docs/live-testing.md.\n",
    );
    return;
  }

  for (const service of targets) {
    console.info(service.ready ? `  ✓ ${service.service}` : `  – ${skipReason(service)}`);
  }
  if (!allowWrites) {
    console.info("  – writes are off (set LIVE_ALLOW_WRITES=true to include them)");
  }

  if (required) {
    const unconfigured = targets.filter((service) => !service.ready);
    if (unconfigured.length > 0) {
      throw new Error(
        `LIVE_REQUIRE_CONFIGURED is set, so a skipped service is a failure:\n  ${unconfigured
          .map(skipReason)
          .join("\n  ")}`,
      );
    }
  }
}
