import { AGENT_MOVES_TODAY_HREF } from "@/lib/stage-keeper/moves";
import { mailboxCount } from "./shared";
import { AGENT_DEFS, AGENT_IDS, type AgentId } from "./types";
import { DID_NOT_FINISH_ERROR, isStaleRun } from "./run-status";
import { friendlyRunError } from "./friendly-run-error";
import { LECTUAL_TOLD } from "@/lib/ui/words";

/**
 * The "Overnight run" digest on Today and the Agents page: what each agent
 * did in the window, in plain language, built ONLY from agent_run rows (their
 * counts and the runner's own one-line summaries). Nothing is estimated and
 * nothing is filled in: a count the log doesn't carry is left out, and a log
 * that couldn't be read says so (the caller passes `null`).
 *
 * Pure, so the wording and the arithmetic are tested against fixtures.
 */

export type DigestRun = {
  agent: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  items_in: number;
  drafts_out: number;
  summary: string | null;
  error: string | null;
};

/** `href` is null when there is nothing for the firm to click: the sentence is plain text. */
export type DigestAction = { label: string; href: string | null };

/** Shown for a failure the firm cannot fix. Lectual is emailed about every failed run (see failure-alert.ts). */
export const LECTUAL_TOLD_LABEL = LECTUAL_TOLD;

export type DigestLine = {
  agent: AgentId;
  name: string;
  /** e.g. "screened 12 new leads · 3 hot, need your review" */
  text: string;
  tone: "ok" | "attention" | "failed" | "quiet";
  href: string;
};

export type DigestFailure = {
  agent: AgentId;
  name: string;
  /** "Intake triage couldn't finish its last run" */
  text: string;
  reason: string;
  action: DigestAction;
  at: string;
};

export type RunDigest =
  | { status: "unavailable" }
  | {
      status: "ok";
      windowHours: number;
      runs: number;
      lines: DigestLine[];
      failures: DigestFailure[];
      lastRunAt: string | null;
    };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The hot count the triage runner writes into its summary
 * ("5 lead(s) scored, 2 hot."). Parsed, not guessed: a summary in any other
 * shape yields null and the clause is left out.
 */
export function triageHotCount(summary: string | null): number | null {
  const m = summary?.match(/\b(\d+) hot\b/);
  return m ? Number(m[1]) : null;
}

/** "3 email(s) read, 1 record(s) filled in." → 1 */
export function intelFilledCount(summary: string | null): number | null {
  const m = summary?.match(/\b(\d+) record\(s\) filled in\b/);
  return m ? Number(m[1]) : null;
}

/**
 * True when the morning brief's own summary says a section, the queue or a link
 * lookup could not be read ("Not read: queue.", "No follow-ups were drafted because
 * ..."). Such a brief is never reported as "nothing to report".
 */
export function briefHadUnreadSections(summary: string | null): boolean {
  return /\bNot read:/.test(summary ?? "") || /\bcould not be read\b/.test(summary ?? "");
}

/** The brief's consults section is off by the firm's own choice (Mailboxes module off): not a failed read. */
export function briefConsultsNotConnected(summary: string | null): boolean {
  return /\bConsults not connected\b/.test(summary ?? "");
}

/** "2 mailboxes could not be read." → 2 (0 when the inbox summary read every connection). */
export function inboxUnreadMailboxes(summary: string | null): number {
  const m = summary?.match(/\b(\d+) mailbox(?:es)? could not be read\./);
  return m ? Number(m[1]) : 0;
}

/** The inbox summary could not tell which messages are filed on a lead. */
export function inboxFiledLookupFailed(summary: string | null): boolean {
  return /\bfiled on a lead could not be checked\b/.test(summary ?? "");
}

/** What a consult-prep run's own summary says went wrong, as counts (all zero and `unreadCard` false = nothing went wrong). */
export type ConsultPrepProblems = { failed: number; heldBack: number; partial: number; unrecorded: number; unreadCard: boolean };

