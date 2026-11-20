/**
 * The close guard's two decisions, with every read and write injected (no database here), so the rules are
 * tested without one. The scoped wiring is in matters.ts (`updateMatterStatus`, `closeMatterWithOverride`).
 *
 * The app guard runs BEFORE lectual 0110 exists and keeps running after it: the database trigger is the second
 * half of the same rule, and a refusal from it is mapped to a fixed sentence (never its own text).
 */
import {
  CLOSE_GUARD_UNREADABLE,
  canOverrideClose,
  closeRefusal,
  guardedDeadlines,
  parseOverrideReason,
  type GuardDeadline,
} from "./deadline-safety";

export type GuardMatterRead =
  | { status: "ok"; matter: { type: string | null; status: string } }
  | { status: "missing" }
  | { status: "unavailable" };

export type CloseReadDeps = {
  readMatter: () => Promise<GuardMatterRead>;
  /** Every OPEN docket entry of the matter, or null when the read failed. */
  readOpenDeadlines: () => Promise<GuardDeadline[] | null>;
};

export const MATTER_NOT_FOUND = "That matter couldn't be found. It may have been removed.";

export type CloseCheck =
  | { ok: true; guarded: GuardDeadline[]; previousStatus: string }
  | { ok: false; error: string; guarded?: GuardDeadline[] };

/** Reads the matter and its open deadlines; refuses on a failed read (never closes on a guess). */
async function readGuard(deps: CloseReadDeps): Promise<{ ok: true; guarded: GuardDeadline[]; previousStatus: string } | { ok: false; error: string }> {
  let matter: GuardMatterRead;
  try {
    matter = await deps.readMatter();
  } catch {
    return { ok: false, error: CLOSE_GUARD_UNREADABLE };
  }
  if (matter.status === "missing") return { ok: false, error: MATTER_NOT_FOUND };
  if (matter.status === "unavailable") return { ok: false, error: CLOSE_GUARD_UNREADABLE };
  let open: GuardDeadline[] | null;
  try {
    open = await deps.readOpenDeadlines();
  } catch {
    open = null;
  }
  if (open === null) return { ok: false, error: CLOSE_GUARD_UNREADABLE };
  return { ok: true, guarded: guardedDeadlines(matter.matter.type, open), previousStatus: matter.matter.status };
}

/** The plain close: allowed only with no guarded open deadline. */
export async function checkClose(deps: CloseReadDeps): Promise<CloseCheck> {
  const read = await readGuard(deps);
  if (!read.ok) return read;
  if (read.guarded.length > 0) return { ok: false, error: closeRefusal(read.guarded), guarded: read.guarded };
  return read;
}

export const OVERRIDE_ROLE_REFUSAL = "Only an attorney can close a matter that still has an open USPTO deadline.";
export const OVERRIDE_NOT_RECORDED = "Couldn't record the reason, so the matter wasn't closed. Try again.";
export const OVERRIDE_FAILED = "Couldn't close this matter. Nothing was changed. Try again.";

export type OverrideCall = "done" | "missing" | "forbidden" | "failed";

export type OverrideDeps = CloseReadDeps & {
  /** The caller's role, re-read on every call (null = unreadable, which never overrides). */
  role: () => Promise<string | null>;
  /** lectual 0110's `crm_close_matter_with_override` (writes the override row and closes, in one transaction). */
  callOverride: (reason: string) => Promise<OverrideCall>;
  /** Before 0110: the plain status write (there is no trigger yet). True when the row was closed. */
  closeDirect: () => Promise<boolean>;
  /** Puts the status back when the timeline entry could not be written on the pre-0110 path. */
  restoreStatus: (previous: string) => Promise<void>;
  /** The timeline entry (`matter_updated`, change `close_override`). True when it was written. */
  logOverride: (payload: { reason: string; deadline_ids: string[]; from_status: string; recorded: "override_row" | "timeline" }) => Promise<boolean>;
};

export type OverrideResult = { ok: true; overridden: boolean } | { ok: false; error: string };

/**
 * Close past the guard with a written reason. The role is checked FIRST (before any read): a paralegal posting
 * the form reads and writes nothing. With no guarded deadline left it is a plain close (no override recorded).
 * With 0110: the function writes the override row and closes; the timeline entry follows (best effort, the row is
 * the record). Before 0110: the close, then the timeline entry, which IS the record, so a failed entry puts the
 * status back and says the matter wasn't closed: a matter is never closed past the guard without a recorded reason.
 */
export async function runCloseOverride(rawReason: unknown, deps: OverrideDeps): Promise<OverrideResult> {
  let role: string | null;
  try {
    role = await deps.role();
  } catch {
    role = null;
  }
  if (!canOverrideClose(role)) return { ok: false, error: OVERRIDE_ROLE_REFUSAL };
  const parsed = parseOverrideReason(rawReason);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const read = await readGuard(deps);
  if (!read.ok) return read;
  if (read.previousStatus === "closed") return { ok: true, overridden: false };

  if (read.guarded.length === 0) {
    return (await deps.closeDirect()) ? { ok: true, overridden: false } : { ok: false, error: OVERRIDE_FAILED };
  }

  const ids = read.guarded.map((d) => d.id);
  const call = await deps.callOverride(parsed.reason);
  if (call === "forbidden") return { ok: false, error: OVERRIDE_ROLE_REFUSAL };
  if (call === "failed") return { ok: false, error: OVERRIDE_FAILED };
  if (call === "done") {
    await deps.logOverride({ reason: parsed.reason, deadline_ids: ids, from_status: read.previousStatus, recorded: "override_row" }).catch(() => false);
    return { ok: true, overridden: true };
  }

  // "missing": lectual 0110 is not applied, so there is no trigger and no override table. The timeline entry is the record.
  if (!(await deps.closeDirect())) return { ok: false, error: OVERRIDE_FAILED };
  const logged = await deps.logOverride({ reason: parsed.reason, deadline_ids: ids, from_status: read.previousStatus, recorded: "timeline" }).catch(() => false);
  if (!logged) {
    await deps.restoreStatus(read.previousStatus).catch(() => undefined);
    return { ok: false, error: OVERRIDE_NOT_RECORDED };
  }
  return { ok: true, overridden: true };
}
