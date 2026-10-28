import { friendlyRunError } from "@/lib/agents/friendly-run-error";

/**
 * The "Result" text of one Recent runs row. A failed run never prints the stored error: it goes
 * through `friendlyRunError`, so a provider's message cannot reach the screen.
 */
export function runResultText(status: string, run: { summary: string | null; error: string | null }): string {
  if (status === "unfinished") return "Didn't finish. It was stopped before it could report back.";
  if (status === "error") return friendlyRunError(run.error);
  return run.summary ?? "—";
}

export function RunResultCell({ status, run, failed }: { status: string; run: { summary: string | null; error: string | null }; failed: boolean }) {
  return (
    <td className="wrap" style={failed ? { color: "var(--wine)" } : undefined}>
      {runResultText(status, run)}
    </td>
  );
}
