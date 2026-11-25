import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { leadRead } from "@/lib/leads/live";
import type { StageKind } from "./manage";

/**
 * What each stage HOLDS, for the owner's delete dialog: the ids of every live lead (merged leads only COUNTED, as lectual 0119's
 * `crm_stage_delete` counts them) or every matter (any status) in each stage. The dialog shows the count and sends these ids back
 * unchanged (`p_expected_ids`); the database refuses when they changed. Read only for an owner, through the scoped client, paged
 * past PostgREST's 1,000-row cap. Merged leads are COUNTED per stage, never listed. Two states: ok, or unavailable (any page failed or the page budget ran out): a stage whose holdings
 * can't be read is never offered for deletion, and is never shown as empty.
 */
export type StageHoldings =
  | {
      status: "ok";
      /** stage id -> the LIVE record ids (the dialog's `p_expected_ids`). */
      byStage: Record<string, string[]>;
      /** Lead stages only: stage id -> how many MERGED leads sit there. Never ids: 0119 moves them itself and never wants them sent. */
      merged: Record<string, number>;
    }
  | { status: "unavailable" };

const PAGE = 1000;
const MAX_PAGES = 50;

type Row = { id?: unknown; current_stage_id?: unknown; stage_id?: unknown; merged_into_id?: unknown };
type Page = PromiseLike<{ data: Row[] | null; error: unknown }>;

export async function loadStageHoldings(kind: StageKind): Promise<StageHoldings> {
  try {
    const db = await getScopedClient();
    const byStage: Record<string, string[]> = {};
    const merged: Record<string, number> = {};
    const column = kind === "lead" ? "current_stage_id" : "stage_id";
    for (let i = 0; i < MAX_PAGES; i++) {
      const from = i * PAGE;
      const to = from + PAGE - 1;
      // Leads are read WITHOUT the live filter: a merged lead still blocks a stage (0119 moves it with the others), so the dialog
      // must know it is there. Its pointer is read only to tell it apart; its id is never sent.
      const { data, error } =
        kind === "lead"
          ? await leadRead(({ merged: hasPointer }) =>
              // live-guard: reads merged leads WITH their pointer, only to count them per stage for the delete dialog
              db.from("crm_lead").select(hasPointer ? "id, current_stage_id, merged_into_id" : "id, current_stage_id").not("current_stage_id", "is", null).order("id").range(from, to) as unknown as Page,
            )
          : await (db.from("crm_matter").select("id, stage_id").not("stage_id", "is", null).order("id").range(from, to) as unknown as Page);
      if (error || !data) return { status: "unavailable" };
      for (const row of data) {
        const stage = row[column as keyof Row];
        if (typeof row.id !== "string" || typeof stage !== "string") continue;
        if (kind === "lead" && row.merged_into_id !== null && row.merged_into_id !== undefined) {
          merged[stage] = (merged[stage] ?? 0) + 1;
          continue;
        }
        (byStage[stage] ??= []).push(row.id);
      }
      if (data.length < PAGE) return { status: "ok", byStage, merged };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
