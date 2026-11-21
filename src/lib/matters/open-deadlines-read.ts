import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * Which of the given matters hold at least one OPEN docket entry. Scoped client only (RLS keeps it to the
 * caller's firm), `matter_id` only, in chunks of 80 ids and paged past the 1,000-row cap.
 *
 * Two states: `ok` with the set, or `unavailable`. A failed read is never an empty set: the "No open deadline"
 * flag reads `unavailable` as "unknown" and flags nothing (deadline-safety.ts).
 */
export type OpenDeadlineIds = { status: "ok"; ids: Set<string> } | { status: "unavailable" };

const CHUNK = 80;
const PAGE = 1000;
const PAGES = 20;

export async function loadOpenDeadlineMatterIds(matterIds: readonly string[]): Promise<OpenDeadlineIds> {
  const ids = new Set<string>();
  if (matterIds.length === 0) return { status: "ok", ids };
  try {
    const supabase = await getScopedClient();
    for (let i = 0; i < matterIds.length; i += CHUNK) {
      const chunk = matterIds.slice(i, i + CHUNK);
      for (let p = 0; ; p += 1) {
        if (p >= PAGES) return { status: "unavailable" };
        const { data, error } = await supabase
          .from("crm_matter_deadline")
          .select("matter_id")
          .eq("status", "open")
          .in("matter_id", chunk)
          .order("id")
          .range(p * PAGE, p * PAGE + PAGE - 1);
        if (error) return { status: "unavailable" };
        const rows = data ?? [];
        for (const r of rows) ids.add(r.matter_id);
        if (rows.length < PAGE) break;
      }
    }
    return { status: "ok", ids };
  } catch {
    return { status: "unavailable" };
  }
}
