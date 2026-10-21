import { listMatters } from "./matters";
import { matterLabel } from "./docket-summary";

export type LeadMatter = {
  id: string;
  matterNumber: string;
  label: string;
  /** "3. Awaiting filing", or "No stage" for a matter not placed on the docket. */
  stageLabel: string;
};

/**
 * Three states, never two: `ok` (one or more matters), `none` (the read worked
 * and the lead has no matter) and `unavailable` (the read failed). The lead
 * page's "Matters" line says "No matters yet." only for `none`.
 */
export type LeadMattersRead =
  | { status: "ok"; matters: LeadMatter[] }
  | { status: "none" }
  | { status: "unavailable" };

/**
 * Every matter whose lead_id is this lead, newest first, read through the
 * caller's scoped client (another firm's matters are invisible). Never throws:
 * a failed read is `unavailable` so it can't break the rest of the lead page or
 * read as "none".
 */
export async function loadMattersForLead(leadId: string): Promise<LeadMattersRead> {
  try {
    const matters = await listMatters({ leadId });
    if (matters.length === 0) return { status: "none" };
    return {
      status: "ok",
      matters: matters.map((m) => ({
        id: m.id,
        matterNumber: m.matter_number,
        label: matterLabel(m),
        stageLabel: m.stage ? `${m.stage.code}. ${m.stage.label}` : "No stage",
      })),
    };
  } catch (err) {
    console.error("[lead-matters] could not load the lead's matters", err);
    return { status: "unavailable" };
  }
}
