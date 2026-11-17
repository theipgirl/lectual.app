import { sheetDay } from "./views";
import { LEADS_COMPARE_COULDNT_LOAD, LEADS_COMPARE_FIELDS } from "@/lib/ui/words";

/**
 * The data behind the "Possible duplicate" compare panel: two leads side by side, with what is on file for each. PURE: the
 * server action (actions.ts) reads, this shapes and words it. Nothing is merged or changed by looking.
 *
 * A count is read on its own and has THREE states plus one: ok / unavailable (a failed read says "Couldn't load", never 0) /
 * off (the firm doesn't have that feature, so the row is left out rather than shown as 0).
 */
export type CountRead = { status: "ok"; count: number } | { status: "unavailable" } | { status: "off" };

export type CompareLeadInput = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  mark_text: string | null;
  email: string | null;
  referral_source: string | null;
  created_at: string | null;
};

export type CompareSide =
  | { status: "ok"; id: string; name: string; business: string; email: string; stage: string; source: string; created: string; timeline: CountRead; tasks: CountRead; proposals: CountRead }
  | { status: "gone"; id: string };

export type CompareData = { a: CompareSide; b: CompareSide };

const DASH = "—";

const clean = (v: string | null | undefined) => (v ?? "").trim();

/** The stage read: a lead with no stage is "—"; a read that failed is "Couldn't load" (never the same as no stage). */
export type CompareStage = { status: "ok"; name: string } | { status: "none" } | { status: "unavailable" };

export function shapeCompareSide(lead: CompareLeadInput, stage: CompareStage, counts: { timeline: CountRead; tasks: CountRead; proposals: CountRead }, dates: { now: Date; timeZone?: string }): CompareSide {
  const name = `${clean(lead.first_name)} ${clean(lead.last_name)}`.trim() || clean(lead.email) || DASH;
  return {
    status: "ok",
    id: lead.id,
    name,
    business: clean(lead.mark_text) || clean(lead.business_name) || DASH,
    email: clean(lead.email) || DASH,
    stage: stage.status === "ok" ? stage.name : stage.status === "none" ? DASH : LEADS_COMPARE_COULDNT_LOAD,
    source: clean(lead.referral_source) || DASH,
    created: sheetDay(lead.created_at, dates.now, dates.timeZone) ?? DASH,
    ...counts,
  };
}

export function countText(read: CountRead): string {
  if (read.status === "ok") return String(read.count);
  return LEADS_COMPARE_COULDNT_LOAD;
}

/** Only these are marked "same": equal counts or dates say nothing about whether two leads are one person. */
const IDENTITY: ReadonlySet<string> = new Set(["name", "business", "email", "source"]);

export type CompareRow = { key: keyof typeof LEADS_COMPARE_FIELDS; label: string; a: string; b: string; same: boolean; failed: boolean };

/** The rows to draw. A row where both sides read the same is marked, so the eye goes to the differences. Proposals are left out when the firm doesn't have them. */
export function compareRows(a: Extract<CompareSide, { status: "ok" }>, b: Extract<CompareSide, { status: "ok" }>): CompareRow[] {
  const row = (key: CompareRow["key"], av: string, bv: string, failed = false): CompareRow => ({
    key,
    label: LEADS_COMPARE_FIELDS[key],
    a: av,
    b: bv,
    same: IDENTITY.has(key) && !failed && av.toLowerCase() === bv.toLowerCase() && av !== DASH,
    failed,
  });
  const rows: CompareRow[] = [
    row("name", a.name, b.name),
    row("business", a.business, b.business),
    row("email", a.email, b.email),
    row("stage", a.stage, b.stage, a.stage === LEADS_COMPARE_COULDNT_LOAD || b.stage === LEADS_COMPARE_COULDNT_LOAD),
    row("source", a.source, b.source),
    row("created", a.created, b.created),
    row("timeline", countText(a.timeline), countText(b.timeline), a.timeline.status !== "ok" || b.timeline.status !== "ok"),
    row("tasks", countText(a.tasks), countText(b.tasks), a.tasks.status !== "ok" || b.tasks.status !== "ok"),
  ];
  if (a.proposals.status !== "off" && b.proposals.status !== "off") {
    rows.push(row("proposals", countText(a.proposals), countText(b.proposals), a.proposals.status !== "ok" || b.proposals.status !== "ok"));
  }
  return rows;
}
