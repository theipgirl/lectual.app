import type { Stage } from "@/lib/pipeline";
// Type-only import: @/lib/members/directory is `import "server-only"`, but a
// `import type` is erased at compile time, so nothing from it reaches the
// client bundle this module is part of — same reasoning as rows.ts.
import type { MemberIdentity } from "@/lib/members/directory";
import { intakeStages } from "./scope";
import type { IntakeRow } from "./rows";

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
  const columns = intakeStages(stages)
    .slice()
    .sort((a, b) => a.order_index - b.order_index);

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
    ...strays.map((id) => build(id, "Unknown teammate", "?")),
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "12 Sep" — the stamp the canvas puts in Last touch.
 *
 * Spelled out rather than handed to `toLocaleDateString`: that returns "Sept"
 * for September under newer ICU and "Sep" under older, so the same row renders
 * differently on the server and in the browser, which React reports as a
 * hydration mismatch. A twelve-entry table is not worth a locale.
 */
export function touchDate(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return null;
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

export type TouchStamp = {
  /** "12 Sep ←" / "9 Sep →" / "—". */
  text: string;
  /** True when the lead spoke last, i.e. the firm owes the reply. */
  waitingOnUs: boolean;
};

/**
 * The Last-touch cell. ← means waiting on US, → means waiting on THEM — the
 * legend is printed in the table footer, because an arrow nobody can decode is
 * decoration.
 */
export function touchStampFor(row: IntakeRow): TouchStamp {
  const date = touchDate(row.lastTouchAt);
  if (!date) return { text: "—", waitingOnUs: false };
  if (row.reply === "replied") return { text: `${date} ←`, waitingOnUs: true };
  return { text: `${date} →`, waitingOnUs: false };
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
};

/**
 * The "Next step" column (§11: *"Next step is not invented"*).
 *
 * It is the latest note when the firm wrote one, and otherwise a statement of
 * fact about the reply state — never a suggestion, never a deadline, never
 * anything a reader could mistake for legal advice. If nobody has written
 * anything and nothing has happened, it says so.
 */
export function nextStepFor(row: IntakeRow, now: Date): NextStep {
  const waited = daysSince(row.lastTouchAt, now);
  const urgent =
    row.stale || (row.reply === "replied" && waited != null && waited >= UNANSWERED_URGENT_DAYS);

  const note = row.latestNote?.trim();
  if (note) return { text: note, urgent };

  const since = touchDate(row.lastTouchAt);
  if (row.reply === "replied" && since) {
    return { text: `Waiting on our reply since ${since}`, urgent };
  }
  if (row.reply === "awaiting" && since) {
    return { text: `Waiting on them since ${since}`, urgent };
  }
  return { text: "No activity yet", urgent };
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
