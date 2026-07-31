import { asText } from "@lazslov/content/fields";
import { content } from "../lib/content";
import { SaveHeadline } from "./save-headline";

/**
 * The home page, rendered through **cache mode A**.
 *
 * @remarks
 * The point of this page is what it does *not* do. There is no `cache: "no-store"` anywhere, no
 * `force-dynamic`, and no `cookies()` or `headers()` call — so it prerenders, and a second request to
 * the deployed URL answers `x-vercel-cache: HIT`. That header is the only mechanical proof the route is
 * still static; the failure it catches is a latency and cost regression with no error message, which a
 * keyless local build hides completely.
 *
 * It also renders with **no environment at all**: `content` is `null` then, and every read below falls
 * back to a placeholder. That is how a new contributor runs this project.
 */
export default async function Home() {
  // Mode A: tagged, so a publish appears within seconds of the revalidation webhook firing.
  const page = (await content?.published.getPage("home")) ?? null;
  const site = (await content?.published.getSite().catch(() => null)) ?? null;

  // `page.section("hero")` never returns null — an undefined section reads as an empty one, so a
  // renaming upstream degrades to blank text instead of throwing. The `?? {}` covers only the case
  // where there is no *page*, which is what an unconfigured deployment or an unpublished slug gives.
  const hero = page?.section("hero").fields ?? {};

  return (
    <main
      style={{ fontFamily: "system-ui", maxWidth: "42rem", margin: "4rem auto", padding: "0 1rem" }}
    >
      <p style={{ color: "#666", fontSize: "0.875rem" }}>
        {content === null
          ? "content-service is not configured — rendering the degraded path."
          : `Reading ${site?.name ?? "this site"} through cache mode A, tag “${content.tag}”.`}
      </p>

      {/* asText answers "" for both an absent key and a stored "", so there is no `??` here: a stored
          empty string is an editor's deliberate choice and must not be replaced by a default. */}
      <h1>{asText(hero, "headline") || "Untitled"}</h1>
      <p>{asText(hero, "body")}</p>

      <SaveHeadline />
    </main>
  );
}
