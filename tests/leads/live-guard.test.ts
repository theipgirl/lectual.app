import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M5 (lectual 0107): every crm_lead read or write leaves out merged leads, follows them to the keeper, or is listed
 * here with the reason it may see a merged lead. An occurrence of `.from("crm_lead")` passes when:
 *   - it is wrapped in `live(...)` (src/lib/leads/live.ts), or
 *   - its statement names `merged_into_id` / the `merged` flag (it reads the pointer and follows or skips it), or
 *   - its statement is an insert (a new lead is never merged), or
 *   - its file is in ALLOW below, with the reason.
 * A new list read must use `live(...)`; a new single-row read by id must follow the pointer or be allow-listed.
 */
const ROOT = path.resolve(__dirname, "../..");

const ALLOW: Record<string, string> = {
  "src/lib/leads/live.ts": "the helper itself: reads the pointer to follow it and to build the merged set",
  "src/lib/pipeline/leads.ts":
    "getLead reads by id so the lead page can redirect a merged lead; updateLead / moveLeadStage / assignLead write by id and a merged lead's guard refusal is shown as LEAD_MERGED_WRITE (friendlyLeadWriteError / friendlyMoveStageError)",
  "src/lib/intake/leads.ts": "setLane / setReferralSource read and write ONE lead by id; a merged lead's guard refusal is shown as LEAD_MERGED_WRITE",
  "src/app/dashboard/leads/[id]/actions.ts": "writes to the lead whose page is open; that page redirects a merged lead, and a refusal is LEAD_MERGED_WRITE",
  "src/app/dashboard/leads/[id]/stage-keeper-actions.ts": "reads the lead a suggestion card belongs to, then moves it through moveLeadStage (refusal mapped)",
  "src/app/dashboard/leads/[id]/consult-details-actions.ts": "checks the lead exists; consult notes move to the keeper in the merge",
  "src/app/dashboard/leads/[id]/proposal-actions.ts": "reads one lead's name for a proposal draft started from its (live) page",
  "src/app/dashboard/review/actions.ts": "re-reads the one lead of a review card (built from live lists) before moveLeadStage / assignLead (refusals mapped)",
  "src/app/dashboard/meetings/actions.ts": "reads the name of the lead a meeting is linked to; meetings move to the keeper in the merge",
  "src/app/dashboard/mail/page.tsx": "names the leads that stored mail rows point at (history: mail stays on a merged lead)",
  "src/app/dashboard/proposals/transcript-actions.ts": "reads the name of a lead chosen from a live picker",
  "src/app/dashboard/intake/actions.ts": "bulk move re-reads the ticked (live) leads by id and moves each through moveLeadStage (refusal mapped); the compare panel reads two leads by id",
  "src/app/dashboard/intake/reconcile/create-lead.ts": "duplicate check: a sheet key, Lawmatics id or address held by a merged lead still means the person exists, so no second lead is created",
  "src/app/dashboard/intake/merge/page.tsx": "the merge screen reads both leads with their pointer (merged_into_id is in its column list)",
  "src/lib/agents/consult-prep/facts.ts": "reads the lead a calendar consult is linked to; calendar events move to the keeper in the merge",
  "src/lib/agents/post-consult.ts": "reads the lead a meeting or consult note is linked to; both move to the keeper in the merge",
  "src/lib/agents/morning-brief/sections.ts": "the stalled-lead list is live; the second read only names leads by id for the brief",
  "src/lib/agents/inbox-summary/run.ts": "names leads for the digest (history: mail stays on a merged lead)",
  "src/lib/agents/intake-triage.ts": "the update writes only leads read through live(...) a moment before",
  "src/lib/agents/email-intel.ts": "the update writes only a lead read through live(...) a moment before",
  "src/lib/automation/drips.ts": "reads an enrolled lead's name; enrollments move to the keeper or are stopped in the merge",
  "src/lib/automation/engine.ts": "change_stage writes the rule's lead; a merged lead's refusal is recorded as LEAD_MERGED_WRITE",
  "src/lib/voice/notes.ts": "reads org_id of the page's (live) lead to file a note",
  "src/lib/matters/tasks.ts": "reads org_id of a task's lead; tasks move to the keeper in the merge",
  "src/lib/matters/matters.ts": "reads a lead's name for a matter opened from it",
  "src/lib/matters/activity.ts": "reads org_id to file a timeline row; a row on a merged lead is history read on the keeper, and the touch skips it (bumpLeadLastTouch is live)",
  "src/lib/review/detail-load.ts": "re-reads one record of the weekly review (built from live lists)",
  "src/lib/meetings/read.ts": "names the leads stored meetings point at",
  "src/lib/pipeline/notes.ts": "checks the page's lead exists before a note; a note on a merged lead is history read on the keeper",
  "src/lib/pipeline/consult-outcome.ts": "reads the page's lead for a consult outcome",
  "src/lib/pipeline/tags.ts": "reads org_id of a lead to tag it; tags are unioned onto the keeper in the merge",
  "src/lib/pipeline/move-as.ts": "the agent's update writes only a lead read through live(...) a moment before, fenced on its stage",
  "src/lib/mailbox/read-message-live.ts": "names the lead a stored mail row points at (history)",
  "src/lib/mailbox/apply.ts": "updates leads matched from the live list loadOrgContext reads",
  "src/lib/files/guard.ts": "checks the parent of a file; files stay on a merged lead and are read on the keeper",
  "src/lib/notifications/producers.ts": "names leads in the bell; notifications stay on a merged lead",
  "src/lib/intake-forms/load-results.ts": "names the leads of a form's submissions (history)",
  "src/lib/intake-forms/public.ts": "the insert files a new lead; the follow-up updates use live(...)",
  "src/lib/proposals/lead-link.ts": "reads the lead a proposal is linked to (proposals stay on a merged lead)",
  "src/lib/proposals/start-subject.ts": "reads the lead a New proposal link names; the pickers that build that link are live",
  "src/lib/proposals/consults-load.ts": "names the leads meetings point at",
  "src/lib/proposals/accept-followups.ts": "reads the Lawmatics id of a proposal's own lead (the record the note belongs to); the email match is live",
  "src/lib/time/entries.ts": "reads the lead a time entry is on; time entries move to the keeper in the merge",
  "src/lib/campaigns/stop-staff.ts": "reads org_id of leads whose sequences stop",
  "src/lib/campaigns/advance.ts": "reads an enrolled lead; enrollments move or are stopped in the merge",
  "src/lib/campaigns/stop.ts": "reads the queue item's own lead; the same-address match is live",
  "src/lib/campaigns/stop-facts.ts": "reads one lead's facts by id; the same-address match is live",
  "src/lib/calendar/outlook-read.ts": "names the leads stored events point at; events move to the keeper in the merge",
  "src/lib/calendar/consult-sources-live.ts": "names the leads of Today's consults",
  "src/lib/quotes/clients.ts": "names a quote's own lead (quotes stay on a merged lead); the picker list is live",
  "src/lib/quotes/accept-matter.ts": "reads and moves the lead resolveLeadId followed to the keeper",
  "src/lib/queue/stale.ts": "names the one lead an approval was resolved to; the address match is live",
  "src/lib/lawmatics/import.ts": "the insert files new leads; updates go only to live leads the planner matched (merged ones are skipped)",
  "src/lib/lawmatics/hired-sync.ts": "moves the lead the planner followed to the keeper, fenced on its stage",
  "src/lib/stage-keeper/held-consult.ts": "the update writes only leads read through live(...) a moment before",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function offenders(): string[] {
  const bad: string[] = [];
  for (const file of walk(path.join(ROOT, "src"))) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (rel === "src/lib/db/types.ts") continue;
    const text = fs.readFileSync(file, "utf8");
    let at = text.indexOf('.from("crm_lead")');
    while (at !== -1) {
      const before = text.slice(Math.max(0, at - 120), at);
      const end = text.indexOf(";", at);
      const statement = text.slice(at, end === -1 ? undefined : end);
      const ok =
        /live\(\s*[\w.]*\s*$/.test(before) ||
        /merged_into_id|merged \?/.test(statement) ||
        /\.insert\(/.test(statement) ||
        ALLOW[rel] !== undefined;
      if (!ok) bad.push(`${rel}:${text.slice(0, at).split("\n").length}`);
      at = text.indexOf('.from("crm_lead")', at + 1);
    }
  }
  return bad;
}

describe("crm_lead reads and writes respect merged leads (M5)", () => {
  it("every occurrence is live(...), follows the pointer, is an insert, or is allow-listed with a reason", () => {
    expect(offenders()).toEqual([]);
  });

  it("every allow-list entry still exists and has a reason", () => {
    for (const [file, reason] of Object.entries(ALLOW)) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("the main lists use live(...)", () => {
    for (const file of ["src/lib/pipeline/leads.ts", "src/lib/intake/leads.ts", "src/lib/intake/lost.ts", "src/lib/nav-counts.ts", "src/lib/reconcile/sources.ts", "src/lib/mailbox/sync.ts"]) {
      expect(fs.readFileSync(path.join(ROOT, file), "utf8"), file).toMatch(/live\(/);
    }
  });
});
