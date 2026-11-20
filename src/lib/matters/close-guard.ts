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
import { CLOSE_OVERRIDE_UNRECORDED } from "@/lib/ui/words";

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

/** Lectual staff acting inside a firm: lectual 0110's function would refuse them (no membership row), so the app says so first. */
export const OVERRIDE_STAFF_PREVIEW = "Preview only: closing past a deadline isn't saved while you're viewing as the firm.";
export const OVERRIDE_ROLE_REFUSAL = "Only an attorney can close a matter that still has an open deadline.";
export const OVERRIDE_NOT_RECORDED = "Couldn't record the reason, so the matter wasn't closed. Try again.";
export const OVERRIDE_FAILED = "Couldn't close this matter. Nothing was changed. Try again.";

export type OverrideCall = "done" | "missing" | "forbidden" | "failed";

export type OverrideDeps = CloseReadDeps & {
  /**
   * True when the caller is Lectual staff acting inside the firm. lectual 0110's function needs a crm_org_member row, so it
   * would refuse them anyway; the app refuses them up front with its own fixed sentence. An unreadable answer counts as true.
   */
  actingAsStaff: () => Promise<boolean>;
  /** The caller's role, re-read on every call (null = unreadable, which never overrides). */
  role: () => Promise<string | null>;
  /** lectual 0110's `crm_close_matter_with_override` (writes the override row and closes, in one transaction). */
  callOverride: (reason: string) => Promise<OverrideCall>;
  /**
   * Before 0110: the plain status write (there is no trigger yet). The `updated_at` it wrote (as the database returned it)
   * when the row was closed, else null.
   */
  closeDirect: () => Promise<string | null>;
  /**
   * Puts the status back when the timeline entry could not be written on the pre-0110 path. Fenced on the row still
   * being `closed` AND still carrying the `updated_at` closeDirect wrote, so a newer change by someone else is never
   * overwritten; true only when exactly that one row was put back (an error or 0 rows is false).
   */
  restoreStatus: (previous: string, closedAt: string) => Promise<boolean>;
  /** Called when the restore failed too: the matter is closed with no recorded reason. Logs the matter id only. */
  reportUnrecorded: () => void;
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
  let staff: boolean;
  try {
    staff = await deps.actingAsStaff();
  } catch {
    staff = true;
  }
  if (staff) return { ok: false, error: OVERRIDE_STAFF_PREVIEW };
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
    return (await deps.closeDirect()) !== null ? { ok: true, overridden: false } : { ok: false, error: OVERRIDE_FAILED };
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
  const closedAt = await deps.closeDirect();
  if (closedAt === null) return { ok: false, error: OVERRIDE_FAILED };
  const logged = await deps.logOverride({ reason: parsed.reason, deadline_ids: ids, from_status: read.previousStatus, recorded: "timeline" }).catch(() => false);
  if (!logged) {
    let restored = false;
    try {
      restored = await deps.restoreStatus(read.previousStatus, closedAt);
    } catch {
      restored = false;
    }
    if (restored) return { ok: false, error: OVERRIDE_NOT_RECORDED };
    deps.reportUnrecorded();
    return { ok: false, error: CLOSE_OVERRIDE_UNRECORDED };
  }
  return { ok: true, overridden: true };
}