export function consultPrepProblems(summary: string | null): ConsultPrepProblems {
  const text = summary ?? "";
  const count = (re: RegExp) => Number(text.match(re)?.[1] ?? 0);
  return {
    failed: count(/\b(\d+) consults? could not be prepped/),
    heldBack: count(/\b(\d+) consults? held back because a draft contained attorney-judgment content/),
    partial: count(/\b(\d+) consults? got the heads-up but not the client email/),
    unrecorded: count(/\b(\d+) preps? could not be recorded on the lead/),
    unreadCard: /\bSome card sections could not be read/.test(text),
  };
}

/**
 * What the attorney should do about a failed run, from the error text the
 * runner stored. Only a few causes have a concrete fix in the app (reconnect a
 * mailbox or meeting source, try again later). Anything else, the approval
 * queue's own errors included, is not the firm's to fix: the card says Lectual
 * has been told, with no link.
 */
export function failureAction(error: string | null): DigestAction {
  const e = (error ?? "").toLowerCase();
  if (/mailbox|reconnect|refresh token|oauth|invalid_grant|401|403/.test(e)) {
    return { label: "Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" };
  }
  if (/fathom|zoom/.test(e)) return { label: "Reconnect the meeting source", href: "/dashboard/settings/integrations/meetings/" };
  if (/anthropic|overloaded|rate limit|429|529|timeout|timed out|time limit/.test(e)) {
    return { label: "Try Run now later", href: "/dashboard/agents/" };
  }
  return { label: LECTUAL_TOLD_LABEL, href: null };
}

/** The error as a person reads it: a fixed plain sentence, never the stored text (friendlyRunError). */
export function plainReason(error: string | null): string {
  const e = (error ?? "").trim();
  if (!e) return "The run stopped without saying why.";
  return friendlyRunError(e);
}

