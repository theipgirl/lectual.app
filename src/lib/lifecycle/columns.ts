/**
 * The matter pipeline: one board spanning a client's whole lifecycle, from a
 * referral or new intake to a registration. Pure (no server imports), so the
 * column mapping is tested against custom stage catalogues.
 *
 *   intake      Referred / new intake
 *   consult     Consult booked
 *   engaged     Engaged (quote signed, or the matter is open)
 *   filed       Filed (at the office: filed, published, allowed, SOU, ...)
 *   office      Office action
 *   registered  Registered
 *   closed      Closed / abandoned (drawn collapsed)
 *
 * PRE-ENGAGEMENT (leads) is read from crm_stage CATEGORY and ORDER, never from
 * a stage's name alone, because firms name stages differently:
 *   - category 'lost'                               → closed
 *   - category 'nurture' (a parked lead)            → intake, wherever it sits
 *   - category 'won', or any stage at/after the first 'won' stage → engaged
 *   - otherwise (open / nurture, before 'won')      → intake or consult:
 *       consult when the lead has a consult note on file, OR its stage sits
 *       at/after the firm's first intake stage whose name mentions a
 *       consult / call / meeting / booking. A firm with no such stage still
 *       gets "consult" from the consult notes; nothing is guessed from order
 *       alone.
 *
 * POST-ENGAGEMENT (matters) is read from the docket stage (crm_matter_stage).
 * The table has no phase column, so this is a documented keyword rule over
 * the stage's code + label, applied in board order, with a fallback:
 *   1. a closed stage (is_open = false): "regist" → registered, else closed
 *   2. an open stage matching the OFFICE-ACTION words → office
 *   3. an open stage matching the FILED words → filed
 *   4. an open stage matching the ENGAGED words (engaged, signed, deposit,
 *      retainer) → engaged
 *   5. an open stage matching the CONSULT / INTAKE words → consult / intake
 *      (RPB's docket starts at "Potential New Client")
 *   6. anything else INHERITS the column of the nearest earlier stage in
 *      order_index that matched a rule (so "Invoice for SOU sent" after
 *      "Specimen requested" stays with it), and a stage with nothing matched
 *      before it falls back to ENGAGED.
 * A matter with no stage at all is ENGAGED ("not on the docket"); a closed
 * matter is CLOSED unless its stage or registration date says registered.
 */

export const PIPELINE_COLUMNS = ["intake", "consult", "engaged", "filed", "office", "registered", "closed"] as const;
export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];

export const COLUMN_LABEL: Record<PipelineColumn, string> = {
  intake: "Referred / new intake",
  consult: "Consult booked",
  engaged: "Engaged",
  filed: "Filed",
  office: "Office action",
  registered: "Registered",
  closed: "Closed / abandoned",
};

export const COLUMN_HINT: Record<PipelineColumn, string> = {
  intake: "New leads and referrals not yet at a consult",
  consult: "Consult booked or held, not yet engaged",
  engaged: "Quote signed or matter open, not yet filed",
  filed: "At the office: filed, published, allowed, SOU",
  office: "An office action is open",
  registered: "Registered",
  closed: "Closed, abandoned or lost",
};

const OFFICE_WORDS = /\boffice action\b|\boa\b|\boa[_ -]|\bfinal refusal\b|\bsuspen/;
const FILED_WORDS =
  /\bfiled\b|\bawaiting\b|\bexamination\b|\bpublish|\bpublication\b|\ballow|\bnoa\b|\bnotice of allowance\b|\bsou\b|statement of use|\bspecimen|\bopposition\b|\bpending\b|\bregistration\b/;
const ENGAGED_WORDS = /\bengag|\bsigned\b|\bdeposit|\bretain/;
const CONSULT_WORDS = /consult|\bcall\b|meeting|booked|scheduled|appointment/;
const INTAKE_WORDS = /potential|prospect|new client|\binquiry\b|\benquiry\b|\breferr/;

export type DocketStageLike = { id: string; code: string; label: string; order_index: number; is_open: boolean };

function keywordColumn(stage: DocketStageLike): PipelineColumn | null {
  const text = `${stage.code} ${stage.label}`.toLowerCase().replace(/[_/]/g, " ");
  if (!stage.is_open) return /regist/.test(text) ? "registered" : "closed";
  if (OFFICE_WORDS.test(text)) return "office";
  if (FILED_WORDS.test(text)) return "filed";
  if (ENGAGED_WORDS.test(text)) return "engaged";
  if (CONSULT_WORDS.test(text)) return "consult";
  if (INTAKE_WORDS.test(text)) return "intake";
  return null;
}

