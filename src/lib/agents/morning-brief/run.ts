import { MAILBOX_GATE_REASON, mailboxModuleState, noQueueSummary } from "../mailbox-gate";
import { budgetNearlySpent, leadLabel, readFirmStyle } from "../shared";
import type { AgentContext, AgentResult } from "../types";
import { FOLLOW_UP_CAP, openLeads, stalledLeads, waitingOnReply, type BriefLead, type BriefStage, type StalledLead, type WaitingLead } from "./rules";
import { draftFollowUp, planFollowUps, type FollowUpPlan } from "./follow-ups";
import { renderBrief, type BriefSections, type FollowUpNote } from "./render";
import {
  readLeadNames,
  readOpenLeads,
  readPending,
  readPendingSuggestions,
  readStages,
  readTodaysConsults,
  readUpcomingDeadlines,
  type Section,
} from "./sections";

/**
 * Morning brief: a BRIEFING draft for the attorney, in the approval queue, with six sections
 * (today's consults, leads waiting on a reply, pending stage suggestions, stalled leads, deadlines in
 * the next 14 days, the queue count), plus a follow-up CLIENT_EMAIL draft for each stalled lead
 * (at most five a run).
 *
 * It only drafts. Everything goes to the queue; nothing is sent, no lead is moved, no stage changes.
 *
 * Every section is read on its own, so one failing never hides the others, and a section that could
 * not be read says so in the brief instead of reading as "nothing today". If NO section could be
 * read the run fails rather than write an empty brief. The consults section reads the Outlook
 * calendar, so it needs the Mailboxes module: with the module off (or unreadable) that section says
 * so and the other five still run.
 *
 * Counts only ever leave this file (the summary, an error): never a name, subject or address. The
 * brief itself is internal and is the one place names appear.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * No new follow-up is started with less than this left in the run's time budget. It is the room the
 * rest of the run needs: one model call can take a while, and after the follow-ups the brief itself
 * still has to be rendered and queued. A follow-up not drafted for time is said in the brief and the
 * summary, and the next run picks the lead up again (nothing was recorded for it).
 */
export const FOLLOW_UP_RESERVE_MS = 60_000;

function leadSections(
  stages: Map<string, BriefStage> | null,
  leads: BriefLead[] | null,
  nowMs: number,
): { waiting: Section<WaitingLead>; stalled: Section<StalledLead>; stalledAll: StalledLead[] } {
  if (!stages || !leads) {
    const unavailable = { state: "unavailable", reason: "the lead list could not be read" } as const;
    return { waiting: unavailable, stalled: unavailable, stalledAll: [] };
  }
  const open = openLeads(leads, stages);
  const stalledAll = stalledLeads(open, stages, nowMs);
  return { waiting: { state: "ok", items: waitingOnReply(open, nowMs) }, stalled: { state: "ok", items: stalledAll }, stalledAll };
}

