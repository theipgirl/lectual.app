import { BUCKET_KEYS, bucketOf, type BucketKey, type ReviewRow } from "./buckets";

/**
 * The Monday agenda: the same rows as the board, dealt in the order the firm walks its pipeline in
 * the Monday meeting. Pure: rows in, ordered sections out.
 *
 *   1 New clients and consults     every LEAD. Leads never go anywhere else, and never to Parked, so nobody is
 *                                  forgotten (an on-track lead is still a person to follow up).
 *   2 Trademarks in progress       a TM / CR / PATENT matter before filing, or whose stage we can't read
 *   3 USPTO matters                a TM / CR / PATENT matter at or past filing (office action, publication, ...)
 *   4 Contracts and business       a matter of any other type (BL, LIT, EL, SO, ...)
 *   5 Parked                       nothing to do this week (see `agendaSection`)
 *
 * Stage names are classified by ONE keyword table (`STAGE_RULES`) and nothing else in the review reads a stage
 * name for the agenda. RPB's stages look like "10. Preparing Opinion Letter" or "19A. OA Issued"; the number
 * is only a fallback for a name no keyword reads.
 */

export type AgendaSection = "new-clients" | "tm-in-progress" | "uspto" | "contracts" | "parked";

export const AGENDA_SECTIONS: readonly AgendaSection[] = ["new-clients", "tm-in-progress", "uspto", "contracts", "parked"];

export const AGENDA_COPY: Record<AgendaSection, { label: string; hint: string }> = {
  "new-clients": { label: "New clients and consults", hint: "consults, proposals out, people deciding" },
  "tm-in-progress": { label: "Trademarks in progress", hint: "before filing: opinion letters, applications, waiting on the client" },
  uspto: { label: "USPTO matters", hint: "office actions first, then publication, allowance, statements of use, registration" },
  contracts: { label: "Contracts and business matters", hint: "everything that isn't a trademark, copyright or patent" },
  parked: { label: "Parked", hint: "nothing to do this week" },
};

/** The sections the meeting walks, in order. Parked is skipped in meeting mode. */
export const MEETING_SECTIONS: readonly AgendaSection[] = ["new-clients", "tm-in-progress", "uspto", "contracts"];

/** Matter types that are IP and follow the trademark docket. Any other type is "Contracts and business". */
export const IP_MATTER_TYPES: readonly string[] = ["TM", "CR", "PATENT"];

export type StageReading = "pre-filing" | "post-filing" | "unknown";

/**
 * THE keyword table for docket stage names (matched on the lowercased label). Checked top to bottom, the first
 * match wins, so the post-filing words come first: "20D. SOU Preparation" is a statement of use, not an
 * application being prepared.
 */
export const STAGE_RULES: readonly { reading: Exclude<StageReading, "unknown">; pattern: RegExp }[] = [
  { reading: "post-filing", pattern: /\boa\b|office action|publication|opposition|notice of allowance|\bnoa\b|statement of use|\bsou\b|extension|registration|registered|renewal|declaration|section (8|9|15)\b|application filed|with (the )?uspto/ },
  { reading: "pre-filing", pattern: /opinion letter|application prep|\bsearch|clearance|\bloe\b|engagement|deposit|signed|specimen|intake|consult/ },
];

/** The leading stage number of "19A. OA Issued" (19), or null. */
export function stageNumber(label: string): number | null {
  const m = /^\s*(\d{1,3})[A-Za-z]?\s*[.):-]/.exec(label);
  return m ? Number(m[1]) : null;
}

/** Keyword first; then the stage number (under 18 is before filing, 18 and over is at or past it); else unknown. */
export function readStage(label: string | null | undefined): StageReading {
  const text = String(label ?? "").toLowerCase();
  for (const rule of STAGE_RULES) if (rule.pattern.test(text)) return rule.reading;
  const n = stageNumber(text);
  if (n !== null) return n < 18 ? "pre-filing" : "post-filing";
  return "unknown";
}

