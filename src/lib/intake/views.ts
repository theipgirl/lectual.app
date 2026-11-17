import type { Stage } from "@/lib/pipeline";
import { inPipelineOrder } from "@/lib/pipeline/stage-order";
// Type-only import: @/lib/members/directory is `import "server-only"`, but a
// `import type` is erased at compile time, so nothing from it reaches the
// client bundle this module is part of — same reasoning as rows.ts.
import type { MemberIdentity } from "@/lib/members/directory";
import { intakeStages } from "./scope";
import type { IntakeRow } from "./rows";
import { DEFAULT_ZONE } from "@/lib/stage-keeper/format";
import { formatDay } from "@/lib/ui/dates";
import {
  LEADS_NOTE_UNAVAILABLE,
  LEADS_NO_ACTIVITY_YET,
  LEADS_TOUCH_ACTIVITY_ONLY,
  LEADS_TOUCH_ACTIVITY_ONLY_TITLE,
  LEADS_TOUCH_NONE_TITLE,
  LEADS_TOUCH_NO_CONTACT,
  LEADS_TOUCH_OUR_TURN,
  LEADS_TOUCH_OUR_TURN_TITLE,
  LEADS_TOUCH_WAITING_ON_THEM,
  LEADS_TOUCH_WAITING_TITLE,
  TEAMMATE,
} from "@/lib/ui/words";

/**
 * Pure arrangement layer for /intake (blueprint §11): the same rows that
 * rows.ts builds, grouped into the two boards, plus the two strings the canvas
 * puts on every row — the "Next step" line and the top-bar count.
 *
 * Nothing here fetches, decides a permission, or reads the clock: `now` is
 * injected wherever it is needed, exactly as temperature.ts and rows.ts do, so
 * tests/intake/views.test.ts can pin every assertion.
 *
 * It is kept out of src/lib/intake/index.ts for the same reason rows.ts is —
 * that barrel covers the four §4 domain modules. Import this module by path.
 */

/** A leading integer in the stage's own name, e.g. "3 · Consult booked". */
const LEADING_NUMBER = /^\s*(\d+)/;

/**
 * The short code the canvas puts in the stage pill ("3 · Consult booked").
 *
 * `order_index` is the default because it is the only number every tenant's
 * pipeline is guaranteed to have. But RPB's team have spent years calling
 * these "stage 4" and "stage 7" off the spreadsheet, and some firms encode
 * that in the stage NAME — when they have, the name's number wins, because a
 * pill that disagrees with what the firm says out loud is worse than no pill.
 */
export function stageCodeFor(stage: Stage | null): string {
  if (!stage) return "—";
  const named = LEADING_NUMBER.exec(stage.name ?? "");
  if (named) return named[1];
  return String(stage.order_index);
}

/** The stage label with its leading code stripped, so the pill never says "3 · 3 Consult". */
export function stageLabelFor(stage: Stage | null): string {
  if (!stage) return "Unresolved";
  const name = (stage.name ?? "").trim();
  const stripped = name.replace(/^\s*\d+\s*[·.\-:)]?\s*/, "").trim();
  return stripped || name || "Unresolved";
}

export type StageColumn = {
  stage: Stage;
  code: string;
  label: string;
  count: number;
  rows: IntakeRow[];
};

/**
 * One column per INTAKE stage, in `order_index` order (canvas 10b).
 *
 * Built from the stage list rather than from the rows, so an empty stage is a
 * real, droppable column with "Nothing here" in it. A board that only draws
 * the stages that happen to be occupied hides exactly the column a Monday
 * triage is looking for — the one nobody has moved anyone into.
 *
 * Rows whose stage is not an intake stage (or is missing) are dropped rather
 * than swept into a catch-all: listIntakeLeads already scoped the read to
 * intake stages, so a row here that isn't in one is a stage that changed under
 * us, and inventing a column for it would be inventing data.
 */
export function stageColumns(rows: IntakeRow[], stages: Stage[]): StageColumn[] {
  const columns = inPipelineOrder(intakeStages(stages));

  return columns.map((stage) => {
    const inStage = rows.filter((row) => row.lead.current_stage_id === stage.id);
    return {
      stage,
      code: stageCodeFor(stage),
      label: stageLabelFor(stage),
      count: inStage.length,
      rows: inStage,
    };
  });
}

