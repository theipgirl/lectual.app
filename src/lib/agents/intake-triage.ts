import { z } from "zod";
import { AGENT_POLICY } from "./policy";
import { budgetNearlySpent, isUnusableModelAnswer } from "./shared";
import type { AgentContext, AgentResult } from "./types";

/**
 * Intake triage: every lead that hasn't been scored gets a lane (hot / warm /
 * cold) and a short written reason, so the intake team works the right
 * people first. It never contacts anyone.
 *
 * By autonomy level:
 *   suggest  an `ai_insight` timeline entry only
 *   draft    + the suggested lane and reason, and red flags, on the lead's AI
 *            fields (ai_summary "HOT — reason", ai_red_flags) — fields that
 *            exist to hold the AI's view
 *   act      the same as draft. It used to also write the lead's
 *            `temperature` (with temperature_set_by NULL), which the intake
 *            board renders as a call someone made — exactly the failure RPB's
 *            SOP names: "a routing suggestion once rendered as an assignment
 *            status on the dashboard and read as fact". Routing is a
 *            SUGGESTION (SOP Stage 2), so triage never writes the lane or the
 *            temperature; a person sets the lane (crm_lead.lane, lectual
 *            0085, whose trigger refuses a write without a session anyway).
 * Every mode marks the lead scored (ai_enriched_at) so it isn't re-scored
 * every run, and a hot lead gets a BRIEFING in the queue when the firm has one.
 */

export const TRIAGE_BATCH = 20;
/**
 * Room for the model's thinking AND the JSON. 4000 was not enough at effort "low": on 2026-10-22 the
 * answer for one RPB lead stopped at max_tokens mid-string and the whole run failed. Same as callClaude's
 * default.
 */
export const TRIAGE_MAX_TOKENS = 16_000;
/** No new lead is started with less than this left in the run's time budget; the rest wait for the next run. */
export const TRIAGE_RESERVE_MS = 30_000;

/** How far back a booth completion can still trigger a re-score of an already-triaged lead. */
export const BOOTH_RESCORE_DAYS = 14;

export const TriageSchema = z.object({
  lane: z.enum(["hot", "warm", "cold"]),
  readiness: z.number().int().min(1).max(5).describe("1 = just curious, 5 = ready to sign now"),
  value: z.enum(["LOW", "MID", "HIGH", "PREMIUM", "UNKNOWN"]),
  urgency: z.enum(["2d", "3d", "5d", "7d", "14d", "none"]).describe("How soon the firm should respond"),
  practice_fit: z.enum(["strong", "partial", "none"]).describe("Fit with an IP (trademark/copyright) practice"),
  reason: z.string().describe("Two or three plain sentences a busy intake coordinator can act on"),
  red_flags: z.array(z.string()).describe("Short phrases; empty if none"),
});
export type Triage = z.infer<typeof TriageSchema>;

const SYSTEM = `${AGENT_POLICY}

Your job: triage a new prospective client ("lead") for the firm's intake team. Judge readiness to engage, likely matter value, how quickly the firm should respond, and whether the matter fits an intellectual-property practice. Explain the lane in two or three plain sentences. The reason is read by staff, never by the client. Red flags are things staff should know before calling (for example a mark that is already a famous brand, a deadline already passed, or a non-IP matter).

Some leads come with a <booth_assessment>: the person's own answers to the firm's assessment card, scored by fixed rules. Treat it as what they told the firm. Don't call a detail missing when the assessment gives it (a mark or goods/services named there counts). A reported name conflict is always a red flag for the attorney. The booth heat is a rule-based read, not a fact; you may disagree with it, but say why in the reason.`;

/** The lead's latest completed booth card (lectual 0086 crm_booth_scorecard). */
export type BoothAssessment = {
  lead_id: string;
  event_code: string;
  track: string | null;
  score: number | null;
  band: string | null;
  temperature: string | null;
  gaps: string[] | null;
  answers: Record<string, unknown> | null;
  mark_name: string | null;
  mark_goods: string | null;
  completed_at: string | null;
};

// Answer ids for the inputs behind the booth heat, on both cards (lectual src/lib/booth/questions.ts
// and ip-questions.ts). The rest of the card reaches the model through the gap lines.
const REVENUE_IDS = ["108", "4"];
const TIMELINE_IDS = ["109", "8"];
const CONFLICT_ID = "104";
const REVENUE: Record<string, string> = {
  under_150k: "Under $150k", "150k_250k": "$150k–$250k", "250k_500k": "$250k–$500k", "500k_1m": "$500k–$1M", over_1m: "$1M+",
};
const TIMELINE: Record<string, string> = { right_away: "Right away", "1_2_months": "In 1–2 months", "3_plus_months": "In 3+ months" };
const YES_NO: Record<string, string> = { yes: "Yes", no: "No", unsure: "Not sure" };