/**
 * The section of one row. `today` is needed because "parked" is decided from the review bucket.
 *
 * Parked (matters only): the row's bucket is `track` (on track) OR, for a USPTO-section matter, `uspto`
 * (waiting on the office with nothing to do) AND the matter has no open docketed deadline. A matter with an open
 * deadline is never parked, so an office action response date can't be hidden in a collapsed section.
 * Leads are never parked.
 */
/**
 * A matter's stage: its docket code first ("19A" -> 19; 17 "Application Filed" and over is at or past filing, so
 * "20A. Specimen(s) Requested" is USPTO work), because the firm's labels carry no number. Else the label rules.
 */
export function readRowStage(row: Pick<ReviewRow, "stageCode" | "stageLabel">): StageReading {
  const m = /^\s*(\d{1,3})[A-Za-z]?\s*$/.exec(String(row.stageCode ?? ""));
  if (m) return Number(m[1]) < 17 ? "pre-filing" : "post-filing";
  return readStage(row.stageLabel);
}

export function agendaSection(row: ReviewRow, today: string): AgendaSection {
  if (row.kind === "lead") return "new-clients";
  const type = row.matterType ?? "TM";
  const ip = IP_MATTER_TYPES.includes(type);
  const home: AgendaSection = !ip ? "contracts" : readRowStage(row) === "post-filing" ? "uspto" : "tm-in-progress";
  if (row.deadline) return home;
  const bucket = bucketOf(row, today);
  if (bucket === "track") return "parked";
  if (home === "uspto" && bucket === "uspto") return "parked";
  return home;
}

export type AgendaGroup = { section: AgendaSection; label: string; hint: string; rows: ReviewRow[] };

const byText = (a: string, b: string) => a.localeCompare(b, "en");
const FAR = "9999-12-31";

/** Urgency within a section: overdue, due this week, needs a next step, quiet, then the rest (USPTO, on track). */
const URGENCY: Record<BucketKey, number> = Object.fromEntries(BUCKET_KEYS.map((k, i) => [k, i])) as Record<BucketKey, number>;

function compareRows(section: AgendaSection, today: string) {
  return (a: ReviewRow, b: ReviewRow): number => {
    const u = URGENCY[bucketOf(a, today)] - URGENCY[bucketOf(b, today)];
    if (u) return u;
    if (section === "uspto") {
      const d = byText(a.deadline?.dueDate ?? FAR, b.deadline?.dueDate ?? FAR);
      if (d) return d;
    }
    if (section === "new-clients") {
      const d = byText(a.proposalExpiry?.expiresOn ?? FAR, b.proposalExpiry?.expiresOn ?? FAR);
      if (d) return d;
    }
    return byText(a.client, b.client) || byText(a.key, b.key);
  };
}

/** Every section, in the meeting's order (an empty one is still returned), each with its rows sorted. Deterministic. */
export function agendaOrder(rows: readonly ReviewRow[], today: string): AgendaGroup[] {
  const by = new Map<AgendaSection, ReviewRow[]>(AGENDA_SECTIONS.map((s) => [s, []]));
  for (const row of rows) by.get(agendaSection(row, today))!.push(row);
  return AGENDA_SECTIONS.map((section) => ({ section, ...AGENDA_COPY[section], rows: by.get(section)!.sort(compareRows(section, today)) }));
}

/** The rows meeting mode walks: sections 1 to 4 in order, Parked left out. */
export function agendaQueue(groups: readonly AgendaGroup[], today: string): ReviewRow[] {
  // Meeting mode skips on-track leads (Taylor, Nov 9): nothing to talk about for them this week. The agenda still lists them.
  return groups
    .filter((g) => MEETING_SECTIONS.includes(g.section))
    .flatMap((g) => g.rows)
    .filter((r) => !(r.kind === "lead" && bucketOf(r, today) === "track"));
}

/** Every row in agenda order, Parked last: the position of each row, for the Cards deck. */
export function agendaPositions(groups: readonly AgendaGroup[]): Map<string, number> {
  return new Map(groups.flatMap((g) => g.rows).map((r, i) => [r.key, i]));
}
