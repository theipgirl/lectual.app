import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import type { Role } from "@/lib/auth/roles";
import { LEADS_COMPARE_FAILED } from "@/lib/ui/words";
import { shapeCompareSide, type CompareData, type CompareStage, type CompareLeadInput, type CompareSide, type CountRead } from "./compare";

/**
 * Reads the two leads of a "Possible duplicate" and what is on file for each, then shapes them (compare.ts). Every read is
 * injected, so the rules are tested without a database; the action in actions.ts wires the scoped client. Nothing is written.
 *
 *   - a lead that can't be read at all fails the whole panel with one fixed sentence (never half a comparison);
 *   - a lead that isn't there (another firm's id reads the same as a deleted one) is "gone";
 *   - each count is its own read: a failed one is `unavailable` and is worded "Couldn't load", never 0;
 *   - proposals are counted only for a firm that has the feature; a module list that can't be read counts as off (fails closed).
 */
export type CompareLeadRow = CompareLeadInput & { current_stage_id: string | null };

export type CompareDeps = {
  readLead: (id: string) => Promise<CompareLeadRow | null>;
  readStageName: (stageId: string) => Promise<string | null>;
  count: (table: "crm_activity" | "crm_task" | "client_proposal", leadId: string) => Promise<number>;
  proposalsOn: () => Promise<boolean>;
  /** The Created date is worded like the weekly review Sheet, on the firm's calendar day. */
  now: Date;
  timeZone: string;
  /** False for the roles that may not see an email address: it is left out of both sides. */
  showEmail: boolean;
};

export type CompareResult = { ok: true; data: CompareData } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function counted(read: () => Promise<number>): Promise<CountRead> {
  try {
    const count = await read();
    return Number.isFinite(count) && count >= 0 ? { status: "ok", count } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

async function readStage(stageId: string | null, deps: CompareDeps): Promise<CompareStage> {
  if (!stageId) return { status: "none" };
  try {
    const name = await deps.readStageName(stageId);
    // A stage row that isn't there (deleted) is not a failed read.
    return name ? { status: "ok", name } : { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}

async function side(id: string, deps: CompareDeps, proposals: boolean): Promise<CompareSide> {
  const lead = await deps.readLead(id);
  if (!lead) return { status: "gone", id };
  const [stage, timeline, tasks, proposalCount] = await Promise.all([
    readStage(lead.current_stage_id, deps),
    counted(() => deps.count("crm_activity", id)),
    counted(() => deps.count("crm_task", id)),
    proposals ? counted(() => deps.count("client_proposal", id)) : Promise.resolve<CountRead>({ status: "off" }),
  ]);
  return shapeCompareSide(lead, stage, { timeline, tasks, proposals: proposalCount }, { now: deps.now, timeZone: deps.timeZone, showEmail: deps.showEmail });
}

export async function loadCompare(aId: string, bId: string, deps: CompareDeps): Promise<CompareResult> {
  if (typeof aId !== "string" || typeof bId !== "string" || !UUID.test(aId) || !UUID.test(bId) || aId === bId) return { ok: false, error: LEADS_COMPARE_FAILED };
  try {
    const proposals = await deps.proposalsOn().catch(() => false);
    const [a, b] = await Promise.all([side(aId, deps, proposals), side(bId, deps, proposals)]);
    return { ok: true, data: { a, b } };
  } catch {
    return { ok: false, error: LEADS_COMPARE_FAILED };
  }
}

/**
 * What the caller's role allows in the comparison. The Proposals row is counted only for the proposals roles (lectual 0089's list,
 * `PROPOSAL_STAFF_WRITE_ROLES`); any other role gets no Proposals row at all, never a 0. viewer and social_media see no email address.
 */
export function compareRoleRules(role: Role): { showEmail: boolean; mayCountProposals: boolean } {
  return { showEmail: role !== "viewer" && role !== "social_media", mayCountProposals: PROPOSAL_STAFF_WRITE_ROLES.includes(role) };
}
