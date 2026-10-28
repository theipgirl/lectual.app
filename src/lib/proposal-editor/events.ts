/**
 * The proposal's activity log, in plain English.
 *
 * Pure and total: takes the `client_proposal_event` rows and a map of
 * user id -> display name, returns sentences. The page adds the timestamp in
 * the firm's own time zone (`formatFirmStamp`); nothing here reads the clock
 * or a zone, so the same event always reads the same.
 *
 * An `edited` event carries `changes[]` (diff.ts via store.ts): a stable path,
 * a readable label, a format tag and before/after. Money stays in cents there;
 * this file is where it becomes "$4,950". A payload this build cannot read
 * (an older event, a hand-written one) degrades to "edited the proposal", never
 * to a guess and never to an exception.
 */

import { describeStepEvent } from "@/lib/proposals/paid";
import { EVENT_WORDS } from "./vocabulary";
import { describePayLinkEvent } from "./pay-link";
import type { ProposalChange, ProposalEventRow } from "@/lib/proposals/types";

export type EventContext = {
  /** user id -> a name to show (first name, display name or email). */
  names: ReadonlyMap<string, string>;
  /** proposal id -> version number, so a family-wide log can say which version. */
  versions?: ReadonlyMap<string, number>;
};

export type EventLine = {
  id: string;
  who: string;
  /** One sentence, no leading actor ("changed the Concierge base price from $4,950 to $4,500"). */
  what: string;
  /** Further sentences (the other changes of one save), each starting with a capital. */
  details: string[];
  version: number | null;
  /** ISO instant, for the caller to format. */
  at: string;
};

/** "$4,950", or "$4,950.50" when there are cents. */
export function formatDollars(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const rounded = Math.round(cents);
  const whole = rounded % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(rounded / 100);
}

function clip(s: string, n = 70): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** One side of a change, in words. */
export function formatChangeValue(format: ProposalChange["format"], value: ProposalChange["before"]): string {
  if (value === null || value === undefined || value === "") return "blank";
  switch (format) {
    case "cents":
      return typeof value === "number" ? formatDollars(value) : String(value);
    case "pct":
      return typeof value === "number" ? `${value}%` : String(value);
    case "count":
      return String(value);
    case "bool":
      return value === true ? "yes" : "no";
    default:
      return `“${clip(String(value))}”`;
  }
}

/** "Prosperall: base price" -> "Prosperall’s base price"; other labels unchanged. */
function possessive(label: string): string {
  const i = label.indexOf(": ");
  return i > 0 ? `${label.slice(0, i)}’s ${label.slice(i + 2)}` : label;
}

function whoOf(label: string): string {
  const i = label.indexOf(": ");
  return i > 0 ? label.slice(0, i) : label;
}

const NAME_PATH = /^names\[[^\]]+\]$/;
const MARK_PATH = /^names\[[^\]]+\]\.marks\[[^\]]+\]$/;
const CLASS_PATH = /^names\[[^\]]+\]\.classes\[[^\]]+\]$/;
const ADJUSTMENT_PATH = /^adjustments\[[^\]]+\]$/;
const INCLUDE_PATH = /^includes\[[^\]]+\]$/;

function quoted(v: ProposalChange["before"]): string {
  return formatChangeValue("text", v);
}

