"use client";

import { useState, useTransition } from "react";
import { saveHeadline } from "./actions";
import { explain } from "./explain";

/**
 * The editor half: one field, one action, and the result rendered rather than thrown.
 *
 * @remarks
 * A client component, so it may **not** import `lib/content.ts` — that module holds a `csk_` key and
 * carries `import "server-only"`, which makes such an import a build error. It reaches the service only
 * through the action, which is the boundary that matters.
 */
export function SaveHeadline() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      style={{ marginTop: "2rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
      onSubmit={(event) => {
        event.preventDefault();
        const headline = new FormData(event.currentTarget).get("headline");
        startTransition(async () => {
          setMessage(explain(await saveHeadline(String(headline ?? ""))));
        });
      }}
    >
      <input
        name="headline"
        placeholder="New headline"
        style={{ padding: "0.5rem", flex: "1 1 16rem" }}
      />
      <button type="submit" disabled={pending} style={{ padding: "0.5rem 1rem" }}>
        {pending ? "Saving…" : "Save"}
      </button>
      {message !== null && <p style={{ flexBasis: "100%", color: "#444" }}>{message}</p>}
    </form>
  );
}
