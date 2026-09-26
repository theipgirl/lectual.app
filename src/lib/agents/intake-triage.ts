import { z } from "zod";
import { AGENT_POLICY } from "./policy";
import type { AgentContext, AgentResult } from "./types";

/**
 * Intake triage: every lead that hasn't been scored gets a lane (hot / warm /
 * cold) and a short written reason, so the intake team works the right
 * people first. It never contacts anyone.
 *
 * By autonomy level:
 *   suggest  an `ai_insight` timeline entry only
 *   draft    + the reason and red flags on the lead's AI fields (ai_summary,
 *            ai_red_flags) — fields that exist to hold the AI's view
 *   act      + the lead's temperature, but ONLY when no person has set one.
 *            A human's call is never overwritten.
 * Every mode marks the lead scored (ai_enriched_at) so it isn't re-scored
 * every run, and a hot lead gets a BRIEFING in the queue when the firm has one.
 */

export const TRIAGE_BATCH = 20;

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

Your job: triage a new prospective client ("lead") for the firm's intake team. Judge readiness to engage, likely matter value, how quickly the firm should respond, and whether the matter fits an intellectual-property practice. Explain the lane in two or three plain sentences. The reason is read by staff, never by the client. Red flags are things staff should know before calling (for example a mark that is already a famous brand, a deadline already passed, or a non-IP matter).`;

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
};

export function triagePrompt(lead: LeadRow): string {
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
    `Assessment score: ${lead.qualification_score ?? "(no assessment)"}`,
    `Arrived: ${lead.created_at.slice(0, 10)}`,
  ];
  return `Triage this lead.\n\n<lead>\n${lines.join("\n")}\n</lead>`;
}

export async function runIntakeTriage(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy, llm } = ctx;

  const { data, error } = await admin
    .from("crm_lead")
    .select(
      "id, first_name, last_name, business_name, email, phone, website, practice_area, mark_text, referral_source, referral_detail, qualification_score, temperature, created_at",
    )
    .eq("org_id", orgId)
    .is("ai_enriched_at", null)
    .order("created_at", { ascending: false })
    .limit(TRIAGE_BATCH);
  if (error) throw new Error(`lead read failed: ${error.message}`);
  const leads = (data ?? []) as LeadRow[];

  let hot = 0;
  let drafts = 0;
  for (const lead of leads) {
    const { output } = await llm({ system: SYSTEM, user: triagePrompt(lead), schema: TriageSchema, effort: "low", maxTokens: 4000 });
    const nowIso = new Date(ctx.now()).toISOString();

    const update: Record<string, unknown> = { ai_enriched_at: nowIso };
    if (autonomy !== "suggest") {
      update.ai_summary = `${output.lane.toUpperCase()} — ${output.reason}`;
      update.ai_red_flags = output.red_flags.slice(0, 5);
    }
    const setTemperature = autonomy === "act" && !lead.temperature;
    if (setTemperature) {
      update.temperature = output.lane;
      update.temperature_set_at = nowIso;
      // temperature_set_by stays null: no person made this call.
    }
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
        applied: { temperature: setTemperature, summary: autonomy !== "suggest" },
      },
    });
    if (actErr) throw new Error(`activity insert failed: ${actErr.message}`);

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

  return {
    itemsIn: leads.length,
    draftsOut: drafts,
    summary: leads.length === 0 ? "No new leads to score." : `${leads.length} lead(s) scored, ${hot} hot.`,
  };
}