/** One field-level change as a clause: "changed the Concierge base price from $4,950 to $4,500". */
export function describeChange(change: ProposalChange): string {
  const { path, label, format, before, after } = change;
  const added = before === null || before === undefined;
  const removed = after === null || after === undefined;

  if (NAME_PATH.test(path)) {
    if (added) return `added the brand name ${quoted(after)}`;
    if (removed) return `removed the brand name ${quoted(before)}`;
    return `renamed the brand name from ${quoted(before)} to ${quoted(after)}`;
  }
  if (MARK_PATH.test(path)) {
    const who = whoOf(label);
    if (added) return `added a ${String(after)} to ${who}`;
    if (removed) return `removed the ${String(before)} from ${who}`;
    return `changed ${who}’s mark from ${String(before)} to ${String(after)}`;
  }
  if (CLASS_PATH.test(path)) {
    const who = whoOf(label);
    if (added) return `added the class ${quoted(after)} to ${who}`;
    if (removed) return `removed the class ${quoted(before)} from ${who}`;
    return `renamed a ${who} class from ${quoted(before)} to ${quoted(after)}`;
  }
  if (ADJUSTMENT_PATH.test(path)) {
    if (added) return `added the adjustment ${quoted(after)}`;
    if (removed) return `removed the adjustment ${quoted(before)}`;
    return `renamed the adjustment ${quoted(before)} to ${quoted(after)}`;
  }
  if (INCLUDE_PATH.test(path)) {
    if (added) return `added ${quoted(after)} to what’s included`;
    if (removed) return `removed ${quoted(before)} from what’s included`;
    return `renamed an included item from ${quoted(before)} to ${quoted(after)}`;
  }

  const subject = possessive(label);
  const b = formatChangeValue(format, before);
  const a = formatChangeValue(format, after);
  if (added) return `set ${subject} to ${a}`;
  if (removed) return `cleared ${subject} (it was ${b})`;
  return `changed the ${subject} from ${b} to ${a}`;
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function isChange(v: unknown): v is ProposalChange {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.path === "string" && typeof c.label === "string" && typeof c.format === "string";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Who did it: a teammate by name, or the system/agent/client by role. */
export function actorName(event: Pick<ProposalEventRow, "actor" | "actor_user_id">, names: ReadonlyMap<string, string>): string {
  switch (event.actor) {
    case "client":
      return "The client";
    case "agent":
      return "The drafting agent";
    case "system":
      return "Lectual";
    default:
      return (event.actor_user_id && names.get(event.actor_user_id)) || "A teammate";
  }
}

/** The consult agent's own 'edited' event (src/lib/proposals/agent-create.ts). */
const CONSULT_SOURCE = "consult-proposal";
const MAX_EVIDENCE_LINES = 12;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * "Created by the consult agent from <the meeting | a pasted transcript>", with
 * the quotes it relied on and the reviewer notes it left. Total: every part of
 * the payload is optional and checked, so an event written by an older or newer
 * build reads as a shorter sentence, never an exception.
 */
function describeConsultDraft(p: Record<string, unknown>, base: Pick<EventLine, "id" | "version" | "at">): EventLine {
  const title = str(p.meeting_title);
  const from = title ? `the meeting “${clip(title, 80)}”` : p.meeting_id ? "a recorded meeting" : "a pasted transcript";
  const details: string[] = [];
  const notes = str(p.notes);
  if (notes) details.push(`Notes for the reviewer: ${clip(notes, 900)}`);
  const evidence = Array.isArray(p.evidence) ? p.evidence : [];
  const items = evidence
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({ quote: str(e.quote), verified: e.verified === true }))
    .filter((e): e is { quote: string; verified: boolean } => e.quote !== null);
  for (const e of items.slice(0, MAX_EVIDENCE_LINES)) {
    details.push(e.verified ? `From the call: “${clip(e.quote, 160)}”` : `Not found word for word in the call, so check it: “${clip(e.quote, 160)}”`);
  }
  if (items.length > MAX_EVIDENCE_LINES) details.push(`And ${items.length - MAX_EVIDENCE_LINES} more quotes from the call.`);
  return { ...base, who: "The consult agent", what: `drafted this proposal from ${from}`, details };
}

export function describeProposalEvent(event: ProposalEventRow, ctx: EventContext): EventLine {
  const who = actorName(event, ctx.names);
  const p = event.payload && typeof event.payload === "object" ? event.payload : {};
  const version = ctx.versions?.get(event.proposal_id) ?? null;
  const base = { id: event.id, who, version, at: event.created_at };

  switch (event.type) {
    case "created":
      return { ...base, what: version ? `created version ${version}` : "created the proposal", details: [] };
    case "approved":
      return { ...base, what: EVENT_WORDS.approved, details: [] };
    case "unapproved":
      // 0089's client_proposal_log_status: {from, to, version, reason?}. The
      // reason is set when an edit (not the Edit again button) did it.
      return {
        ...base,
        what: p.reason === "edited_after_approval" ? EVENT_WORDS.unapprovedByEdit : EVENT_WORDS.unapproved,
        details: [],
      };
    case "sent":
      return { ...base, what: EVENT_WORDS.sent, details: [] };
    case "viewed":
      return { ...base, what: "opened the proposal", details: [] };
    case "accepted":
      return { ...base, what: "accepted the proposal", details: [] };
    case "withdrawn":
      return { ...base, what: "withdrew it", details: [] };
    case "superseded":
      // The trigger's payload is {from, to, version}, and `version` is the
      // SUPERSEDED row's own number, not the one that replaced it: sending a
      // newer version is what supersedes this one.
      return { ...base, what: EVENT_WORDS.superseded, details: [] };
    case "revised": {
      const from = num(p.from_version);
      const to = num(p.version);
      return {
        ...base,
        what: to && from ? `started version ${to} from version ${from}` : "started a new version",
        details: [],
      };
    }
    case "edited": {
      // Sprint 19: paid marks, the firm notice, Lawmatics notes and uploads are `edited` events with a `step`.
      const step = describeStepEvent(p);
      if (step) return { ...base, what: step, details: [] };
      // lectual 0100: the live pay link changed ({field: "pay_url", from_host, to_host}, written by the trigger).
      const payLink = describePayLinkEvent(p);
      if (payLink) return { ...base, what: payLink, details: [] };
      if (event.actor === "agent" && p.source === CONSULT_SOURCE) return describeConsultDraft(p, base);
      const changes = Array.isArray(p.changes) ? p.changes.filter(isChange) : [];
      const sentences = changes.map(describeChange);
      const details: string[] = [];
      const before = num(p.legal_total_before);
      const after = num(p.legal_total_after);
      let what: string;
      if (sentences.length === 0) {
        const fields = Array.isArray(p.fields) ? p.fields.filter((f): f is string => typeof f === "string") : [];
        what = fields.length > 0 ? `edited ${fields.map((f) => f.replace(/_/g, " ")).join(", ")}` : "edited the proposal";
      } else if (sentences.length === 1) {
        what = sentences[0];
      } else {
        what = `${sentences[0]}, and ${sentences.length - 1} other change${sentences.length === 2 ? "" : "s"}`;
        details.push(...sentences.map(capital));
      }
      if (before !== null && after !== null && before !== after) {
        details.push(`The legal fee at the default selection went from ${formatDollars(before)} to ${formatDollars(after)}.`);
      }
      if (p.reset_to_draft === true) details.push("It was saved, so it went back to draft and needs saving again.");
      return { ...base, what, details };
    }
    default:
      return { ...base, what: "updated the proposal", details: [] };
  }
}
