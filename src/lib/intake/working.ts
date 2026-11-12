import { normalizeStageName } from "@/lib/lawmatics/stage-map";
import { newEnquiryStage } from "@/lib/pipeline/new-enquiry";
import { compareStageOrder } from "@/lib/pipeline/stage-order";

/**
 * The Leads page's "Working" rule (item L). PURE: no client, no clock, no server-only import, so the
 * page, the tests and a client component can all call it.
 *
 * Only leads in OPEN-category stages are sorted into Working / Event contacts / Not started. A lead
 * in a lost, nurture or won stage (or in a stage the stage list does not know) is `closed` and is in
 * none of the three. Within the open leads, in this order:
 *
 *   WORKING        any one of
 *     - real activity: an email sent or received, a logged call, a note or a voice note, or a stage
 *       move a PERSON made (the loader decides which; it reports a lead id only);
 *     - past first contact: the lead's stage sits strictly after the new-enquiry stage AND strictly
 *       after every open Follow-Up stage, in pipeline order (`firstContactBoundary`);
 *     - a pending approval for the lead;
 *     - a live proposal (the newest version of a family is sent or accepted);
 *     - a booked consult (a future Outlook consult linked to the lead).
 *   EVENT CONTACT  open, not Working, and its source is UGW or Event, or it has a booth scorecard.
 *   NOT STARTED    open, not Working, not an Event contact.
 *
 * What does NOT make a lead Working: being created, an AI insight, a booth scorecard, an importer or
 * agent row, and `last_activity_at` (the import stamps it). Those never reach this module: it is
 * handed lead ids per fact, never timestamps.
 *
 * THREE-STATE, never two. Every fact source is `ok`, `skipped` (the source cannot exist for this firm,
 * e.g. the Mailboxes feature is off: equals an empty set) or `unavailable` (the read failed):
 *   - ACTIVITY unavailable: Working cannot be computed at all. The result is `{ status: "unavailable" }`
 *     naming the source; the page shows All with a note, never an empty Working list.
 *   - APPROVALS / PROPOSALS / CONSULTS unavailable: Working can still be computed from the rest, but a
 *     lead that is not otherwise Working might be Working on the unread basis. Fail toward SHOWING: such
 *     a lead keeps its honest bucket (event / not_started) and gets `uncertain: true`, and
 *     `inWorkingView` lists it in the Working view. `degraded` names the sources for the note.
 *   - BOOTH unavailable: only the Event / Not started split is affected; `splitApproximate` is set, the
 *     source is named in `degraded`, and nobody moves in or out of Working.
 */

export type WorkingLead = {
  id: string;
  current_stage_id: string | null;
  referral_source: string | null;
};

export type WorkingStage = {
  id: string;
  name: string;
  category?: string | null;
  order_index: number | null;
};

export type FactSet =
  | { status: "ok"; leadIds: ReadonlySet<string> }
  | { status: "skipped" }
  | { status: "unavailable" };

export type WorkingFacts = {
  /** Real activity: email, call, note, voice note, a stage move a person made. */
  activity: FactSet;
  approvals: FactSet;
  /** Leads with a live proposal (see `leadsWithLiveProposal`). */
  proposals: FactSet;
  /** Leads with a booked (future) consult. */
  consults: FactSet;
  /** Leads with a booth scorecard row. */
  booth: FactSet;
};

export type FactSource = keyof WorkingFacts;
export type WorkingReason = "activity" | "stage" | "approval" | "proposal" | "consult";
export type ClosedAs = "lost" | "nurture" | "won" | "unknown";

export type LeadBucket =
  | { kind: "working"; reasons: WorkingReason[] }
  | { kind: "event"; viaSource: boolean; viaBooth: boolean; uncertain: boolean }
  | { kind: "not_started"; uncertain: boolean }
  | { kind: "closed"; as: ClosedAs };

export type WorkingCounts = {
  /** Confirmed Working. */
  working: number;
  /** What the Working set lists: confirmed Working plus the uncertain ones (a source was down). The chip shows this. */
  workingShown: number;
  eventContacts: number;
  notStarted: number;
  /** Event or Not started leads that might be Working on a source that could not be read. */
  uncertain: number;
  /** Working + Event contacts + Not started: every lead in an open stage. */
  open: number;
  nurture: number;
  lost: number;
  won: number;
  /** In a stage the stage list does not hold (or with no stage), or one of an unknown category. */
  noStage: number;
  /** open + nurture: exactly the leads the Leads page lists today (`intakeStages`). */
  inScope: number;
};

