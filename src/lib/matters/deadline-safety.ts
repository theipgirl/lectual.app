/**
 * Deadline safety (PGE Sprint 3 Part A). Pure: no database, no server imports, so the matter page, the
 * Matters list, the Weekly review, the close action and their tests all read ONE set of rules.
 *
 *  1. "Filed with no open deadline": an open TM matter with a serial number or a filing date, and no open
 *     docket entry. A tag only: it never changes a bucket, a sort or a count. When the deadlines could not
 *     be read the answer is "unknown" and NOTHING is flagged (a failed read is never "no deadline").
 *  2. The close guard: closing a matter that holds an open deadline of a USPTO kind is refused, unless an
 *     attorney overrides it with a written reason. Until Rebecca says which kinds count (questions.md R1),
 *     EVERY open deadline on a TM matter counts; on any other matter the trademark kinds below count.
 */
import { deadlineKindLabel, type DeadlineKind } from "./deadline-rules";
import { isOpenMatter, type DocketMatterInput } from "./docket-summary";

/** The docket kinds that are USPTO trademark clocks (the litigation kinds and `other` are not). */
export const USPTO_DEADLINE_KINDS: readonly DeadlineKind[] = [
  "office_action_response",
  "statement_of_use",
  "sou_extension_request",
  "opposition_window",
  "section_8_declaration",
  "section_15_declaration",
  "section_9_renewal",
  "priority_filing",
];

export type FiledMatterInput = Pick<DocketMatterInput, "status" | "stage"> & {
  type?: string | null;
  serial_number?: string | null;
  filing_date?: string | null;
};

const filled = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

/** Open (lifecycle `open`, docket stage not a closed one), type TM, and a serial number or a filing date. */
export function isFiledTrademark(m: FiledMatterInput): boolean {
  if (m.status !== "open") return false;
  if (!isOpenMatter({ status: m.status, stage: m.stage } as DocketMatterInput)) return false;
  if ((m.type ?? "TM") !== "TM") return false;
  return filled(m.serial_number) || filled(m.filing_date);
}

/**
 * The flag. `openDeadlineMatterIds` is the set of matter ids holding at least one `open` docket entry, or
 * null when that read failed: then nothing is flagged.
 */
export function noOpenDeadline(m: FiledMatterInput & { id: string }, openDeadlineMatterIds: ReadonlySet<string> | null): boolean {
  if (openDeadlineMatterIds === null) return false;
  return isFiledTrademark(m) && !openDeadlineMatterIds.has(m.id);
}

// ── the close guard ─────────────────────────────────────────────────────────

export type GuardDeadline = { id: string; kind: string; title: string | null; due_date: string; status: string };

export function isUsptoDeadlineKind(kind: string): boolean {
  return (USPTO_DEADLINE_KINDS as readonly string[]).includes(kind);
}

/** The open deadlines that block a close: every open one on a TM matter (R1 default), else the USPTO kinds. Soonest first. */
export function guardedDeadlines<T extends GuardDeadline>(matterType: string | null | undefined, deadlines: readonly T[]): T[] {
  const tm = (matterType ?? "TM") === "TM";
  return deadlines
    .filter((d) => d.status === "open" && (tm || isUsptoDeadlineKind(d.kind)))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
}

function labelOf(d: GuardDeadline): string {
  const t = d.title?.trim();
  if (t) return t;
  try {
    return deadlineKindLabel(d.kind as DeadlineKind);
  } catch {
    return "a deadline";
  }
}

/** "Office action response (due 2026-12-01)", the first one, plus how many more. */
export function guardedNames(deadlines: readonly GuardDeadline[]): string {
  if (deadlines.length === 0) return "";
  const first = `${labelOf(deadlines[0])} (due ${deadlines[0].due_date})`;
  return deadlines.length === 1 ? first : `${first} and ${deadlines.length - 1} more`;
}

/** The fixed refusal, naming the deadline. */
export function closeRefusal(deadlines: readonly GuardDeadline[]): string {
  return `This matter can't be closed while it has an open USPTO deadline: ${guardedNames(deadlines)}. Close the deadline out first, or an attorney can close the matter with a reason.`;
}

/** Said when the deadlines could not be read: the close is refused, never allowed on a guess. */
export const CLOSE_GUARD_UNREADABLE = "Couldn't check this matter's deadlines, so it wasn't closed. Refresh and try again.";

/** Said when the database's own guard refused the write (lectual 0110's trigger), without naming text from the database. */
export const CLOSE_GUARD_DATABASE = "This matter can't be closed while it has an open USPTO deadline. Close the deadline out first, or an attorney can close the matter with a reason.";

/**
 * Who may close past the guard. Rebecca's answer (questions.md R2) is not in yet; until it is, the owner and
 * attorney roles (the roles that can confirm a deadline), with a reason required. A role rule, never a name.
 */
export const CLOSE_OVERRIDE_ROLES = ["owner", "attorney"] as const;

export function canOverrideClose(role: string | null | undefined): boolean {
  return !!role && (CLOSE_OVERRIDE_ROLES as readonly string[]).includes(role);
}

export const OVERRIDE_REASON_MAX = 300;

/** The reason, trimmed and with control characters made spaces; 1..300 characters or an error sentence. */
export function parseOverrideReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Give a reason for closing this matter with an open deadline." };
  const reason = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!reason) return { ok: false, error: "Give a reason for closing this matter with an open deadline." };
  if (reason.length > OVERRIDE_REASON_MAX) return { ok: false, error: `Keep the reason to ${OVERRIDE_REASON_MAX} characters or fewer.` };
  return { ok: true, reason };
}

/** The 0110 trigger's refusal, recognised by its prefix only (its text is never shown). */
export function isCloseGuardRefusal(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.includes("matter_close_open_deadline");
}

/** lectual 0110's override function is not there yet (42883 / PGRST202): the app's own override path runs instead. */
export function isMissingOverrideFunction(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "42883" || code === "PGRST202";
}