function answer(answers: Record<string, unknown> | null, ids: string[]): string | null {
  for (const id of ids) {
    const v = answers?.[id];
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === "string" && first) return first;
  }
  return null;
}

function boothLines(b: BoothAssessment): string[] {
  const revenue = answer(b.answers, REVENUE_IDS);
  const timeline = answer(b.answers, TIMELINE_IDS);
  const conflict = answer(b.answers, [CONFLICT_ID]);
  const lines = [
    `Event: ${b.event_code}`,
    `Booth heat (rule-based): ${b.temperature ? b.temperature.toUpperCase() : "(not scored)"}`,
    `Protection score: ${b.score ?? "?"}/100 (${b.band ?? "unknown"}) — higher means better protected`,
    `Wants help: ${timeline ? (TIMELINE[timeline] ?? timeline) : "(not answered)"}`,
    `Annual revenue: ${revenue ? (REVENUE[revenue] ?? revenue) : "(not answered)"}`,
  ];
  if (conflict) lines.push(`Seen a similar name, or contacted about theirs: ${YES_NO[conflict] ?? conflict}`);
  lines.push(`Name or wordmark: ${b.mark_name?.trim() || "(not given)"}`);
  lines.push(`Goods/services: ${b.mark_goods?.trim() || "(not given)"}`);
  const gaps = (b.gaps ?? []).filter(Boolean);
  lines.push(gaps.length ? `Gaps the card showed them: ${gaps.join(" | ")}` : "Gaps the card showed them: (none)");
  return lines;
}

type LeadRow = {
  id: string;
  first_name: string;
  last_name: string;
  business_name: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  practice_area: string | null;
  mark_text: string | null;
  referral_source: string | null;
  referral_detail: string | null;
  qualification_score: number | null;
  temperature: string | null;
  created_at: string;
  ai_enriched_at?: string | null;
};

export function triagePrompt(lead: LeadRow, booth?: BoothAssessment | null): string {
  const domain = lead.email.includes("@") ? lead.email.split("@")[1] : null;
  const lines = [
    `Name: ${`${lead.first_name} ${lead.last_name}`.trim() || "(not given)"}`,
    `Business: ${lead.business_name ?? "(not given)"}`,
    `Email domain: ${domain ?? "(none)"}`,
    `Website: ${lead.website ?? "(none)"}`,
    `Phone given: ${lead.phone ? "yes" : "no"}`,
    `Practice area: ${lead.practice_area ?? "(not given)"}`,
    `Mark: ${lead.mark_text ?? "(not given)"}`,
    `Came from: ${[lead.referral_source, lead.referral_detail].filter(Boolean).join(" — ") || "(unknown)"}`,
    `CRM qualification score (0–1, computed by rules): ${lead.qualification_score ?? "(none)"}`,
    `Arrived: ${lead.created_at.slice(0, 10)}`,
  ];
  const assessment = booth
    ? `\n\n<booth_assessment>\n${boothLines(booth).join("\n")}\n</booth_assessment>`
    : "\n\nBooth assessment: (none)";
  return `Triage this lead.\n\n<lead>\n${lines.join("\n")}\n</lead>${assessment}`;
}

/**
 * The lead columns one triage result may write. Pure, so the rule "a
 * suggestion never becomes the lane" is pinned by a test: the keys are
 * ai_enriched_at, and (draft / act) ai_summary + ai_red_flags. Never `lane`,
 * `lane_set_*`, `temperature` or `temperature_set_*`, at any autonomy.
 */
export function triageLeadUpdate(output: Triage, autonomy: AgentContext["autonomy"], nowIso: string): Record<string, unknown> {
  const update: Record<string, unknown> = { ai_enriched_at: nowIso };
  if (autonomy !== "suggest") {
    update.ai_summary = `${output.lane.toUpperCase()} — ${output.reason}`;
    update.ai_red_flags = output.red_flags.slice(0, 5);
  }
  return update;
}