export type DegradedSource = "approvals" | "proposals" | "consults" | "booth";

export type WorkingResult =
  | {
      status: "ok";
      byLead: ReadonlyMap<string, LeadBucket>;
      counts: WorkingCounts;
      /** Optional sources that could not be read; the page names them. */
      degraded: DegradedSource[];
      /** The Event / Not started split could not use the booth source. */
      splitApproximate: boolean;
    }
  | {
      status: "unavailable";
      failed: "activity"[];
      counts: Pick<WorkingCounts, "open" | "nurture" | "lost" | "won" | "noStage" | "inScope">;
    };

// Anchored like the weekly review's rule (src/lib/review/build.ts): "Post Consultation Follow Up" is a late stage, not Follow-Up.
const FOLLOW_UP = /^follow ?up\b/;

/** A Follow-Up stage by name (spelling and punctuation ignored: "Follow-Up", "4. Follow up"). */
export function isFollowUpStage(stage: Pick<WorkingStage, "name">): boolean {
  return FOLLOW_UP.test(normalizeStageName(String(stage.name ?? "")));
}

/**
 * The pipeline position a lead must be STRICTLY beyond to count as "past first contact": the furthest
 * of the new-enquiry stage and every open Follow-Up stage, in pipeline order (`compareStageOrder`).
 * Null when the firm has no open stage at all. Positions are indexes into the whole stage list in
 * pipeline order, so lost / won stages never shift the comparison.
 */
export function firstContactBoundary(stages: readonly WorkingStage[]): { stageId: string; position: number } | null {
  const ordered = [...stages].sort(compareStageOrder);
  const position = new Map(ordered.map((s, i) => [s.id, i]));
  const enquiry = newEnquiryStage(stages);
  if (!enquiry) return null;
  let at = position.get(enquiry.id) ?? 0;
  let id = enquiry.id;
  for (const s of ordered) {
    const p = position.get(s.id) ?? -1;
    if (s.category === "open" && isFollowUpStage(s) && p > at) {
      at = p;
      id = s.id;
    }
  }
  return { stageId: id, position: at };
}

/** Is this stage id an open stage strictly beyond first contact? */
export function isPastFirstContact(stageId: string | null, stages: readonly WorkingStage[]): boolean {
  if (!stageId) return false;
  const boundary = firstContactBoundary(stages);
  if (!boundary) return false;
  const ordered = [...stages].sort(compareStageOrder);
  const at = ordered.findIndex((s) => s.id === stageId);
  return at > boundary.position && ordered[at].category === "open";
}

export type ProposalRowIn = { family_id: string; version: number; status: string; lead_id: string | null };

/**
 * Leads with a live proposal: the NEWEST version of a family is `sent` (the link opens) or `accepted`.
 * Older versions, drafts, withdrawn and replaced ones do not count. (Accepted is included beyond the
 * `sent`-only wording of the brief: a client who accepted is further along than one who was sent a link.)
 */
export function leadsWithLiveProposal(rows: readonly ProposalRowIn[]): Set<string> {
  const newest = new Map<string, ProposalRowIn>();
  for (const r of rows) {
    const cur = newest.get(r.family_id);
    if (!cur || r.version > cur.version) newest.set(r.family_id, r);
  }
  const out = new Set<string>();
  for (const r of newest.values()) if (r.lead_id && (r.status === "sent" || r.status === "accepted")) out.add(r.lead_id);
  return out;
}

/** "UGW" or "Event" as stored (the referral bucket), case and surrounding space ignored. */
export function isEventSource(source: string | null | undefined): boolean {
  const s = String(source ?? "").trim().toLowerCase();
  return s === "ugw" || s === "event";
}

function has(set: FactSet, id: string): boolean {
  return set.status === "ok" && set.leadIds.has(id);
}

function closedAs(category: string | null | undefined): ClosedAs {
  return category === "lost" || category === "nurture" || category === "won" ? category : "unknown";
}

