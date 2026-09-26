import { INTEL_FIELDS, type IntelField } from "./email-intel";

/**
 * Email-intel proposals awaiting a person's decision. Pure: works over the
 * lead's timeline rows. crm_activity is append-only, so a decision is a new
 * `ai_insight` row (source `email-intel-review`) naming the message it
 * decided, and a proposal is pending while no such row exists.
 */

export const REVIEW_SOURCE = "email-intel-review";

export type Proposal = {
  activityId: string;
  messageId: string;
  at: string;
  summary: string | null;
  proposed: { field: IntelField; value: string; evidence: string }[];
  alreadyApplied: IntelField[];
  legalQuestion: string | null;
};

type Row = { id: string; type: string; created_at: string; payload: unknown };

export const FIELD_LABEL: Record<IntelField, string> = {
  business_name: "Business name",
  phone: "Phone",
  website: "Website",
  mark_text: "Mark",
  practice_area: "Practice area",
};

export function pendingProposals(rows: readonly Row[]): Proposal[] {
  const decided = new Set<string>();
  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    if (r.type === "ai_insight" && p.source === REVIEW_SOURCE && typeof p.message_id === "string") decided.add(p.message_id);
  }
  const out: Proposal[] = [];
  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    if (r.type !== "ai_insight" || p.source !== "email-intel" || typeof p.message_id !== "string") continue;
    if (decided.has(p.message_id)) continue;
    const applied = Array.isArray(p.applied) ? (p.applied as IntelField[]) : [];
    const proposed = (Array.isArray(p.proposed) ? p.proposed : [])
      .filter((c): c is { field: IntelField; value: string; evidence: string } =>
        !!c && (INTEL_FIELDS as readonly string[]).includes((c as { field: string }).field) && typeof (c as { value: unknown }).value === "string",
      )
      .filter((c) => !applied.includes(c.field));
    if (proposed.length === 0 && !p.legal_question) continue;
    out.push({
      activityId: r.id,
      messageId: p.message_id,
      at: r.created_at,
      summary: typeof p.summary === "string" ? p.summary : null,
      proposed,
      alreadyApplied: applied,
      legalQuestion: typeof p.legal_question === "string" ? p.legal_question : null,
    });
  }
  return out;
}

/**
 * The update to write when a person accepts some fields of a proposal. Values
 * come ONLY from the stored proposal — never from the form — so accepting
 * can't be used to write arbitrary text into a lead.
 */
export function acceptedUpdate(proposal: Proposal, fields: readonly string[]): Partial<Record<IntelField, string>> {
  const out: Partial<Record<IntelField, string>> = {};
  for (const c of proposal.proposed) {
    if (fields.includes(c.field) && !(c.field in out)) out[c.field] = c.value.trim().slice(0, 300);
  }
  return out;
}
