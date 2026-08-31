"use client";

/**
 * The error boundary for `/` and everything below it.
 *
 * THE ONE THING THIS SCREEN MUST NEVER LOOK LIKE IS A QUIET DOCKET.
 *
 * When a dashboard whose whole job is "what is due" fails, the dangerous
 * failure is not an ugly error page — it is a calm, empty one. This firm missed
 * a pretrial conference behind exactly that appearance, so this screen states,
 * in the first sentence, that the docket did not load and that nothing here
 * says anything about what is due. It shows no counts, no zeros and no
 * placeholder rows: there is nothing to count, and a `0` on this page would be
 * a lie with consequences.
 *
 * It also tells the attorney what to do while it is broken — check the docket
 * directly — rather than only offering a retry button, because a retry that
 * keeps failing must not be the end of the advice.
 *
 * Error boundaries must be client components; that is why this file is the only
 * `"use client"` one on the Today screen. `error.digest` is the server-side
 * correlation id Next.js attaches to a redacted production error, so it is
 * shown: it is the only thing that connects this screen to a server log, and
 * unlike a stack trace it leaks nothing about the firm's data.
 */

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side console only. Production error messages are redacted by Next
    // before they reach the browser, so this is a breadcrumb for a developer
    // sitting with her, not a substitute for server logging.
    console.error("Today screen failed to render", error);
  }, [error]);

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-4 px-4 py-10">
      <div className="grid gap-3 rounded-[var(--r-lg)] border border-overdue-border bg-overdue-bg p-6">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-overdue">
          Docket unavailable
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          This screen did not load
        </h1>
        <p className="text-sm leading-relaxed text-ink-2">
          Something failed on the way to your deadlines, so <strong>nothing on this page
          tells you what is due</strong>. This is not an empty docket — it is a broken screen.
          Until it loads, check the court docket and your own calendar directly for anything
          due today or this week.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={reset}
            className="rounded-[var(--r-sm)] bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Try again
          </button>
          <Link
            href="/calendar/"
            className="rounded-[var(--r-sm)] border border-border-strong px-4 py-2.5 text-sm font-semibold text-ink-2 outline-offset-2 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Open the calendar
          </Link>
          <Link
            href="/sign-in/"
            className="rounded-[var(--r-sm)] border border-border-strong px-4 py-2.5 text-sm font-semibold text-ink-2 outline-offset-2 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Sign in again
          </Link>
        </div>
      </div>

      <p className="text-xs text-muted">
        If it keeps failing, quote this reference:{" "}
        <span className="font-mono text-ink-2">{error.digest ?? "no reference recorded"}</span>
      </p>
    </main>
  );
}
