import { z } from "zod";
import { isDatabaseUpdateNeeded } from "@/lib/calendar/outlook-errors";
import { joinHref } from "@/lib/calendar/outlook-format";
import { buildClientPrepDraft, type DraftTextGenerator } from "@/lib/prep-consult/drafts";
import { JudgmentBoundaryError, assertNoJudgmentContent, scrubJudgmentContent, type PrepConsultFacts } from "@/lib/prep-consult/prep-consult";
import { AGENT_POLICY } from "../policy";
import { MAILBOX_GATE_REASON, mailboxModuleState } from "../mailbox-gate";
import { IN_CHUNK, chunk, neutralise, readFirmStyle, realAddress } from "../shared";
import type { AgentContext, AgentResult } from "../types";
import {
  cardName,
  inquiryDescription,
  readLeadAnswers,
  readLeadFacts,
  readMailSummary,
  readMeetingHistory,
  renderFactsCard,
} from "./facts";

/**
 * Consult prep: for each consult in the next 24 hours that is on the Outlook calendar, flagged as a
 * consult and linked to a lead, with no prep recorded for that event yet:
 *
 *   BRIEFING      an internal heads-up carrying the facts card (lead details, intake and assessment
 *                 answers in the client's own words, an email summary, meeting history). Rendered from
 *                 data, never written by a model.
 *   CLIENT_EMAIL  a short note to the client on what to have ready, through the same builder the
 *                 staff-invoked prep flow uses, with its model call routed through this run.
 *
 * Both go to the approval queue; nothing is sent. Classes, package and price are the attorney's call
 * and are never generated: the card withholds any such fragment from recorded values, and a model
 * output carrying one is refused (nothing is queued for that consult, it is counted, the run goes on).
 * Both drafts are BUILT and checked before either is queued, so a refused second draft queues neither.
 *
 * Reads the Outlook calendar, so it needs the Mailboxes module on every run; with it off (or unreadable)
 * the run ends skipped, never as "no consults". Before lectual 0098 the calendar columns do not exist:
 * the run ends skipped with "not available until the database update".
 *
 * Each prep is recorded on the lead's timeline AFTER its drafts are queued (event id and queue ids, no
 * content), which is what makes a second run skip the event. Counts only leave this file.
 */

export const PREP_WINDOW_HOURS = 24;
/** A safety bound on one run: model calls are serial and the cron has a 300s ceiling. */
export const PREP_BATCH = 10;
export const PREP_SOURCE = "consult-prep";
const EVENT_ROWS = 100;

const GeneratedText = z.object({ text: z.string().describe("The complete plain-text email, in the exact format the instructions give") });