export async function runIntakeTriage(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy, llm } = ctx;

  const LEAD_COLUMNS =
    "id, first_name, last_name, business_name, email, phone, website, practice_area, mark_text, referral_source, referral_detail, qualification_score, temperature, created_at, ai_enriched_at";

  const { data, error } = await admin
    .from("crm_lead")
    .select(LEAD_COLUMNS)
    .eq("org_id", orgId)
    .is("ai_enriched_at", null)
    .order("created_at", { ascending: false })
    .limit(TRIAGE_BATCH);
  if (error) throw new Error(`lead read failed: ${error.message}`);
  const leads = (data ?? []) as LeadRow[];

  // Booth completions in the window: the assessment for each lead, and the leads triaged
  // BEFORE their assessment arrived (the contact step files the lead first, so triage can
  // run on a bare record and never look again).
  const since = new Date(ctx.now() - BOOTH_RESCORE_DAYS * 86_400_000).toISOString();
  const { data: boothData, error: boothErr } = await admin
    .from("crm_booth_scorecard")
    .select("lead_id, event_code, track, score, band, temperature, gaps, answers, mark_name, mark_goods, completed_at")
    .eq("org_id", orgId)
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(200);
  if (boothErr) throw new Error(`booth read failed: ${boothErr.message}`);
  const boothByLead = new Map<string, BoothAssessment>();
  for (const b of (boothData ?? []) as BoothAssessment[]) {
    if (b.completed_at && !boothByLead.has(b.lead_id)) boothByLead.set(b.lead_id, b); // newest first
  }

  const queued = new Set(leads.map((l) => l.id));
  const candidates = [...boothByLead.keys()].filter((id) => !queued.has(id));
  if (candidates.length && leads.length < TRIAGE_BATCH) {
    const { data: again, error: againErr } = await admin
      .from("crm_lead")
      .select(LEAD_COLUMNS)
      .eq("org_id", orgId)
      .in("id", candidates);
    if (againErr) throw new Error(`lead re-score read failed: ${againErr.message}`);
    for (const l of (again ?? []) as LeadRow[]) {
      if (leads.length >= TRIAGE_BATCH) break;
      const done = boothByLead.get(l.id)?.completed_at;
      if (l.ai_enriched_at && done && Date.parse(l.ai_enriched_at) < Date.parse(done)) leads.push(l);
    }
  }

  let hot = 0;
  let drafts = 0;
  let scored = 0;
  // A lead whose answer can't be used (cut off, refused, wrong shape) keeps ai_enriched_at null, so
  // the next run tries it again. It costs that lead only, never the rest of the batch.
  let unscored = 0;
  let deferred = 0;
  for (const [index, lead] of leads.entries()) {
    if (budgetNearlySpent(ctx, TRIAGE_RESERVE_MS)) {
      deferred = leads.length - index;
      break;
    }
    let output: Triage;
    try {
      ({ output } = await llm({ system: SYSTEM, user: triagePrompt(lead, boothByLead.get(lead.id)), schema: TriageSchema, effort: "low", maxTokens: TRIAGE_MAX_TOKENS, agent: "intake-triage" }));
    } catch (err) {
      if (!isUnusableModelAnswer(err)) throw err;
      unscored += 1;
      continue;
    }
    const nowIso = new Date(ctx.now()).toISOString();

    const update = triageLeadUpdate(output, autonomy, nowIso);
    const { error: upErr } = await admin.from("crm_lead").update(update).eq("id", lead.id).eq("org_id", orgId);
    if (upErr) throw new Error(`lead update failed: ${upErr.message}`);

    const { error: actErr } = await admin.from("crm_activity").insert({
      org_id: orgId,
      lead_id: lead.id,
      type: "ai_insight",
      actor_id: null,
      actor_type: "ai",
      payload: {
        source: "intake-triage",
        autonomy,
        lane: output.lane,
        readiness: output.readiness,
        value: output.value,
        urgency: output.urgency,
        practice_fit: output.practice_fit,
        reason: output.reason,
        red_flags: output.red_flags.slice(0, 5),
        // A suggestion only: never the lane, never the temperature.
        applied: { lane: false, temperature: false, summary: autonomy !== "suggest" },
      },
    });
    if (actErr) throw new Error(`activity insert failed: ${actErr.message}`);
    scored += 1;

    if (output.lane === "hot") {
      hot += 1;
      if (ctx.queueOrgKey) {
        const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.business_name || "A new lead";
        await ctx.createDraft({
          orgKey: ctx.queueOrgKey,
          agent: "intake-triage",
          type: "BRIEFING",
          headline: `Hot lead: ${name}`,
          summary: output.reason,
          clientName: name,
          leadId: lead.id,
          draftBody: [
            `Lane: HOT (readiness ${output.readiness}/5, value ${output.value}, respond within ${output.urgency}).`,
            "",
            output.reason,
            ...(output.red_flags.length ? ["", "Before you call:", ...output.red_flags.map((f) => `- ${f}`)] : []),
          ].join("\n"),
        });
        drafts += 1;
      }
    }
  }

  return { itemsIn: scored, draftsOut: drafts, summary: triageSummary({ found: leads.length, scored, hot, unscored, deferred }) };
}

/**
 * The run's one line. "N lead(s) scored, H hot." is kept word for word: the digest reads the hot count
 * out of it (`triageHotCount`). Counts only, never a name.
 */
export function triageSummary(c: { found: number; scored: number; hot: number; unscored: number; deferred: number }): string {
  if (c.found === 0) return "No new leads to score.";
  const parts = [`${c.scored} lead(s) scored, ${c.hot} hot.`];
  if (c.unscored > 0) parts.push(`${c.unscored} ${c.unscored === 1 ? "lead" : "leads"} couldn't be scored, will retry.`);
  if (c.deferred > 0) parts.push(`${c.deferred} ${c.deferred === 1 ? "lead was" : "leads were"} left for the next run (time limit).`);
  return parts.join(" ");
}
