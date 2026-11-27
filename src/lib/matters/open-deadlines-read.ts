import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { openDeadlineIndex, type OpenDeadlineIndex } from "./deadline-safety";

/**
 * Which of the given matters hold at least one OPEN docket entry, and which hold an open Section 8 / Section 9 one (a
 * registered mark's flag, Taylor Nov 23). Scoped client only (RLS keeps it to the caller's firm), `matter_id` and `kind`
 * only, in chunks of 80 ids and paged past the 1,000-row cap.
 *
 * Two states: `ok` with the set, or `unavailable`. A failed read is never an empty set: the "No open deadline"
 * flag reads `unavailable` as "unknown" and flags nothing (deadline-safety.ts).
 */
export type OpenDeadlineIds = { status: "ok"; ids: OpenDeadlineIndex } | { status: "unavailable" };

const CHUNK = 80;
const PAGE = 1000;
const PAGES = 20;

export async function loadOpenDeadlineMatterIds(matterIds: readonly string[]): Promise<OpenDeadlineIds> {
  const rows: { matter_id: string; kind: string }[] = [];
  if (matterIds.length === 0) return { status: "ok", ids: openDeadlineIndex([]) };
  try {
    const supabase = await getScopedClient();
    for (let i = 0; i < matterIds.length; i += CHUNK) {
      const chunk = matterIds.slice(i, i + CHUNK);
      for (let p = 0; ; p += 1) {
        if (p >= PAGES) return { status: "unavailable" };
        const { data, error } = await supabase
          .from("crm_matter_deadline")
          .select("matter_id, kind")
          .eq("status", "open")
          .in("matter_id", chunk)
          .order("id")
          .range(p * PAGE, p * PAGE + PAGE - 1);
        if (error) return { status: "unavailable" };
        const page = data ?? [];
        for (const r of page) rows.push({ matter_id: r.matter_id, kind: String(r.kind) });
        if (page.length < PAGE) break;
      }
    }
    return { status: "ok", ids: openDeadlineIndex(rows) };
  } catch {
    return { status: "unavailable" };
  }
}
