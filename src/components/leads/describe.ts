/**
 * One readable line for a timeline row. Pure, so the wording is tested.
 * Payloads are written by many producers (sync, agents, people, lectual's
 * importers), so every field is read defensively.
 */
type Row = { type: string; actor_type: string | null; created_at: string; payload: unknown };

export type Described = { title: string; detail: string | null; tone: "mail" | "ai" | "note" | "system"; link: string | null };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

const AI_SOURCES: Record<string, string> = {
  "intake-triage": "Intake triage",
  "email-intel": "Email intel",
  "email-intel-review": "Proposal reviewed",
  "post-consult": "Post-consult drafter",
};

export function describeActivity(row: Row): Described {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.type) {
    case "email_received":
      return { title: `Email from ${str(p.from) ?? "the client"}`, detail: str(p.subject), tone: "mail", link: str(p.web_link) };
    case "email_sent":
      return { title: "Email sent", detail: str(p.subject) ?? str(p.body), tone: "mail", link: str(p.web_link) };
    case "note":
      return { title: "Note", detail: str(p.body) ?? str(p.text), tone: "note", link: null };
    case "call_logged":
      return { title: "Call logged", detail: str(p.body), tone: "note", link: null };
    case "voice_note":
      return { title: "Voice note", detail: str(p.transcript), tone: "note", link: null };
    case "stage_changed":
      return { title: `Moved to ${str(p.to_stage_name) ?? str(p.to) ?? "a new stage"}`, detail: null, tone: "system", link: null };
    case "lead_created":
      return { title: "Lead created", detail: str(p.source), tone: "system", link: null };
    case "lead_assigned":
      return { title: "Lead assigned", detail: null, tone: "system", link: null };
    case "lead_updated":
      return { title: "Details updated", detail: Array.isArray(p.fields) ? (p.fields as string[]).join(", ") : null, tone: "system", link: null };
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
