import type { SaveResult } from "@lazslov/content/next";

/**
 * Turn a {@link SaveResult}'s code into a sentence this site would actually show.
 *
 * @remarks
 * In its own module rather than beside the action, for two reasons. A `"use server"` file may only
 * export **async** functions — Next strips a synchronous export from one — and this needs to be callable
 * from a client component, which is the whole point: the same function renders the message wherever the
 * result is read.
 *
 * It lives in the app and not in the SDK because these are user-facing sentences in one site's voice and
 * one language. A translation layer inside a dependency is one nobody can edit.
 */
export function explain(result: SaveResult): string {
  if (result.ok) return "Saved.";

  switch (result.error) {
    case "validation_error":
      // The per-field messages the SDK mapped out of `details`, so a form can render them next to
      // inputs instead of showing one toast.
      return (
        Object.entries(result.fields ?? {})
          .map(([field, message]) => `${field}: ${message}`)
          .join("; ") || "That value was rejected."
      );
    case "conflict":
      return "Something else changed this page. Reload and try again.";
    case "unauthorized":
    case "forbidden":
      return "The service rejected our key. That is an operator problem, not yours.";
    case "not_configured":
      // Arrives through the same channel as a real 401, thanks to core's status: 0 sentinel — which is
      // why this switch is one translator rather than two.
      return "Content editing is not configured in this deployment.";
    default:
      return "The save did not go through. Try again in a moment.";
  }
}