export async function runMorningBrief(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy } = ctx;
  if (!ctx.queueOrgKey) {
    return { itemsIn: 0, draftsOut: 0, summary: noQueueSummary(ctx, "briefing"), skipped: true };
  }
  const nowMs = ctx.now();
  const style = await readFirmStyle(admin, orgId);
  const tz = style.timeZone;

  let stages: Map<string, BriefStage> | null = null;
  let leads: BriefLead[] | null = null;
  try {
    stages = await readStages(admin, orgId);
    leads = await readOpenLeads(admin, orgId, stages);
  } catch {
    stages = null;
    leads = null;
  }
  const { waiting, stalled, stalledAll } = leadSections(stages, leads, nowMs);

  const gate = mailboxModuleState(ctx);
  // Independent reads, so they go at once: each catches its own failure and none waits on another.
  const [consults, suggestions, deadlines, pending] = await Promise.all([
    gate === "on"
      ? readTodaysConsults(admin, orgId, nowMs, tz)
      : Promise.resolve<BriefSections["consults"]>({ state: "blocked", reason: MAILBOX_GATE_REASON[gate] }),
    readPendingSuggestions(admin, orgId),
    readUpcomingDeadlines(admin, orgId, nowMs, tz),
    readPending(ctx.listPending),
  ]);
  const queue: BriefSections["queue"] = pending.state === "ok" ? { state: "ok", count: pending.items.length } : { state: "unavailable", reason: pending.reason };

  const sections: BriefSections = { consults, waiting, suggestions, stalled, deadlines, queue };
  if ([consults, waiting, suggestions, stalled, deadlines].every((s) => s.state !== "ok") && queue.state !== "ok") {
    throw new Error("The morning brief could not be written: none of its six sections could be read.");
  }

  // Follow-ups first, so the brief can say which stalled leads have one waiting.
  let note: FollowUpNote = { kind: "none" };
  let followUpsDrafted = 0;
  let followUpsFailed = 0;
  let unrecorded = 0;
  let followUpsDeferred = 0;
  const draftedFor = new Set<string>();
  if (stalled.state === "ok" && stalledAll.length > 0) {
    if (autonomy === "suggest") {
      note = { kind: "suggest" };
    } else {
      const plan: FollowUpPlan = await planFollowUps(ctx, stalledAll, pending);
      if (!plan.ok) {
        note = { kind: "blocked", reason: plan.reason };
      } else {
        for (const [index, item] of plan.chosen.entries()) {
          if (budgetNearlySpent(ctx, FOLLOW_UP_RESERVE_MS)) {
            followUpsDeferred = plan.chosen.length - index;
            break;
          }
          const result = await draftFollowUp(ctx, item, style.signOff);
          if (!result.ok) {
            followUpsFailed += 1;
            continue;
          }
          followUpsDrafted += 1;
          draftedFor.add(item.lead.id);
          if (!result.recorded) unrecorded += 1;
        }
        const s = plan.skips;
        note = {
          kind: "drafted",
          drafted: followUpsDrafted,
          cap: FOLLOW_UP_CAP,
          skipped: s.noAddress + s.pendingDraft + s.sensitive + s.recent + followUpsFailed,
          ...(followUpsDeferred > 0 ? { deferred: followUpsDeferred } : {}),
        };
      }
    }
  }

  // Names for the brief: the open leads already read, then whoever else a consult or suggestion names.
  const names = new Map<string, string>((leads ?? []).map((l) => [l.id, leadLabel(l)]));
  const extra = [
    ...(consults.state === "ok" ? consults.items.map((c) => c.leadId) : []),
    ...(suggestions.state === "ok" ? suggestions.items.map((s) => s.leadId) : []),
  ].filter((id): id is string => Boolean(id) && !names.has(id as string));
  let namesUnread = false;
  if (extra.length > 0) {
    try {
      for (const [id, label] of await readLeadNames(admin, orgId, extra)) names.set(id, label);
    } catch {
      namesUnread = true;
    }
  }
  const lead = (id: string | null) => (id ? (names.get(id) ?? (namesUnread ? "A lead (name could not be read)" : "A lead")) : "A consult with no lead linked");

  const brief = renderBrief({ nowMs, tz, sections, names: { lead, draftedFor }, followUps: note });
  await ctx.createDraft({
    orgKey: ctx.queueOrgKey,
    agent: "morning-brief",
    type: "BRIEFING",
    headline: brief.headline,
    summary: brief.summary,
    draftBody: brief.body,
  });

  const listed =
    (consults.state === "ok" ? consults.items.length : 0) +
    (waiting.state === "ok" ? waiting.items.length : 0) +
    (suggestions.state === "ok" ? suggestions.items.length : 0) +
    (stalled.state === "ok" ? stalled.items.length : 0) +
    (deadlines.state === "ok" ? deadlines.items.length : 0);
  // A firm with the Mailboxes module deliberately off has not "failed to read" its consults; an unreadable module list still has.
  const consultsDeliberatelyOff = gate === "off";
  const unread = [
    consults.state !== "ok" && !consultsDeliberatelyOff ? "consults" : null,
    waiting.state !== "ok" ? "waiting" : null,
    suggestions.state !== "ok" ? "suggestions" : null,
    stalled.state !== "ok" ? "stalled" : null,
    deadlines.state !== "ok" ? "deadlines" : null,
    queue.state !== "ok" ? "queue" : null,
  ].filter(Boolean);

  const parts = [`Brief written with ${plural(listed, "item", "items")} listed.`];
  if (queue.state === "ok") parts.push(`${plural(queue.count, "item", "items")} in the queue.`);
  if (followUpsDrafted > 0) parts.push(`${plural(followUpsDrafted, "follow-up draft", "follow-up drafts")} queued.`);
  if (followUpsFailed > 0) parts.push(`${plural(followUpsFailed, "follow-up", "follow-ups")} could not be drafted.`);
  if (followUpsDeferred > 0) parts.push(`${plural(followUpsDeferred, "follow-up was", "follow-ups were")} left for the next run (time limit).`);
  if (note.kind === "blocked") parts.push("No follow-ups were drafted because the queue or a link lookup could not be read.");
  if (unrecorded > 0) parts.push(`${plural(unrecorded, "follow-up", "follow-ups")} could not be recorded on the lead.`);
  if (unread.length > 0) parts.push(`Not read: ${unread.join(", ")}.`);
  if (consultsDeliberatelyOff) parts.push("Consults not connected (Mailboxes isn't switched on for your firm).");

  return { itemsIn: listed, draftsOut: 1 + followUpsDrafted, summary: parts.join(" ") };
}
