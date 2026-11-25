import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { leadRead } from "@/lib/leads/live";
import type { StageKind } from "./manage";

/**
 * What each stage HOLDS, for the owner's delete dialog: the ids of every live lead (merged leads left out, as lectual 0119's
 * `crm_stage_delete` counts them) or every matter (any status) in each stage. The dialog shows the count and sends these ids back
 * unchanged (`p_expected_ids`); the database refuses when they changed. Read only for an owner, through the scoped client, paged
 * past PostgREST's 1,000-row cap. Two states: ok, or unavailable (any page failed or the page budget ran out): a stage whose holdings
 * can't be read is never offered for deletion, and is never shown as empty.
 */
export type StageHoldings = { status: "ok"; byStage: Record<string, string[]> } | { status: "unavailable" };

const PAGE = 1000;
const MAX_PAGES = 50;

type Row = { id?: unknown; current_stage_id?: unknown; stage_id?: unknown };
type Page = PromiseLike<{ data: Row[] | null; error: unknown }>;

export async function loadStageHoldings(kind: StageKind): Promise<StageHoldings> {
  try {
    const db = await getScopedClient();
    const byStage: Record<string, string[]> = {};
    const column = kind === "lead" ? "current_stage_id" : "stage_id";
    for (let i = 0; i < MAX_PAGES; i++) {
      const from = i * PAGE;
      const to = from + PAGE - 1;
      const { data, error } =
        kind === "lead"
          ? await leadRead(({ live }) =>
              live(db.from("crm_lead").select("id, current_stage_id").not("current_stage_id", "is", null)).order("id").range(from, to) as unknown as Page,
            )
          : await (db.from("crm_matter").select("id, stage_id").not("stage_id", "is", null).order("id").range(from, to) as unknown as Page);
      if (error || !data) return { status: "unavailable" };
      for (const row of data) {
        const stage = row[column as keyof Row];
        if (typeof row.id !== "string" || typeof stage !== "string") continue;
        (byStage[stage] ??= []).push(row.id);
      }
      if (data.length < PAGE) return { status: "ok", byStage };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