function lineFor(agent: AgentId, runs: DigestRun[]): DigestLine | null {
  const ok = runs.filter((r) => r.status === "ok");
  const name = AGENT_DEFS[agent].name;
  const items = ok.reduce((s, r) => s + (r.items_in ?? 0), 0);
  const drafts = ok.reduce((s, r) => s + (r.drafts_out ?? 0), 0);

  if (ok.length === 0) {
    const skipped = runs.filter((r) => r.status === "skipped");
    if (skipped.length > 0) {
      return { agent, name, text: `didn't run: ${skipped[0].summary ?? "skipped"}`, tone: "quiet", href: "/dashboard/agents/" };
    }
    return null; // only failures (reported separately) or still running
  }

  switch (agent) {
    case "intake-triage": {
      if (items === 0) return { agent, name, text: "found no new leads to screen", tone: "quiet", href: "/dashboard/intake/" };
      const hots = ok.map((r) => triageHotCount(r.summary));
      const hot = hots.every((h) => h !== null) ? hots.reduce<number>((s, h) => s + (h ?? 0), 0) : null;
      const parts = [`screened ${plural(items, "new lead", "new leads")}`];
      if (hot !== null && hot > 0) parts.push(`${hot} hot, ${hot === 1 ? "needs" : "need"} your review`);
      if (drafts > 0) parts.push(`${plural(drafts, "briefing", "briefings")} in Approvals`);
      return { agent, name, text: parts.join(" · "), tone: hot ? "attention" : "ok", href: "/dashboard/intake/" };
    }
    case "email-intel": {
      if (items === 0) return { agent, name, text: "found no new client email to read", tone: "quiet", href: "/dashboard/agents/" };
      const filled = ok.map((r) => intelFilledCount(r.summary));
      const filledTotal = filled.every((f) => f !== null) ? filled.reduce<number>((s, f) => s + (f ?? 0), 0) : null;
      const parts = [`read ${plural(items, "client email", "client emails")}`];
      if (filledTotal !== null && filledTotal > 0) parts.push(`filled in ${plural(filledTotal, "client record", "client records")}`);
      if (drafts > 0) parts.push(`${plural(drafts, "legal question", "legal questions")} flagged for the attorney (in Approvals)`);
      return { agent, name, text: parts.join(" · "), tone: drafts > 0 ? "attention" : "ok", href: drafts > 0 ? "/dashboard/queue/" : "/dashboard/agents/" };
    }
    case "post-consult": {
      if (items === 0) return { agent, name, text: "found no new consult notes", tone: "quiet", href: "/dashboard/agents/" };
      if (drafts === 0) {
        return { agent, name, text: `flagged ${plural(items, "follow-up", "follow-ups")} as due`, tone: "attention", href: "/dashboard/agents/" };
      }
      return { agent, name, text: `drafted ${plural(drafts, "follow-up", "follow-ups")} (in Approvals)`, tone: "attention", href: "/dashboard/queue/" };
    }
    case "stage-keeper": {
      // items_in is moves plus suggestion cards; drafts_out is the cards alone.
      const moved = Math.max(0, items - drafts);
      if (items === 0) return { agent, name, text: "found no lead to place", tone: "quiet", href: AGENT_MOVES_TODAY_HREF };
      const parts: string[] = [];
      if (moved > 0) parts.push(`moved ${plural(moved, "lead", "leads")}`);
      if (drafts > 0) parts.push(`${plural(drafts, "suggestion", "suggestions")} waiting on the lead page`);
      return { agent, name, text: parts.join(" · "), tone: drafts > 0 ? "attention" : "ok", href: AGENT_MOVES_TODAY_HREF };
    }
    case "morning-brief": {
      // drafts_out is the brief itself plus every follow-up it queued.
      const followUps = Math.max(0, drafts - ok.length);
      // A brief that couldn't read some section is not "nothing to report": the run's own summary says so.
      const unread = ok.some((r) => briefHadUnreadSections(r.summary));
      const parts = [`wrote the morning brief${ok.length > 1 ? ` (${ok.length} runs)` : ""}`];
      if (followUps > 0) parts.push(`${plural(followUps, "follow-up", "follow-ups")} drafted (in Approvals)`);
      else if (items === 0 && !unread) parts.push("nothing to report");
      if (unread) parts.push("some sections couldn't be read (see the brief)");
      if (ok.some((r) => briefConsultsNotConnected(r.summary))) parts.push("consults not connected");
      const tone = followUps > 0 || unread ? "attention" : items === 0 ? "quiet" : "ok";
      return { agent, name, text: parts.join(" · "), tone, href: "/dashboard/queue/" };
    }
    case "consult-prep": {
      // A run that failed or refused every consult has items === 0 too: its own summary says so, and it is not "nothing to prep".
      const problems = ok.map((r) => consultPrepProblems(r.summary));
      const sum = (pick: (p: ConsultPrepProblems) => number) => problems.reduce((s, p) => s + pick(p), 0);
      const failed = sum((p) => p.failed);
      const heldBack = sum((p) => p.heldBack);
      const partial = sum((p) => p.partial);
      const unrecorded = sum((p) => p.unrecorded);
      const unreadCard = problems.some((p) => p.unreadCard);
      if (failed + heldBack + partial + unrecorded === 0 && !unreadCard) {
        if (items === 0) return { agent, name, text: "found no consults to prep", tone: "quiet", href: "/dashboard/agents/" };
        return { agent, name, text: `prepped ${plural(items, "consult", "consults")} · ${plural(drafts, "draft", "drafts")} (in Approvals)`, tone: "attention", href: "/dashboard/queue/" };
      }
      const parts = [`prepped ${plural(items, "consult", "consults")}`];
      if (drafts > 0) parts.push(`${plural(drafts, "draft", "drafts")} (in Approvals)`);
      if (failed > 0) parts.push(`${failed} couldn't be prepped (will retry)`);
      if (heldBack > 0) parts.push(`${heldBack} held back (attorney-judgment content)`);
      if (partial > 0) parts.push(`${partial} got the heads-up but not the client email`);
      if (unrecorded > 0) parts.push(`${unrecorded} ${unrecorded === 1 ? "prep" : "preps"} couldn't be recorded on the lead (may be drafted again)`);
      if (unreadCard) parts.push("some card sections couldn't be read");
      return { agent, name, text: parts.join(" · "), tone: "attention", href: drafts > 0 ? "/dashboard/queue/" : "/dashboard/agents/" };
    }
    case "inbox-summary": {
      // drafts_out is the digest plus every reply draft left in Outlook; items_in is the messages sorted.
      const replies = Math.max(0, drafts - ok.length);
      // A mailbox that couldn't be read, or a failed filed-on-a-lead lookup, is not "no new mail".
      const unreadBoxes = ok.reduce((s, r) => s + inboxUnreadMailboxes(r.summary), 0);
      const lookupFailed = ok.some((r) => inboxFiledLookupFailed(r.summary));
      if (unreadBoxes > 0 || lookupFailed) {
        const parts = [`summarised the inbox (${plural(items, "message", "messages")})`];
        if (replies > 0) parts.push(`${plural(replies, "reply draft", "reply drafts")} in Outlook`);
        if (unreadBoxes > 0) parts.push(`${mailboxCount(unreadBoxes)} couldn't be read (reconnect it)`);
        if (lookupFailed) parts.push("couldn't tell which messages are filed on a lead");
        return { agent, name, text: parts.join(" · "), tone: "attention", href: unreadBoxes > 0 ? "/dashboard/settings/mailboxes/" : "/dashboard/queue/" };
      }
      if (items === 0 && replies === 0) return { agent, name, text: "found no new mail to summarise", tone: "quiet", href: "/dashboard/queue/" };
      const parts = [`summarised the inbox (${plural(items, "message", "messages")})`];
      if (replies > 0) parts.push(`${plural(replies, "reply draft", "reply drafts")} in Outlook`);
      return { agent, name, text: parts.join(" · "), tone: replies > 0 ? "attention" : "ok", href: "/dashboard/queue/" };
    }
  }
}

