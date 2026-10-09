/**
 * One readable line for a timeline row. Pure, so the wording is tested.
 * Payloads are written by many producers (sync, agents, people, lectual's
 * importers), so every field is read defensively.
 */
import { STOP_REASON_LABEL, isStopReason } from "@/lib/campaigns/stops";

type Row = { type: string; actor_type: string | null; created_at: string; payload: unknown };

export type Described = { title: string; detail: string | null; tone: "mail" | "ai" | "note" | "system"; link: string | null };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

const AI_SOURCES: Record<string, string> = {
  "intake-triage": "Intake triage",
  "email-intel": "Email intel",
  "email-intel-review": "Proposal reviewed",
  "post-consult": "Post-consult drafter",
};

const MATTER_CHANGE: Record<string, string> = {
  status: "Status changed",
  notes: "Notes updated",
  ip_fields: "Filing details updated",
  owner_assigned: "Owner assigned",
  deadline_docketed: "Deadline docketed",
  deadline_confirmed: "Deadline confirmed by an attorney",
  deadline_closed: "Deadline closed out",
  deadline_extended: "Deadline extended",
  litigation_detail: "Case details updated",
};

function matterChangeDetail(p: Record<string, unknown>): string | null {
  if (Array.isArray(p.fields)) return (p.fields as string[]).join(", ").replaceAll("_", " ");
  const due = str(p.due_date) ?? str(p.to);
  const kind = str(p.kind)?.replaceAll("_", " ") ?? null;
  if (kind || due) return [kind, due].filter(Boolean).join(" · ");
  if (str(p.from) && str(p.to)) return `${str(p.from)} → ${str(p.to)}`;
  return null;
}

export function describeActivity(row: Row): Described {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.type) {
    case "email_received":
      return { title: `Email from ${str(p.from) ?? "the client"}`, detail: str(p.subject), tone: "mail", link: str(p.web_link) };
    case "email_sent":
      return { title: "Email sent", detail: str(p.subject) ?? str(p.body), tone: "mail", link: str(p.web_link) };
    case "note":
      // addNote (src/lib/pipeline/notes.ts) writes `note`; older producers wrote `body`/`text`.
      return { title: "Note", detail: str(p.note) ?? str(p.body) ?? str(p.text), tone: "note", link: null };
    case "call_logged":
      return { title: "Call logged", detail: str(p.summary) ?? str(p.notes) ?? str(p.body), tone: "note", link: null };
    case "voice_note":
      return { title: "Voice note", detail: str(p.transcript), tone: "note", link: null };
    case "stage_changed": {
      // moveLeadStage and the quote-acceptance advance write `to_stage` /
      // `from_stage` (names); other producers wrote the older keys.
      const to = str(p.to_stage) ?? str(p.to_stage_name) ?? str(p.to_label) ?? str(p.to);
      const from = str(p.from_stage) ?? str(p.from_stage_name) ?? str(p.from_label);
      const why = str(p.source) === "quote_accepted" ? "Proposal signed" : null;
      return {
        title: `Moved to ${to ?? "a new stage"}`,
        detail: [from ? `from ${from}` : null, why].filter(Boolean).join(" · ") || null,
        tone: "system",
        link: null,
      };
    }
    case "lead_created":
      return { title: "Lead created", detail: str(p.source), tone: "system", link: null };
    case "lead_assigned":
      return { title: "Lead assigned", detail: null, tone: "system", link: null };
    case "lead_updated":
      if (str(p.field) === "lane") {
        // setLane (src/lib/intake/leads.ts): who, from → to, and what triage had suggested.
        const to = str(p.to);
        const from = str(p.from);
        const parts = [
          str(p.by) ? `by ${str(p.by)}` : null,
          from ? `was ${cap(from)}` : "was not set",
          str(p.suggested) ? `triage suggested ${cap(str(p.suggested) as string)}` : null,
        ];
        return { title: to ? `Lane set to ${cap(to)}` : "Lane cleared", detail: parts.filter(Boolean).join(" · "), tone: "note", link: null };
      }
      return { title: "Details updated", detail: Array.isArray(p.fields) ? (p.fields as string[]).join(", ") : null, tone: "system", link: null };
    case "drip_enrolled":
      return { title: `Enrolled in ${str(p.sequence_name) ?? "a campaign"}`, detail: null, tone: "system", link: null };
    case "drip_stopped": {
      // stopLeadSequences (src/lib/campaigns/stop.ts): the reason is the point.
      const reason = isStopReason(p.reason) ? STOP_REASON_LABEL[p.reason] : null;
      const campaign = str(p.sequence_name);
      const how = p.by_hand === true ? "stopped by a person" : str(p.detected_by) === "advance_guard" ? "caught before a step ran" : null;
      return {
        title: `Sequence stopped — ${reason ?? "stopped"}`,
        detail: [campaign, how].filter(Boolean).join(" · ") || null,
        tone: "system",
        link: null,
      };
    }
    case "matter_opened":
      return { title: "Matter opened", detail: str(p.matter_number), tone: "system", link: null };
    case "matter_updated":
      return { title: MATTER_CHANGE[str(p.change) ?? ""] ?? "Matter updated", detail: matterChangeDetail(p), tone: "system", link: null };
    case "quote_payment":
      // Written by the client proposal page (src/lib/quotes/public-payment.ts)
      // and by a manual entry on the quote builder. `summary` is staff-facing.
      return { title: p.needs_reconciliation === true ? "Payment needs checking" : "Quote payment", detail: str(p.summary), tone: "system", link: null };
    case "queue_drafted":
      return { title: "Draft queued for approval", detail: str(p.subject), tone: "ai", link: null };
    case "ai_insight": {
      const source = str(p.source) ?? "";
      if (source === "intake-triage") {
        return { title: `Triage: ${String(p.lane ?? "").toUpperCase() || "scored"}`, detail: str(p.reason), tone: "ai", link: null };
      }
      if (source === "email-intel-review") {
        const applied = Array.isArray(p.applied) ? (p.applied as string[]) : [];
        return { title: p.decision === "apply" ? "Proposal applied" : "Proposal dismissed", detail: applied.length ? applied.join(", ") : null, tone: "ai", link: null };
      }
      return { title: AI_SOURCES[source] ?? "AI insight", detail: str(p.summary), tone: "ai", link: null };
    }
    default:
      return { title: row.type.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()), detail: null, tone: "system", link: null };
  }
}