/** Two letters for an avatar/chip, from a display name, else an email, else "?". */
export function initialsOf(member: Pick<MemberIdentity, "displayName" | "email"> | null): string {
  const name = member?.displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  const email = member?.email?.trim();
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

/** Display name for an assignee, falling back through email to the raw id. */
export function memberLabel(member: MemberIdentity): string {
  return member.displayName?.trim() || member.email?.trim() || member.userId;
}

export type OwnerColumn = {
  /** auth.users id, or null for the Unassigned column. */
  key: string | null;
  label: string;
  initials: string;
  count: number;
  /** How many of this person's leads are waiting on the FIRM to reply. */
  waitingOnUs: number;
  /** The canvas's sub-line: "5 open · 2 waiting on us". */
  load: string;
  rows: IntakeRow[];
};

function describeLoad(count: number, waitingOnUs: number): string {
  if (count === 0) return "nothing right now";
  const open = `${count} open`;
  if (waitingOnUs === 0) return `${open} · none waiting on us`;
  if (waitingOnUs === count && count > 1) return `${open} · all waiting on us`;
  return `${open} · ${waitingOnUs} waiting on us`;
}

/**
 * Unassigned first, then one column per member of the firm (canvas 10c).
 *
 * Unassigned leads the board on purpose: "nobody is on the hook for this one"
 * is the single most actionable thing this view says, and a column sorted to
 * the end by alphabet is a column nobody reads.
 *
 * An assignee the directory couldn't resolve (0031 not applied, a member
 * removed since) still gets a column keyed on the raw id — their leads must
 * not silently fall into Unassigned, which would read as "free to grab".
 */
export function ownerColumns(rows: IntakeRow[], members: MemberIdentity[]): OwnerColumn[] {
  const build = (key: string | null, label: string, initials: string): OwnerColumn => {
    const mine = rows.filter((row) => (row.lead.assigned_to ?? null) === key);
    const waitingOnUs = mine.filter((row) => row.reply === "replied").length;
    return {
      key,
      label,
      initials,
      count: mine.length,
      waitingOnUs,
      load: key === null ? "needs a person" : describeLoad(mine.length, waitingOnUs),
      rows: mine,
    };
  };

  const known = new Set(members.map((member) => member.userId));
  const strays = Array.from(
    new Set(
      rows
        .map((row) => row.lead.assigned_to)
        .filter((id): id is string => typeof id === "string" && id !== "" && !known.has(id)),
    ),
  );

  return [
    build(null, "Unassigned", "—"),
    ...members.map((member) => build(member.userId, memberLabel(member), initialsOf(member))),
    ...strays.map((id) => build(id, TEAMMATE, "?")),
  ];
}

/**
 * "Sep 12": the day a stamp falls on in the firm's zone (`formatDay`, the one date formatter; the year only when it is not this year).
 * Null for no date or one that doesn't parse.
 */
export function touchDate(iso: string | null, timeZone: string = DEFAULT_ZONE): string | null {
  return formatDay(iso, { tz: timeZone });
}

export type TouchState = "our-turn" | "waiting" | "activity-only" | "none";

export type TouchStamp = {
  /** "Our turn · 16 Nov" / "Waiting on them · 15 Nov" / "Last activity · 12 Sep" / "No contact yet". */
  text: string;
  /** True when the lead spoke last, i.e. the firm owes the reply. */
  waitingOnUs: boolean;
  state: TouchState;
  /** One sentence for the cell's tooltip: what the words mean. */
  title: string;
};

/**
 * The Last-contact cell, in words (no arrows, so no legend). Dates are the Sheet's ("Nov 16"), in the firm's time zone. The direction is `row.reply`, the same field the arrows
 * read: "replied" = they wrote last (our turn), "awaiting" = we wrote last. "unknown" means no email or call is
 * recorded, so only the date of the newest activity is known; it says that and does not guess a side.
 */
/**
 * Every date on the Intake list and board, in the weekly review Sheet's words ("Nov 16", `shortDate`, the year only for another year),
 * on the firm's calendar day, with the month and day kept together on one line. Null for no date or one that doesn't parse.
 */
export function sheetDay(iso: string | null | undefined, now: Date, timeZone: string = DEFAULT_ZONE): string | null {
  // A date in the future is never shown ("Our turn · Dec 3" before Dec 3): it is treated as missing, like one that doesn't parse.
  const usable = usableTime(iso, now);
  if (!usable) return null;
  const day = formatDay(usable, { tz: timeZone, now });
  return day ? day.replace(" ", "\u00a0") : null;
}

/** The stamp itself when it parses and is not after `now`; else null. The ONE "is this a date we may show" rule: the cell and the sort both use it. */
export function usableTime(iso: string | null | undefined, now: Date): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  return iso && Number.isFinite(at) && at <= now.getTime() ? iso : null;
}

/**
 * Which date the Last-contact cell shows, and what kind it is, BEFORE it is worded. `touchStampFor` words it and the sort orders by it, so the
 * sort key and the shown date cannot disagree.
 *   our-turn       they wrote or called last: `last_inbound_at`
 *   waiting        we did: `last_outbound_at`
 *   activity-only  no email or call to go by: the newest of the lead's own dates (`lastTouchAt`, else `last_activity_at`)
 *   none           nothing usable (a future or unparseable date is missing): "No contact yet"
 */
