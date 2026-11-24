import type { LeadSet, WorkingResult, DegradedSource } from "./working";

/**
 * The Leads page's sets as DATA the browser can use. PURE and serialisable (the classifier's `byLead` is a Map, which
 * cannot cross from the server page to the client workspace). The server turns the classifier's answer into `SetData`
 * once; the workspace only reads it.
 *
 * A lead's bucket here is exactly what the set rule decided (rules in working.ts). `uncertain` leads (a source could
 * not be read) are listed by the Working set as well, so the chip count is `workingShown`, never `working`.
 * With the Working rule unavailable every lead is `open` or `nurture` by its stage alone, and the three Working sets
 * are shown as All open (`drawnSet`).
 */
export type SetBucket = "working" | "event" | "not_started" | "open" | "nurture" | "other";

export type SetCounts = { working: number; event: number; notStarted: number; open: number; nurture: number };

export type SetData = {
  status: "ok" | "unavailable";
  bucketByLead: Record<string, SetBucket>;
  /** Event / Not started leads that a down source might make Working; the Working set lists them. */
  uncertain: string[];
  counts: SetCounts;
  degraded: DegradedSource[];
  splitApproximate: boolean;
};

export function setDataFrom(
  result: WorkingResult,
  leads: ReadonlyArray<{ id: string; current_stage_id: string | null }>,
  stageCategory: (stageId: string | null) => string | null,
): SetData {
  const bucketByLead: Record<string, SetBucket> = {};
  const uncertain: string[] = [];
  if (result.status === "unavailable") {
    for (const l of leads) {
      const c = stageCategory(l.current_stage_id);
      bucketByLead[l.id] = c === "open" ? "open" : c === "nurture" ? "nurture" : "other";
    }
    return {
      status: "unavailable",
      bucketByLead,
      uncertain,
      counts: { working: 0, event: 0, notStarted: 0, open: result.counts.open, nurture: result.counts.nurture },
      degraded: [],
      splitApproximate: false,
    };
  }
  for (const l of leads) {
    const b = result.byLead.get(l.id);
    if (!b) bucketByLead[l.id] = "other";
    else if (b.kind === "working") bucketByLead[l.id] = "working";
    else if (b.kind === "event") bucketByLead[l.id] = "event";
    else if (b.kind === "not_started") bucketByLead[l.id] = "not_started";
    else bucketByLead[l.id] = b.as === "nurture" ? "nurture" : "other";
    if (b && (b.kind === "event" || b.kind === "not_started") && b.uncertain) uncertain.push(l.id);
  }
  const c = result.counts;
  return {
    status: "ok",
    bucketByLead,
    uncertain,
    counts: { working: c.workingShown, event: c.eventContacts, notStarted: c.notStarted, open: c.open, nurture: c.nurture },
    degraded: result.degraded,
    splitApproximate: result.splitApproximate,
  };
}

/** Is the lead in this set? (Lost is never here: lost leads are their own read.) */
export function inSet(data: SetData, leadId: string, set: LeadSet): boolean {
  const b = data.bucketByLead[leadId];
  if (!b || set === "lost") return false;
  if (data.status === "unavailable") return set === "nurture" ? b === "nurture" : b === "open";
  switch (set) {
    case "working":
      return b === "working" || data.uncertain.includes(leadId);
    case "event":
      return b === "event";
    case "not-started":
      return b === "not_started";
    case "open":
      return b === "working" || b === "event" || b === "not_started";
    case "nurture":
      return b === "nurture";
  }
}

/** The set to draw: the asked one, or All open when Working could not be computed. */
export function drawnSet(data: SetData, asked: LeadSet): LeadSet {
  return data.status === "unavailable" && (asked === "working" || asked === "event" || asked === "not-started") ? "open" : asked;
}

/** Rows (anything with `lead.id`) that belong to the set. Lost rows come from their own read and are all in. */
export function rowsInSet<T extends { lead: { id: string } }>(rows: readonly T[], data: SetData, set: LeadSet): T[] {
  if (set === "lost") return [...rows];
  const uncertain = new Set(data.uncertain);
  return rows.filter((r) => {
    const b = data.bucketByLead[r.lead.id];
    if (!b) return false;
    if (data.status === "unavailable") return set === "nurture" ? b === "nurture" : b === "open";
    if (set === "working") return b === "working" || uncertain.has(r.lead.id);
    return inSet(data, r.lead.id, set);
  });
}

