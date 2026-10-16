import { AGENT_DEFS, AGENT_IDS, type AgentId } from "./types";

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

export type DigestAction = { label: string; href: string };

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
 * What the attorney should do about a failed run, from the error text the
 * runner stored. Only a few causes have a concrete fix in the app; everything
 * else points at the run log, which carries the full error.
 */
export function failureAction(error: string | null): DigestAction {
  const e = (error ?? "").toLowerCase();
  if (/mailbox|reconnect|refresh token|oauth|invalid_grant|401|403/.test(e)) {
    return { label: "Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" };
  }
  if (/fathom|zoom/.test(e)) return { label: "Reconnect the meeting source", href: "/dashboard/settings/integrations/meetings/" };
  if (/queue/.test(e)) return { label: "Check the approval queue", href: "/dashboard/queue/" };
  if (/anthropic|overloaded|rate limit|429|529|timeout|timed out/.test(e)) {
    return { label: "Try Run now later", href: "/dashboard/agents/" };
  }
  return { label: "Open the run log", href: "/dashboard/agents/" };
}

/** The error as a person reads it: first sentence, bounded. */
export function plainReason(error: string | null): string {
  const e = (error ?? "").trim();
  if (!e) return "The run stopped without saying why.";
  const first = e.split(/(?<=\.)\s/)[0];
  return first.length > 140 ? `${first.slice(0, 137)}…` : first;
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
      if (drafts > 0) parts.push(`${plural(drafts, "briefing", "briefings")} in the Queue`);
      return { agent, name, text: parts.join(" · "), tone: hot ? "attention" : "ok", href: "/dashboard/intake/" };
    }
    case "email-intel": {
      if (items === 0) return { agent, name, text: "found no new client email to read", tone: "quiet", href: "/dashboard/agents/" };
      const filled = ok.map((r) => intelFilledCount(r.summary));
      const filledTotal = filled.every((f) => f !== null) ? filled.reduce<number>((s, f) => s + (f ?? 0), 0) : null;
      const parts = [`read ${plural(items, "client email", "client emails")}`];
      if (filledTotal !== null && filledTotal > 0) parts.push(`filled in ${plural(filledTotal, "client record", "client records")}`);
      if (drafts > 0) parts.push(`${plural(drafts, "legal question", "legal questions")} flagged for the attorney (in the Queue)`);
      return { agent, name, text: parts.join(" · "), tone: drafts > 0 ? "attention" : "ok", href: drafts > 0 ? "/dashboard/queue/" : "/dashboard/agents/" };
    }
    case "post-consult": {
      if (items === 0) return { agent, name, text: "found no new consult notes", tone: "quiet", href: "/dashboard/agents/" };
      if (drafts === 0) {
        return { agent, name, text: `flagged ${plural(items, "follow-up", "follow-ups")} as due`, tone: "attention", href: "/dashboard/agents/" };
      }
      return { agent, name, text: `drafted ${plural(drafts, "follow-up", "follow-ups")} (in the Queue)`, tone: "attention", href: "/dashboard/queue/" };
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
  const inWindow = runs.filter((r) => Date.parse(r.started_at) >= since && (AGENT_IDS as readonly string[]).includes(r.agent));

  const lines: DigestLine[] = [];
  const failures: DigestFailure[] = [];
  for (const agent of AGENT_IDS) {
    const mine = inWindow.filter((r) => r.agent === agent).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    if (mine.length === 0) continue;
    const line = lineFor(agent, mine);
    if (line) lines.push(line);
    const latestFinished = mine.find((r) => r.status !== "running");
    if (latestFinished?.status === "error") {
      failures.push({
        agent,
        name: AGENT_DEFS[agent].name,
        text: `${AGENT_DEFS[agent].name} couldn't finish its last run`,
        reason: plainReason(latestFinished.error),
        action: failureAction(latestFinished.error),
        at: latestFinished.started_at,
      });
    }
  }

  const lastRunAt = inWindow.reduce<string | null>((latest, r) => (!latest || Date.parse(r.started_at) > Date.parse(latest) ? r.started_at : latest), null);
  return { status: "ok", windowHours, runs: inWindow.length, lines, failures, lastRunAt };
}
