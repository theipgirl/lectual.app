import { civilLabel, dayInZone, whenInZone } from "../shared";
import type { ConsultItem, DeadlineItem, Section, SuggestionItem } from "./sections";
import type { StalledLead, WaitingLead } from "./rules";
import { DEADLINE_DAYS } from "./sections";

/**
 * The morning brief's text, from the six sections. Pure. Plain headed sections with a count in each
 * heading, no object dumps, dates in the firm's zone in words. A section that could not be read says
 * so and why; a section that was read and is empty says "Nothing today". The two are never the same.
 */

/** How many items a section lists before "and N more". */
export const LIST_CAP = 10;

export const NOTHING = "Nothing today.";

export type QueueSection = { state: "ok"; count: number } | { state: "unavailable"; reason: string };

export type FollowUpNote =
  | {
      kind: "drafted";
      drafted: number;
      cap: number;
      skipped: number;
      /** Chosen but not drafted because the run's time budget was nearly spent. Absent = none. */
      deferred?: number;
    }
  | { kind: "suggest" }
  | { kind: "blocked"; reason: string }
  | { kind: "none" };

export type BriefSections = {
  consults: Section<ConsultItem>;
  waiting: Section<WaitingLead>;
  suggestions: Section<SuggestionItem>;
  stalled: Section<StalledLead>;
  deadlines: Section<DeadlineItem>;
  queue: QueueSection;
};

export type BriefNames = { lead: (id: string | null) => string; draftedFor: ReadonlySet<string> };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function heading(title: string, section: { state: string; items?: unknown[] }): string {
  switch (section.state) {
    case "ok":
      return `${title} (${(section.items ?? []).length})`;
    case "blocked":
      return `${title} (not read)`;
    case "database-update-needed":
      return `${title} (not available yet)`;
    default:
      return `${title} (could not be read)`;
  }
}

/** The body lines for a section that is not `ok`, or null when it is. */
function notOk(section: { state: string; reason?: string }): string | null {
  switch (section.state) {
    case "blocked":
      return section.reason ? `Not read: ${section.reason}.` : "Not read.";
    case "database-update-needed":
      return "Not available until the database update.";
    case "unavailable":
      return `Couldn't be read: ${section.reason}.`;
    default:
      return null;
  }
}

function block<T>(title: string, section: Section<T>, line: (item: T) => string): string[] {
  const out = [heading(title, section as { state: string; items?: unknown[] })];
  const problem = notOk(section as { state: string; reason?: string });
  if (problem) return [...out, problem];
  if (section.state !== "ok") return out;
  if (section.items.length === 0) return [...out, NOTHING];
  const extra = section.items.length - LIST_CAP;
  return [...out, ...section.items.slice(0, LIST_CAP).map((item) => `- ${line(item)}`), ...(extra > 0 ? [`and ${extra} more`] : [])];
}

export function dayLabel(nowMs: number, tz: string): string {
  return `${dayInZone(nowMs, tz)}, ${new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(nowMs)}`;
}

export function renderBrief(args: {
  nowMs: number;
  tz: string;
  sections: BriefSections;
  names: BriefNames;
  followUps: FollowUpNote;
}): { headline: string; summary: string; body: string } {
  const { sections: s, names, tz } = args;
  const lead = (id: string | null) => names.lead(id);
  const lines: string[] = [];

  lines.push(
    ...block("Today's consults", s.consults, (c) => `${lead(c.leadId)}, ${whenInZone(c.startsAt, tz)}${c.joinUrl ? `, join: ${c.joinUrl}` : ""}`),
    "",
    ...block("Leads waiting on a reply", s.waiting, (w) => {
      const name = lead(w.lead.id);
      return `${name}, waiting ${plural(w.days, "day", "days")}`;
    }),
    "",
    ...block("Pending stage suggestions", s.suggestions, (x) => {
      const move = x.from && x.to ? `${x.from} to ${x.to}` : (x.to ?? "a new stage");
      return `${lead(x.leadId)}: ${move}. ${x.reason}`;
    }),
    "",
    ...block("Stalled leads", s.stalled, (x) => `${lead(x.lead.id)}: ${x.reason}${names.draftedFor.has(x.lead.id) ? " (follow-up drafted)" : ""}`),
  );
  const note = followUpLine(args.followUps);
  if (note && s.stalled.state === "ok" && s.stalled.items.length > 0) lines.push(note);
  lines.push(
    "",
    ...block(`Matters with deadlines in the next ${DEADLINE_DAYS} days`, s.deadlines, (d) => {
      const status = d.confirmed ? "confirmed by the attorney" : "estimate, confirm against TSDR";
      return `${civilLabel(d.dueDay)}: ${d.kind}, ${d.matterLabel} (${status})`;
    }),
    "",
  );
  if (s.queue.state === "ok") {
    lines.push(`The queue (${s.queue.count})`, s.queue.count === 0 ? "Nothing today: no items are waiting for review." : `${plural(s.queue.count, "item is", "items are")} waiting for review.`);
  } else {
    lines.push("The queue (could not be read)", `Couldn't be read: ${s.queue.reason}.`);
  }
  lines.push("", "Prepared by the Morning brief agent for the attorney. Nothing in it was sent to anyone.");

  const counts = [
    s.consults.state === "ok" ? plural(s.consults.items.length, "consult", "consults") : null,
    s.waiting.state === "ok" ? `${s.waiting.items.length} waiting` : null,
    s.stalled.state === "ok" ? `${s.stalled.items.length} stalled` : null,
    s.deadlines.state === "ok" ? plural(s.deadlines.items.length, "deadline", "deadlines") : null,
  ].filter(Boolean);
  const unread = [s.consults, s.waiting, s.suggestions, s.stalled, s.deadlines].filter((x) => x.state !== "ok").length + (s.queue.state === "ok" ? 0 : 1);

  return {
    headline: `Morning brief for ${dayLabel(args.nowMs, tz)}`,
    summary: `${counts.join(", ")}${unread > 0 ? `. ${plural(unread, "section", "sections")} could not be read.` : "."}`,
    body: lines.join("\n"),
  };
}

function followUpLine(note: FollowUpNote): string | null {
  switch (note.kind) {
    case "drafted":
      return (
        `Follow-up emails drafted: ${note.drafted} (at most ${note.cap} a day)${note.skipped > 0 ? `, ${note.skipped} stalled ${note.skipped === 1 ? "lead was" : "leads were"} skipped` : ""}. They are in the queue.` +
        (note.deferred
          ? ` ${note.deferred} more ${note.deferred === 1 ? "was" : "were"} not drafted because this run reached its time limit; the next run picks ${note.deferred === 1 ? "it" : "them"} up.`
          : "")
      );
    case "suggest":
      return "No follow-up emails were drafted: this agent is set to suggest.";
    case "blocked":
      return `No follow-up emails were drafted: ${note.reason}.`;
    default:
      return null;
  }
}