/** Every docket stage's column, by the rule above. */
export function mapDocketStages(stages: readonly DocketStageLike[]): Map<string, PipelineColumn> {
  const out = new Map<string, PipelineColumn>();
  let carried: PipelineColumn | null = null;
  for (const s of [...stages].sort((a, b) => a.order_index - b.order_index)) {
    const direct = keywordColumn(s);
    if (direct) {
      out.set(s.id, direct);
      if (s.is_open) carried = direct;
    } else {
      out.set(s.id, carried ?? "engaged");
    }
  }
  return out;
}

export type LeadStageLike = { id: string; name: string; category: string; order_index: number };

/** Each lead stage's column, with "consult" still decidable per lead (see leadColumn). */
export function mapLeadStages(stages: readonly LeadStageLike[]): Map<string, { column: PipelineColumn; consultStage: boolean }> {
  const sorted = [...stages].sort((a, b) => a.order_index - b.order_index);
  const firstWon = sorted.find((s) => s.category === "won")?.order_index ?? null;
  const firstConsult =
    sorted.find((s) => (s.category === "open" || s.category === "nurture") && (firstWon === null || s.order_index < firstWon) && CONSULT_WORDS.test(s.name.toLowerCase()))
      ?.order_index ?? null;
  const out = new Map<string, { column: PipelineColumn; consultStage: boolean }>();
  for (const s of sorted) {
    if (s.category === "lost") out.set(s.id, { column: "closed", consultStage: false });
    // Nurture is a parked lead wherever the firm put the stage: never "engaged".
    else if (s.category === "nurture") out.set(s.id, { column: "intake", consultStage: false });
    else if (s.category === "won" || (firstWon !== null && s.order_index >= firstWon)) out.set(s.id, { column: "engaged", consultStage: false });
    else {
      const consultStage = firstConsult !== null && s.order_index >= firstConsult;
      out.set(s.id, { column: consultStage ? "consult" : "intake", consultStage });
    }
  }
  return out;
}

export function leadColumn(
  stageMap: Map<string, { column: PipelineColumn; consultStage: boolean }>,
  lead: { current_stage_id: string },
  hasConsultNote: boolean,
): PipelineColumn {
  const s = stageMap.get(lead.current_stage_id);
  if (!s) return hasConsultNote ? "consult" : "intake";
  if (s.column === "intake" && hasConsultNote) return "consult";
  return s.column;
}

export function matterColumn(
  stageMap: Map<string, PipelineColumn>,
  matter: { stage_id: string | null; status: string; registration_date: string | null },
): PipelineColumn {
  const fromStage = matter.stage_id ? stageMap.get(matter.stage_id) ?? null : null;
  if (fromStage === "registered" || (matter.registration_date && fromStage !== "closed")) return "registered";
  if (matter.status === "closed") return "closed";
  return fromStage ?? "engaged";
}

// ── Cards ────────────────────────────────────────────────────────────────────

export type PipelineCard = {
  key: string;
  kind: "lead" | "matter" | "submission";
  column: PipelineColumn;
  client: string;
  mark: string | null;
  /** Matter number, or "Lead" / "Intake form". */
  ref: string;
  stageLabel: string | null;
  /** Days since the record entered its current stage, when known. */
  ageDays: number | null;
  ownerId: string | null;
  ownerName: string | null;
  href: string;
};

export type ColumnData = { column: PipelineColumn; count: number; cards: PipelineCard[] };

export function ageInDays(since: string | null, now: Date): number | null {
  if (!since) return null;
  const t = Date.parse(since);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export type PipelineFilter = { q?: string; owner?: string };

export function filterCards(cards: readonly PipelineCard[], filter: PipelineFilter): PipelineCard[] {
  const q = filter.q?.trim().toLowerCase();
  return cards.filter((c) => {
    if (q && !`${c.client} ${c.mark ?? ""} ${c.ref}`.toLowerCase().includes(q)) return false;
    if (filter.owner === "none" && (c.ownerId || c.ownerName)) return false;
    if (filter.owner && filter.owner !== "none" && c.ownerId !== filter.owner && c.ownerName !== filter.owner) return false;
    return true;
  });
}

/** Cards into columns, oldest-in-stage first (what's been sitting longest is on top). */
export function groupColumns(cards: readonly PipelineCard[]): ColumnData[] {
  return PIPELINE_COLUMNS.map((column) => {
    const mine = cards.filter((c) => c.column === column).sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
    return { column, count: mine.length, cards: mine };
  });
}