export function shownTouch(row: IntakeRow, now: Date): { state: TouchState; iso: string | null } {
  const newest = usableTime(row.lastTouchAt, now) ?? usableTime(row.lead.last_activity_at, now);
  if (!newest) return { state: "none", iso: null };
  const inbound = usableTime(row.lead.last_inbound_at, now);
  const outbound = usableTime(row.lead.last_outbound_at, now);
  if (row.reply === "replied" && inbound) return { state: "our-turn", iso: inbound };
  if (row.reply === "awaiting" && outbound) return { state: "waiting", iso: outbound };
  return { state: "activity-only", iso: newest };
}

export function touchStampFor(row: IntakeRow, opts: { now: Date; timeZone?: string }): TouchStamp {
  const { state, iso } = shownTouch(row, opts.now);
  const day = sheetDay(iso, opts.now, opts.timeZone);
  if (state === "none" || !day) return { text: LEADS_TOUCH_NO_CONTACT, waitingOnUs: false, state: "none", title: LEADS_TOUCH_NONE_TITLE };
  if (state === "our-turn") return { text: LEADS_TOUCH_OUR_TURN(day), waitingOnUs: true, state, title: LEADS_TOUCH_OUR_TURN_TITLE };
  if (state === "waiting") return { text: LEADS_TOUCH_WAITING_ON_THEM(day), waitingOnUs: false, state, title: LEADS_TOUCH_WAITING_TITLE };
  return { text: LEADS_TOUCH_ACTIVITY_ONLY(day), waitingOnUs: false, state, title: LEADS_TOUCH_ACTIVITY_ONLY_TITLE };
}

/** Days since a timestamp, or null when there isn't one / it doesn't parse. */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
}

/** How long a lead may sit unanswered before "Next step" goes oxblood. */
const UNANSWERED_URGENT_DAYS = 3;

export type NextStep = {
  text: string;
  /** Render in NEXT_HOT: this row is past its stage's aging window, or unanswered. */
  urgent: boolean;
  /** "No activity yet" and "Note couldn't load": drawn muted, because they say nothing happened (or that we could not look). */
  muted: boolean;
};

/**
 * The "Next step" column (§11: *"Next step is not invented"*).
 *
 * It is the latest note when the firm wrote one, and otherwise a statement of
 * fact about the reply state — never a suggestion, never a deadline, never
 * anything a reader could mistake for legal advice. If nobody has written
 * anything and nothing has happened, it says so.
 */
export function nextStepFor(row: IntakeRow, now: Date, opts: { notesUnavailable?: boolean; timeZone?: string } = {}): NextStep {
  const waited = daysSince(row.lastTouchAt, now);
  const urgent =
    row.stale || (row.reply === "replied" && waited != null && waited >= UNANSWERED_URGENT_DAYS);

  const note = row.latestNote?.trim();
  if (note) return { text: note, urgent, muted: false };

  // Dated like the Last contact cell: their last email or call for "our reply", ours for "them", in the Sheet's words.
  const inbound = sheetDay(row.lead.last_inbound_at, now, opts.timeZone);
  const outbound = sheetDay(row.lead.last_outbound_at, now, opts.timeZone);
  if (row.reply === "replied" && inbound) {
    return { text: `Waiting on our reply since ${inbound}`, urgent, muted: false };
  }
  if (row.reply === "awaiting" && outbound) {
    return { text: `Waiting on them since ${outbound}`, urgent, muted: false };
  }
  // A failed notes read is never "no activity": the row says it could not look.
  return { text: opts.notesUnavailable ? LEADS_NOTE_UNAVAILABLE : LEADS_NO_ACTIVITY_YET, urgent, muted: true };
}

export type TopBarCounts = {
  inIntake: number;
  /** They spoke last, so the firm owes the first reply — replyState "replied". */
  needFirstReply: number;
  unassigned: number;
};

/**
 * The top-bar status line (§11 — Phase 1's KPI strip, moved into the chrome):
 * "25 in intake · 6 need a first reply · 3 unassigned".
 *
 * Pass the FILTERED rows: the line describes the list underneath it, never a
 * hidden total, so a filtered view can't claim 25 while showing 4.
 */
export function topBarCounts(rows: IntakeRow[]): TopBarCounts {
  return {
    inIntake: rows.length,
    needFirstReply: rows.filter((row) => row.reply === "replied").length,
    unassigned: rows.filter((row) => !row.lead.assigned_to).length,
  };
}

/** The counts as the one mono line the top bar renders. */
export function topBarLine(counts: TopBarCounts): string {
  return [
    `${counts.inIntake} in intake`,
    `${counts.needFirstReply} need a first reply`,
    `${counts.unassigned} unassigned`,
  ].join(" · ");
}