/**
 * Builds the digest from the run log. `runs === null` means the log couldn't
 * be read, which is reported as such and never as "nothing ran".
 *
 * A failure is reported only while it is the agent's LATEST finished run: an
 * agent that failed at 2am and succeeded at 6am is fine.
 */
export function buildRunDigest(runs: readonly DigestRun[] | null, now: Date, windowHours = 24): RunDigest {
  if (runs === null) return { status: "unavailable" };
  const since = now.getTime() - windowHours * 3_600_000;
  // A row still "running" 15 minutes on was cut off (run-status.ts): it reads as a run that didn't
  // finish, never as one still going, so it is reported like the runner's own time-limit failure.
  const inWindow = runs
    .filter((r) => Date.parse(r.started_at) >= since && (AGENT_IDS as readonly string[]).includes(r.agent))
    .map((r) => (isStaleRun(r, now.getTime()) ? { ...r, status: "error", error: DID_NOT_FINISH_ERROR } : r));

  const lines: DigestLine[] = [];
  const failures: DigestFailure[] = [];
  for (const agent of AGENT_IDS) {
    const mine = inWindow.filter((r) => r.agent === agent).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    if (mine.length === 0) continue;
    const line = lineFor(agent, mine);
    if (line) lines.push(line);
    const latestFinished = mine.find((r) => r.status !== "running");
    if (latestFinished?.status === "error") {
      const cutOff = latestFinished.error === DID_NOT_FINISH_ERROR;
      failures.push({
        agent,
        name: AGENT_DEFS[agent].name,
        text: cutOff ? `${AGENT_DEFS[agent].name} didn't finish its last run` : `${AGENT_DEFS[agent].name} couldn't finish its last run`,
        reason: plainReason(latestFinished.error),
        action: failureAction(latestFinished.error),
        at: latestFinished.started_at,
      });
    }
  }

  const lastRunAt = inWindow.reduce<string | null>((latest, r) => (!latest || Date.parse(r.started_at) > Date.parse(latest) ? r.started_at : latest), null);
  return { status: "ok", windowHours, runs: inWindow.length, lines, failures, lastRunAt };
}
