"use server";

import { asSaveResult, revalidateAfterWrite, type SaveResult } from "@lazslov/content/next";
import { content } from "../lib/content";

/**
 * Save one field, the way a write action is supposed to look.
 *
 * @param headline - The new value, from a form.
 * @returns A result object. **Never throws.**
 * @remarks
 * A thrown server-action message is **redacted in production**, so a rejected save would reach the
 * editor as an opaque generic failure with the one thing they needed — which field, and why — gone.
 * `asSaveResult` is the plumbing for returning it instead.
 *
 * `error` on a failure is content-service's stable **code**, not a sentence: the copy belongs in this
 * app's own voice and language, which is what `explain` below is for.
 *
 * `revalidateAfterWrite` uses `updateTag` where the installed Next has it, so the editor's own next view
 * is correct without waiting for the webhook — which is the promise you make to someone who just pressed
 * Save. The webhook says the same thing a moment later, for everyone else.
 */
export async function saveHeadline(headline: string): Promise<SaveResult> {
  // Captured into a local before the guard: an imported binding is not narrowed inside a closure, and
  // the write below happens inside one.
  const gateway = content;
  if (gateway === null) return { ok: false, error: "not_configured" };

  // Nothing changed, so nothing is written — and no publish is armed. An empty diff is not a save.
  if (headline.trim() === "") return { ok: true };

  return asSaveResult(async () => {
    await gateway.client.patchValues("home", { "hero.headline": headline });
    revalidateAfterWrite(gateway.tag);
  });
}
