import type { OrgProfile } from "@/lib/org/profile-rules";
import type { ListResult } from "@/lib/mailbox/connections";
import type { ConnectionRead as LawmaticsRead } from "@/lib/lawmatics/connection";
import type { ConnectionsRead as MeetingsRead } from "@/lib/meetings/connection";
import type { ConnectionRead as LawPayRead } from "@/lib/payments/lawpay-connection";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import type { ServiceItemRow } from "@/lib/quotes/types";
import type { Reading, SetupState } from "./types";

/**
 * The reads behind the checklist, named after the existing readers they stand
 * for so a test can hand in fakes. Each is one read of the caller's own firm,
 * through the scoped client (RLS), and none writes. A reader that throws, or
 * reports a failure, becomes "could not be read" for its own item and nothing else.
 */
export type SetupReaders = {
  getOrgProfile: () => Promise<Pick<OrgProfile, "display_name" | "email_signature"> | null>;
  listMemberDirectory: () => Promise<unknown[]>;
  /** The firm's module list. Unlike `activeOrgModules`, a failed read is reported, not turned into []. */
  readModules: () => Promise<{ ok: true; modules: string[] } | { ok: false }>;
  listConnections: () => Promise<ListResult>;
  getLawmaticsConnection: () => Promise<LawmaticsRead>;
  listMeetingConnections: () => Promise<MeetingsRead>;
  getLawPayConnection: () => Promise<LawPayRead>;
  readAgentSettings: () => Promise<{ ok: true; rows: { enabled: boolean }[] } | { ok: false }>;
  listIntakeForms: () => Promise<
    { status: "ok"; value: Pick<IntakeFormRecord, "status">[] } | { status: "unconfigured" } | { status: "unavailable"; error?: unknown }
  >;
  listServiceItems: () => Promise<Pick<ServiceItemRow, "active" | "kind">[]>;
  aiConfigured: () => boolean;
  /** Whether the deployment holds the LawPay / Zoom OAuth app. Optional so a fake reader set need not name them. */
  lawpayAppConfigured?: () => boolean;
  zoomAppConfigured?: () => boolean;
};

const FAILED = { ok: false } as const;

/** Runs one read; a throw (sync or async) or a failure result is `{ ok: false }`, with the error text dropped on purpose. */
async function read<R, T>(run: () => Promise<R>, pick: (result: R) => T | null): Promise<Reading<T>> {
  try {
    const value = pick(await run());
    return value === null ? FAILED : { ok: true, value };
  } catch {
    return FAILED;
  }
}

/**
 * Reads every fact the checklist needs, each independently. Never throws.
 * Nothing about an error (message, code, constraint, id) is kept: the state
 * says only that a read failed.
 */
export async function buildSetupState(r: SetupReaders): Promise<SetupState> {
  const [profile, members, modules, mailboxes, lawmatics, meetings, lawpay, agents, intakeForms, services] = await Promise.all([
    read(r.getOrgProfile, (p) => ({ value: p ? { displayName: p.display_name, emailSignature: p.email_signature } : null })),
    read(r.listMemberDirectory, (rows) => ({ count: rows.length })),
    read(r.readModules, (m) => (m.ok ? m.modules : null)),
    read(r.listConnections, (c) => (c.ok ? c.connections.map((x) => ({ provider: x.provider, status: x.status })) : null)),
    read(r.getLawmaticsConnection, (c) => (c.ok ? { value: c.connection ? { status: c.connection.status } : null } : null)),
    read(r.listMeetingConnections, (c) => (c.ok ? c.connections.map((x) => ({ provider: x.provider, status: x.status })) : null)),
    read(r.getLawPayConnection, (c) => (c.ok ? { value: c.connection ? { status: c.connection.status } : null } : null)),
    read(r.readAgentSettings, (a) => (a.ok ? a.rows.map((x) => ({ enabled: x.enabled === true })) : null)),
    // "unconfigured" means the table cannot be asked: not "no intake forms".
    read(r.listIntakeForms, (f) => (f.status === "ok" ? f.value.map((x) => ({ status: x.status })) : null)),
    read(r.listServiceItems, (items) => items.map((x) => ({ active: x.active, kind: x.kind }))),
  ]);

  return {
    profile: unwrap(profile),
    members,
    modules,
    mailboxes,
    lawmatics: unwrap(lawmatics),
    meetings,
    lawpay: unwrap(lawpay),
    agents,
    intakeForms,
    services,
    aiConfigured: safeBoolean(r.aiConfigured),
    // A reader that is absent or throws means "switched on", so the item stays the firm's to finish.
    lectual: {
      lawpayApp: appSwitchedOn(r.lawpayAppConfigured),
      zoomApp: appSwitchedOn(r.zoomAppConfigured),
    },
  };
}

/** Readers whose "no row" answer is `null` wrap it as `{ value }` so `null` can't be confused with "failed". */
function unwrap<T>(reading: Reading<{ value: T }>): Reading<T> {
  return reading.ok ? { ok: true, value: reading.value.value } : FAILED;
}

/** Only an explicit `false` makes a step Lectual's; a missing or failing reader leaves it the firm's to finish. */
function appSwitchedOn(fn: (() => boolean) | undefined): boolean {
  try {
    return fn ? fn() !== false : true;
  } catch {
    return true;
  }
}

function safeBoolean(fn: () => boolean): boolean {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}