export function classifyLeads(input: {
  leads: readonly WorkingLead[];
  stages: readonly WorkingStage[];
  facts: WorkingFacts;
}): WorkingResult {
  const { leads, stages, facts } = input;
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const base = { open: 0, nurture: 0, lost: 0, won: 0, noStage: 0 };
  const openLeads: WorkingLead[] = [];
  const byLead = new Map<string, LeadBucket>();
  for (const lead of leads) {
    const stage = lead.current_stage_id ? stageById.get(lead.current_stage_id) : undefined;
    if (!stage) {
      base.noStage++;
      byLead.set(lead.id, { kind: "closed", as: "unknown" });
    } else if (stage.category === "open") {
      base.open++;
      openLeads.push(lead);
    } else {
      const as = closedAs(stage.category);
      if (as === "nurture") base.nurture++;
      else if (as === "lost") base.lost++;
      else if (as === "won") base.won++;
      else base.noStage++;
      byLead.set(lead.id, { kind: "closed", as });
    }
  }
  const inScope = base.open + base.nurture;

  if (facts.activity.status === "unavailable") {
    return { status: "unavailable", failed: ["activity"], counts: { ...base, inScope } };
  }

  const boundary = firstContactBoundary(stages);
  const ordered = [...stages].sort(compareStageOrder);
  const positionOf = new Map(ordered.map((s, i) => [s.id, i]));

  const degraded = (["approvals", "proposals", "consults", "booth"] as const).filter((k) => facts[k].status === "unavailable");
  const workingSourcesDown = degraded.some((k) => k !== "booth");
  const splitApproximate = degraded.includes("booth");

  let working = 0;
  let eventContacts = 0;
  let notStarted = 0;
  let uncertain = 0;

  for (const lead of openLeads) {
    const reasons: WorkingReason[] = [];
    if (has(facts.activity, lead.id)) reasons.push("activity");
    const pos = lead.current_stage_id ? positionOf.get(lead.current_stage_id) : undefined;
    if (boundary && pos !== undefined && pos > boundary.position) reasons.push("stage");
    if (has(facts.approvals, lead.id)) reasons.push("approval");
    if (has(facts.proposals, lead.id)) reasons.push("proposal");
    if (has(facts.consults, lead.id)) reasons.push("consult");

    if (reasons.length > 0) {
      byLead.set(lead.id, { kind: "working", reasons });
      working++;
      continue;
    }
    const viaSource = isEventSource(lead.referral_source);
    const viaBooth = has(facts.booth, lead.id);
    if (workingSourcesDown) uncertain++;
    if (viaSource || viaBooth) {
      byLead.set(lead.id, { kind: "event", viaSource, viaBooth, uncertain: workingSourcesDown });
      eventContacts++;
    } else {
      byLead.set(lead.id, { kind: "not_started", uncertain: workingSourcesDown });
      notStarted++;
    }
  }

  return {
    status: "ok",
    byLead,
    counts: { working, workingShown: working + uncertain, eventContacts, notStarted, uncertain, ...base, inScope },
    degraded,
    splitApproximate,
  };
}

/** The Leads page's sets, as the URL names them (`?set=`). */
export type LeadSet = "working" | "event" | "not-started" | "open" | "nurture" | "lost";
export const LEAD_SETS: readonly LeadSet[] = ["working", "event", "not-started", "open", "nurture", "lost"];

/** The set when the URL names none or an unknown one. */
export const DEFAULT_LEAD_SET: LeadSet = "working";

export function parseLeadSet(value: string | null | undefined): LeadSet {
  return (LEAD_SETS as readonly string[]).includes(value ?? "") ? (value as LeadSet) : DEFAULT_LEAD_SET;
}

/**
 * Is this lead listed in this set? "Working" also lists the uncertain ones (fail toward showing). "All open" is
 * every open-stage lead; "Nurture" the leads in a nurture stage. "Lost" is never answered here: lost leads are not
 * in the page's list at all and have their own read. With the Working rule unavailable the three Working sets are
 * "All open" (`effectiveSet`), and membership then follows stage category alone (`stageCategory`).
 */
export function inLeadSet(result: WorkingResult, leadId: string, set: LeadSet, stageCategory?: string | null): boolean {
  if (set === "lost") return false;
  if (result.status === "unavailable") return set === "nurture" ? stageCategory === "nurture" : stageCategory === "open";
  const b = result.byLead.get(leadId);
  if (!b) return false;
  switch (set) {
    case "working":
      return b.kind === "working" || ((b.kind === "event" || b.kind === "not_started") && b.uncertain);
    case "event":
      return b.kind === "event";
    case "not-started":
      return b.kind === "not_started";
    case "open":
      return b.kind === "working" || b.kind === "event" || b.kind === "not_started";
    case "nurture":
      return b.kind === "closed" && b.as === "nurture";
  }
}

/** The set the page should actually draw: the one asked for, or All open when Working could not be computed. */
export function effectiveSet(result: WorkingResult, asked: LeadSet): LeadSet {
  return result.status === "unavailable" && (asked === "working" || asked === "event" || asked === "not-started") ? "open" : asked;
}