type EventRow = { id: string; org_id: string; lead_id: string | null; starts_at: string; join_url: string | null; is_consult: boolean | null; source: string | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function skipped(summary: string): AgentResult {
  return { itemsIn: 0, draftsOut: 0, summary, skipped: true };
}

export async function runConsultPrep(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy } = ctx;
  const gate = mailboxModuleState(ctx);
  if (gate !== "on") return skipped(`Skipped: ${MAILBOX_GATE_REASON[gate]}.`);
  if (!ctx.queueOrgKey) return skipped("No approval queue is connected for this firm, so no consult prep was drafted.");

  const nowMs = ctx.now();
  const until = new Date(nowMs + PREP_WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await admin
    .from("crm_calendar_event")
    .select("id, org_id, lead_id, starts_at, join_url, is_consult, source")
    .eq("org_id", orgId)
    .eq("source", "outlook")
    .eq("is_consult", true)
    .not("lead_id", "is", null)
    .gt("starts_at", new Date(nowMs).toISOString())
    .lte("starts_at", until)
    .order("starts_at", { ascending: true })
    .limit(EVENT_ROWS);
  if (error) {
    if (isDatabaseUpdateNeeded(error)) return skipped("Skipped: the calendar is not available until the database update.");
    throw new Error("The calendar could not be read, so no consults were prepped.");
  }
  // The query says all of this; it is checked again on the rows so a row that slipped through is never prepped.
  const upcoming = ((data ?? []) as EventRow[]).filter((e) => {
    const at = Date.parse(e.starts_at);
    return e.org_id === orgId && e.is_consult === true && e.source === "outlook" && Boolean(e.lead_id) && at > nowMs && at <= nowMs + PREP_WINDOW_HOURS * 3_600_000;
  });
  if (upcoming.length === 0) return { itemsIn: 0, draftsOut: 0, summary: "No consults in the next 24 hours need prep." };

  // Already prepped? One timeline row per queued draft carries the event id.
  const prepped = new Set<string>();
  for (const batch of chunk(upcoming.map((e) => e.id), IN_CHUNK)) {
    const res = await admin
      .from("crm_activity")
      .select("payload")
      .eq("org_id", orgId)
      .eq("type", "queue_drafted")
      .eq("payload->>source", PREP_SOURCE)
      .in("payload->>event_id", batch);
    if (res.error) throw new Error("The prep history could not be read, so no consults were prepped.");
    for (const row of res.data ?? []) {
      const id = (row.payload as Record<string, unknown> | null)?.event_id;
      if (typeof id === "string") prepped.add(id);
    }
  }
  const todo = upcoming.filter((e) => !prepped.has(e.id));
  if (todo.length === 0) return { itemsIn: 0, draftsOut: 0, summary: "Every consult in the next 24 hours is already prepped." };
  const batch = todo.slice(0, PREP_BATCH);

  const style = await readFirmStyle(admin, orgId);
  const generate: DraftTextGenerator = async ({ system, prompt, maxTokens }) => {
    const { output } = await ctx.llm({
      system: `${AGENT_POLICY}\n\n${system}`,
      user: `<lead_record>\n${prompt}\n</lead_record>`,
      schema: GeneratedText,
      effort: "high",
      maxTokens,
    });
    return output.text;
  };

  let prepsMade = 0;
  let draftsOut = 0;
  let noAddress = 0;
  let refused = 0;
  let failed = 0;
  let partial = 0;
  let unrecorded = 0;
  const unreadable: Record<string, number> = { answers: 0, mail: 0, meetings: 0 };

  for (const event of batch) {
    try {
      const lead = await readLeadFacts(admin, orgId, event.lead_id as string);
      if (!lead) {
        failed += 1;
        continue;
      }
      const answers = await readLeadAnswers(admin, orgId, lead.id);
      const mail = await readMailSummary(admin, orgId, lead.id);
      const meetings = await readMeetingHistory(admin, orgId, lead.id);
      if (answers.state !== "ok") unreadable.answers += 1;
      if (mail.state !== "ok") unreadable.mail += 1;
      if (meetings.state !== "ok") unreadable.meetings += 1;

      const joinUrl = joinHref(event.join_url);
      const card = renderFactsCard({ lead, startsAt: event.starts_at, joinUrl, tz: style.timeZone, answers, mail, meetings });
      const name = cardName(lead);

      // Build and check BOTH before queueing either.
      assertNoJudgmentContent(card.ownWording, "consult heads-up");
      const address = realAddress(lead.email);
      let clientBody: string | null = null;
      if (autonomy !== "suggest") {
        if (!address) {
          noAddress += 1;
        } else {
          const facts: PrepConsultFacts = {
            clientName: neutralise(scrubJudgmentContent(name)),
            clientEmail: address,
            practiceArea: neutralise(scrubJudgmentContent(lead.practiceArea?.trim() || "Not specified")),
            inquiryDescription: neutralise(inquiryDescription(lead, answers)),
            sessionWhen: new Intl.DateTimeFormat("en-US", {
              timeZone: style.timeZone,
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            }).format(new Date(event.starts_at)),
            zoomLink: joinUrl,
          };
          clientBody = (await buildClientPrepDraft(facts, generate)).draftBody;
        }
      }

      // Queue: the heads-up first, then the client email. Whatever was queued is recorded.
      const queued: Array<{ kind: "heads_up" | "client_prep"; id: string }> = [];
      try {
        const headsUp = await ctx.createDraft({
          orgKey: ctx.queueOrgKey,
          agent: PREP_SOURCE,
          type: "BRIEFING",
          headline: `Consult heads-up for ${name}`,
          summary: `Internal heads-up with the facts on file for ${name}'s consult. Prepared by the Consult prep agent; nothing was sent.`,
          draftBody: card.body,
          clientName: name,
          leadId: lead.id,
        });
        queued.push({ kind: "heads_up", id: headsUp.id });
        if (clientBody) {
          const prep = await ctx.createDraft({
            orgKey: ctx.queueOrgKey,
            agent: PREP_SOURCE,
            type: "CLIENT_EMAIL",
            headline: `Consult prep email for ${name}`,
            summary: `Asks ${name} what to have ready before the strategy session. Confirms only the appointment details on the calendar.`,
            clientName: name,
            leadId: lead.id,
            recipient: address as string,
            subject: "Preparing for your strategy session",
            draftBody: clientBody,
            signOff: style.signOff,
          });
          queued.push({ kind: "client_prep", id: prep.id });
        }
      } catch {
        partial += queued.length > 0 ? 1 : 0;
        if (queued.length === 0) failed += 1;
      }
      draftsOut += queued.length;
      if (queued.length === 0) continue;

      prepsMade += 1;
      const { error: recordError } = await admin.from("crm_activity").insert(
        queued.map((q) => ({
          org_id: orgId,
          lead_id: lead.id,
          type: "queue_drafted",
          actor_id: null,
          actor_type: "ai",
          payload: { source: PREP_SOURCE, agent: PREP_SOURCE, kind: q.kind, event_id: event.id, queueItemId: q.id },
        })),
      );
      if (recordError) unrecorded += 1;
    } catch (err) {
      // A refused judgment guard is its own count; everything else is a failure of this one consult.
      if (err instanceof JudgmentBoundaryError) refused += 1;
      else failed += 1;
    }
  }

  const parts = [`${plural(prepsMade, "consult", "consults")} prepped, ${plural(draftsOut, "draft", "drafts")} queued.`];
  if (noAddress > 0) parts.push(`${plural(noAddress, "consult", "consults")} had no client address, so only the heads-up was written.`);
  if (refused > 0) parts.push(`${plural(refused, "consult", "consults")} held back because a draft contained attorney-judgment content.`);
  if (failed > 0) parts.push(`${plural(failed, "consult", "consults")} could not be prepped and will be tried again.`);
  if (partial > 0) parts.push(`${plural(partial, "consult", "consults")} got the heads-up but not the client email.`);
  if (unrecorded > 0) parts.push(`${plural(unrecorded, "prep", "preps")} could not be recorded on the lead, so they may be drafted again.`);
  const missing = Object.entries(unreadable).filter(([, n]) => n > 0).map(([k]) => k);
  if (missing.length > 0) parts.push(`Some card sections could not be read: ${missing.join(", ")}.`);
  if (todo.length > batch.length) parts.push(`${plural(todo.length - batch.length, "consult", "consults")} left for the next run (limit ${PREP_BATCH}).`);

  return { itemsIn: prepsMade, draftsOut, summary: parts.join(" ") };
}