/**
 * Did a stage move take this lead OUT of the set it was listed in? (Membership is frozen until the page reloads, so the
 * row stays; it gets a quiet "Moved" mark instead.) `bucket` is where it was listed, `category` its new stage's category,
 * `past` whether the new stage is past first contact.
 *   open / Working / Nurture / Lost: leaves unless the new stage is of the set's kind (open, open, nurture, lost)
 *   Event contacts / Not started: also leaves when it moves past first contact (it is Working now)
 */
export function leavesSet(set: LeadSet, category: string | null | undefined, past: boolean): boolean {
  switch (set) {
    case "open":
    case "working":
      return category !== "open";
    case "event":
    case "not-started":
      return category !== "open" || past;
    case "nurture":
      return category !== "nurture";
    case "lost":
      return category !== "lost";
  }
}

export type LostRead = { status: "ok"; count: number } | { status: "unavailable" } | { status: "none" };

export type SetChip = { set: LeadSet; label: string; count: number | null; active: boolean };

export const SET_LABEL: Record<LeadSet, string> = {
  working: "Working",
  event: "Event contacts",
  "not-started": "Not started",
  open: "All open",
  nurture: "Nurture",
  lost: "Lost",
};

/**
 * The chips, in order, each with its count. A chip with no leads is hidden (except the chosen one, so the chosen set is
 * always visible). Lost: no number when its count could not be read (the chip still shows, and the page says so when
 * it is opened); hidden when the firm has no lost stage or no lost leads.
 */
export function setChips(data: SetData, lost: LostRead, chosen: LeadSet, nurtureUnavailable = false): SetChip[] {
  const n = data.counts;
  const unavailable = data.status === "unavailable";
  const all: SetChip[] = [
    { set: "working", label: SET_LABEL.working, count: n.working, active: chosen === "working" },
    { set: "event", label: SET_LABEL.event, count: n.event, active: chosen === "event" },
    { set: "not-started", label: SET_LABEL["not-started"], count: n.notStarted, active: chosen === "not-started" },
    { set: "open", label: SET_LABEL.open, count: n.open, active: chosen === "open" },
    { set: "nurture", label: SET_LABEL.nurture, count: nurtureUnavailable ? null : n.nurture, active: chosen === "nurture" },
    { set: "lost", label: SET_LABEL.lost, count: lost.status === "ok" ? lost.count : null, active: chosen === "lost" },
  ];
  return all.filter((c) => {
    if (c.active) return true;
    // With Working unreadable the three Working chips have no honest number: they are not offered at all.
    if (unavailable && (c.set === "working" || c.set === "event" || c.set === "not-started")) return false;
    if (c.set === "nurture" && nurtureUnavailable) return true;
    if (c.set === "lost") return lost.status === "unavailable" || (lost.status === "ok" && lost.count > 0);
    return (c.count ?? 0) > 0;
  });
}

/** Add leads that only the nurture read reached: each is in the Nurture set, and the Nurture chip counts them. */
export function withNurtureExtra(data: SetData, extraIds: readonly string[]): SetData {
  if (extraIds.length === 0) return data;
  const bucketByLead = { ...data.bucketByLead };
  for (const id of extraIds) bucketByLead[id] = "nurture";
  return { ...data, bucketByLead, counts: { ...data.counts, nurture: data.counts.nurture + extraIds.length } };
}

/** Every row as open or nurture by its stage, with the Working rule unavailable: what a caller with no set data gets. */
export function allOpenData(rows: ReadonlyArray<{ lead: { id: string; current_stage_id: string } }>, stages: ReadonlyArray<{ id: string; category: string }>): SetData {
  const cat = new Map(stages.map((s) => [s.id, s.category]));
  const bucketByLead: Record<string, SetBucket> = {};
  let open = 0;
  let nurture = 0;
  for (const r of rows) {
    const c = cat.get(r.lead.current_stage_id);
    bucketByLead[r.lead.id] = c === "nurture" ? "nurture" : "open";
    if (c === "nurture") nurture++;
    else open++;
  }
  return { status: "unavailable", bucketByLead, uncertain: [], counts: { working: 0, event: 0, notStarted: 0, open, nurture }, degraded: [], splitApproximate: false };
}
