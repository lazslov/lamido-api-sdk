/**
 * Print what this run can and cannot prove, once, before anything is collected.
 *
 * @remarks
 * A `globalSetup` rather than a `beforeAll`, for two reasons that both matter here. A `beforeAll` inside
 * a suite that is **skipped** never runs — so with no credentials the report would be exactly as silent
 * as the thing it exists to warn about. And Vitest intercepts console output from inside tests, which
 * hides it behind a reporter flag.
 *
 * `.env.live` is loaded here as well as in the per-file setup: this runs in the main process and the
 * tests run in workers, so each needs its own read. Loading twice is idempotent — an already-set
 * variable is never overwritten.
 */

import "./load-env.js";
import { reportConfiguration } from "./config.js";

export default function setup(): void {
  reportConfiguration();
}
