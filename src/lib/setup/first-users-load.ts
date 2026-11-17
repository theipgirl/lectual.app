import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMemberDirectory } from "@/lib/members/directory";
import { listConnections } from "@/lib/mailbox/connections";
import { loadColleagueMailboxes } from "@/lib/mailbox/colleague-connections";
import { hasDraftScope } from "@/lib/mailbox/providers";
import type { ColleagueMailboxes } from "@/lib/mailbox/colleague-rows";
import { firstUsers, ownItems, type AccountItem, type FirstUsers, type OwnConnection, type PersonIn } from "./first-users";
import type { Reading } from "./types";

/** The reads behind the account rows; named so a test can hand in fakes. Every one is through the caller's scoped client. */
export type FirstUsersReaders = {
  listMembers: () => Promise<PersonIn[]>;
  readModules: () => Promise<{ ok: true; modules: string[] } | { ok: false }>;
  listOwn: () => Promise<OwnConnection[] | null>;
  colleagues: (role: string) => Promise<ColleagueMailboxes>;
};

const FAILED = { ok: false } as const;

async function attempt<T>(run: () => Promise<T | null>): Promise<Reading<T>> {
  try {
    const value = await run();
    return value === null ? FAILED : { ok: true, value };
  } catch {
    return FAILED;
  }
}

export const liveFirstUsersReaders: FirstUsersReaders = {
  async listMembers() {
    const rows = await listMemberDirectory();
    return rows.map((m) => ({ userId: m.userId, name: m.displayName || m.email || null, role: m.role }));
  },
  async readModules() {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_org").select("modules").maybeSingle();
    if (error || !data) return { ok: false };
    return { ok: true, modules: data.modules ?? [] };
  },
  async listOwn() {
    const r = await listConnections();
    if (!r.ok) return null;
    return r.connections.map((c) => ({
      id: c.id,
      userId: c.user_id,
      scope: c.scope,
      provider: c.provider,
      status: c.status,
      email: c.email,
      canDraft: hasDraftScope(c.provider, c.scopes),
    }));
  },
  colleagues: loadColleagueMailboxes,
};

/**
 * Team accounts for the signed-in admin tier. Mailboxes are only read when the firm has the feature (the same rule as the Outlook item:
 * off must not read connections), and the owner-only call is made for role `owner` alone. Never throws.
 */
export async function loadFirstUsers(viewer: { id: string; role: string }, readers: FirstUsersReaders = liveFirstUsersReaders): Promise<FirstUsers> {
  const [members, modules] = await Promise.all([attempt(() => readers.listMembers()), attempt(async () => {
    const m = await readers.readModules();
    return m.ok ? m.modules : null;
  })]);
  const mailboxOn = modules.ok && modules.value.includes("mailbox");
  const [own, colleagues] = mailboxOn
    ? await Promise.all([
        attempt(() => readers.listOwn()),
        readers.colleagues(viewer.role).catch((): ColleagueMailboxes => ({ kind: "unavailable" })),
      ])
    : [FAILED as Reading<OwnConnection[]>, { kind: "not-asked" } as ColleagueMailboxes];
  return firstUsers({ viewerId: viewer.id, viewerRole: viewer.role, members, modules, own, colleagues });
}

/** The signed-in person's OWN two items (Getting started "Your setup"): their own scoped read, never anyone else's. */
export async function loadYourSetup(viewer: { id: string; role: string }, modules: string[] | null, readers: Pick<FirstUsersReaders, "listOwn"> = liveFirstUsersReaders): Promise<AccountItem[]> {
  const mods: Reading<string[]> = modules === null ? FAILED : { ok: true, value: modules };
  const mailboxOn = mods.ok && mods.value.includes("mailbox");
  const own = mailboxOn ? await attempt(() => readers.listOwn()) : (FAILED as Reading<OwnConnection[]>);
  return ownItems({ viewerId: viewer.id, viewerRole: viewer.role, modules: mods, own });
}
