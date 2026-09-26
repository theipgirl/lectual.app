import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEmailEvidence, type EvidenceLead } from "@/lib/intake/email-match";
import { openToken, sealToken } from "./crypto";
import { fetchNewMessages } from "./fetch";
import { matchMessageToMatter, type MatterContact, type MatterLink } from "./matter-match";
import { applyRun, planActivities, type ApplyCounts } from "./apply";
import {
  ProviderError,
  refreshAccessToken,
  type ClientCredentials,
  type MailboxProvider,
} from "./providers";

/**
 * The mailbox sync: every active connection, in every firm that holds the
 * `mailbox` module, pulled and matched. Run by /api/cron/mailbox-sync.
 *
 * It runs as the SERVICE ROLE because nobody is signed in at 3am. That makes
 * this file the one place where tenant isolation is the code's job rather than
 * RLS's, so the rule is mechanical: every read and write is filtered by the
 * org_id of the mailbox_connection row being synced — a value that came out
 * of the database, never out of a request.
 *
 * One connection failing never stops the others. A dead refresh token marks
 * the row `reauth` (the Mailboxes page shows "Reconnect"); anything else marks
 * it `error` and the next run tries again.
 */

export type ConnectionRow = {
  id: string;
  org_id: string;
  provider: MailboxProvider;
  email: string;
  status: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  sync_cursor: string | null;
  matched_count: number;
};

export type SyncDeps = {
  admin: SupabaseClient;
  root: Buffer;
  credentials: (provider: MailboxProvider) => ClientCredentials | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type ConnectionOutcome =
  | { id: string; orgId: string; ok: true; read: number; counts: ApplyCounts; truncated: boolean }
  | { id: string; orgId: string; ok: false; status: "reauth" | "error"; error: string };

/** Refresh the access token if it expires within two minutes; re-seal what changed. */
export async function freshAccessToken(deps: SyncDeps, row: ConnectionRow): Promise<string> {
  const now = deps.now?.() ?? Date.now();
  if (!row.refresh_token_enc) throw new ProviderError("No stored refresh token. Reconnect this mailbox.", "reauth");
  const current = row.access_token_enc ? openToken(deps.root, row.access_token_enc) : null;
  const expires = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  if (current && expires - now > 120_000) return current;

  const creds = deps.credentials(row.provider);
  if (!creds) throw new ProviderError(`${row.provider} sign-in isn't configured on this deployment.`, "refresh-failed");
  const refreshed = await refreshAccessToken({
    provider: row.provider,
    creds,
    refreshToken: openToken(deps.root, row.refresh_token_enc),
    fetchImpl: deps.fetchImpl,
    now,
  });
  const update: Record<string, unknown> = {
    access_token_enc: sealToken(deps.root, refreshed.accessToken),
    token_expires_at: refreshed.expiresAt,
    updated_at: new Date(now).toISOString(),
  };
  // Microsoft rotates refresh tokens; losing the new one kills the connection.
  if (refreshed.refreshToken) update.refresh_token_enc = sealToken(deps.root, refreshed.refreshToken);
  const { error } = await deps.admin
    .from("mailbox_connection")
    .update(update)
    .eq("id", row.id)
    .eq("org_id", row.org_id);
  if (error) throw new Error(`token store failed: ${error.message}`);
  return refreshed.accessToken;
}

/** What one firm's matching needs, loaded once per firm per run. */
export type OrgContext = {
  leads: EvidenceLead[];
  contacts: MatterContact[];
  links: MatterLink[];
  memberRoles: Map<string, string>;
};

export async function loadOrgContext(admin: SupabaseClient, orgId: string): Promise<OrgContext> {
  const leadRows: Record<string, unknown>[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("crm_lead")
      .select("id, first_name, last_name, business_name, email, mark_text, assigned_to, last_outbound_at, last_inbound_at")
      .eq("org_id", orgId)
      .range(from, from + 999);
    if (error) throw new Error(`lead read failed: ${error.message}`);
    leadRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const leads: EvidenceLead[] = leadRows.map((l) => ({
    id: l.id as string,
    firstName: (l.first_name as string | null) ?? "",
    lastName: (l.last_name as string | null) ?? "",
    businessName: (l.business_name as string | null) ?? null,
    email: (l.email as string | null) ?? null,
    markText: (l.mark_text as string | null) ?? null,
    stageName: null,
    assignedTo: (l.assigned_to as string | null) ?? null,
    lastOutboundAt: (l.last_outbound_at as string | null) ?? null,
    lastInboundAt: (l.last_inbound_at as string | null) ?? null,
  }));

  const [{ data: contactRows, error: cErr }, { data: linkRows, error: lErr }, { data: matterRows, error: mErr }, { data: members, error: rErr }] =
    await Promise.all([
      admin.from("crm_contact").select("id, email").eq("org_id", orgId).not("email", "is", null),
      admin.from("crm_matter_contact").select("contact_id, matter_id").eq("org_id", orgId),
      admin.from("crm_matter").select("id, mark_text").eq("org_id", orgId),
      admin.from("crm_org_member").select("user_id, role").eq("org_id", orgId),
    ]);
  for (const e of [cErr, lErr, mErr, rErr]) if (e) throw new Error(`org context read failed: ${e.message}`);

  const markByMatter = new Map((matterRows ?? []).map((m) => [m.id as string, (m.mark_text as string | null) ?? null]));
  return {
    leads,
    contacts: (contactRows ?? []).map((c) => ({ contactId: c.id as string, email: (c.email as string | null) ?? null })),
    links: (linkRows ?? []).map((l) => ({
      contactId: l.contact_id as string,
      matterId: l.matter_id as string,
      markText: markByMatter.get(l.matter_id as string) ?? null,
    })),
    memberRoles: new Map((members ?? []).map((m) => [m.user_id as string, m.role as string])),
  };
}

export async function syncConnection(deps: SyncDeps, row: ConnectionRow, ctx: OrgContext): Promise<ConnectionOutcome> {
  const now = deps.now?.() ?? Date.now();
  try {
    const accessToken = await freshAccessToken(deps, row);
    const fetched = await fetchNewMessages(row.provider, {
      accessToken,
      mailbox: row.email,
      cursor: row.sync_cursor,
      fetchImpl: deps.fetchImpl,
      now,
    });

    const report = buildEmailEvidence({ messages: fetched.messages, leads: ctx.leads, directory: [] });
    const planned = planActivities({
      report,
      messages: fetched.messages,
      matterFor: (m) => matchMessageToMatter(m, ctx.contacts, ctx.links),
      connectionId: row.id,
    });
    const counts = await applyRun(deps.admin, {
      orgId: row.org_id,
      report,
      planned,
      memberRoles: ctx.memberRoles,
    });

    // Keep this run's lead timestamps in the shared context, so a second
    // mailbox in the same firm doesn't re-ring the bell for the same reply.
    for (const entry of report.leads) {
      const lead = ctx.leads.find((l) => l.id === entry.lead.id);
      if (!lead) continue;
      if (entry.cadence.lastInboundAt) lead.lastInboundAt = entry.cadence.lastInboundAt;
      if (entry.cadence.lastOutboundAt) lead.lastOutboundAt = entry.cadence.lastOutboundAt;
    }

    const { error } = await deps.admin
      .from("mailbox_connection")
      .update({
        sync_cursor: fetched.cursor,
        last_synced_at: new Date(now).toISOString(),
        last_error: null,
        status: "active",
        matched_count: row.matched_count + counts.activitiesInserted,
        updated_at: new Date(now).toISOString(),
      })
      .eq("id", row.id)
      .eq("org_id", row.org_id);
    if (error) throw new Error(`cursor store failed: ${error.message}`);

    return { id: row.id, orgId: row.org_id, ok: true, read: fetched.messages.length, counts, truncated: fetched.truncated };
  } catch (err) {
    const reauth = err instanceof ProviderError && err.code === "reauth";
    const message = err instanceof Error ? err.message : String(err);
    await deps.admin
      .from("mailbox_connection")
      .update({ status: reauth ? "reauth" : "error", last_error: message.slice(0, 500), updated_at: new Date(now).toISOString() })
      .eq("id", row.id)
      .eq("org_id", row.org_id);
    return { id: row.id, orgId: row.org_id, ok: false, status: reauth ? "reauth" : "error", error: message };
  }
}

export type RunSummary = {
  orgs: number;
  connections: number;
  ok: number;
  failed: number;
  outcomes: ConnectionOutcome[];
};

/** Every eligible connection, grouped by firm, with one agent_run row per firm. */
export async function runMailboxSync(deps: SyncDeps): Promise<RunSummary> {
  const { admin } = deps;
  const { data: orgs, error: orgErr } = await admin.from("crm_org").select("id").contains("modules", ["mailbox"]);
  if (orgErr) throw new Error(`org read failed: ${orgErr.message}`);
  const orgIds = (orgs ?? []).map((o) => o.id as string);
  const summary: RunSummary = { orgs: 0, connections: 0, ok: 0, failed: 0, outcomes: [] };
  if (orgIds.length === 0) return summary;

  // `error` rows are retried; `reauth` rows wait for a person.
  const { data: rows, error } = await admin
    .from("mailbox_connection")
    .select("id, org_id, provider, email, status, access_token_enc, refresh_token_enc, token_expires_at, sync_cursor, matched_count")
    .in("org_id", orgIds)
    .in("status", ["active", "error"]);
  if (error) throw new Error(`connection read failed: ${error.message}`);

  const byOrg = new Map<string, ConnectionRow[]>();
  for (const r of (rows ?? []) as ConnectionRow[]) {
    byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), r]);
  }

  for (const [orgId, conns] of byOrg) {
    summary.orgs += 1;
    const startedAt = new Date(deps.now?.() ?? Date.now()).toISOString();
    const { data: run } = await admin
      .from("agent_run")
      .insert({ org_id: orgId, agent: "mailbox-sync", trigger: "cron", status: "running", started_at: startedAt })
      .select("id")
      .single();

    let ctx: OrgContext | null = null;
    let ctxError: string | null = null;
    try {
      ctx = await loadOrgContext(admin, orgId);
    } catch (e) {
      ctxError = e instanceof Error ? e.message : String(e);
    }

    const outcomes: ConnectionOutcome[] = [];
    for (const conn of conns) {
      outcomes.push(
        ctx
          ? await syncConnection(deps, conn, ctx)
          : { id: conn.id, orgId, ok: false, status: "error", error: ctxError ?? "context unavailable" },
      );
    }
    summary.connections += outcomes.length;
    summary.ok += outcomes.filter((o) => o.ok).length;
    summary.failed += outcomes.filter((o) => !o.ok).length;
    summary.outcomes.push(...outcomes);

    if (run?.id) {
      const read = outcomes.reduce((n, o) => n + (o.ok ? o.read : 0), 0);
      const written = outcomes.reduce((n, o) => n + (o.ok ? o.counts.activitiesInserted : 0), 0);
      const failed = outcomes.filter((o) => !o.ok).length;
      await admin
        .from("agent_run")
        .update({
          status: failed === outcomes.length ? "error" : "ok",
          finished_at: new Date(deps.now?.() ?? Date.now()).toISOString(),
          items_in: read,
          drafts_out: 0,
          // Counts only — never an address, subject or name.
          summary: `${outcomes.length} mailbox(es): ${read} message(s) read, ${written} matched and logged${failed ? `, ${failed} failed` : ""}.`,
          error: failed ? `${failed} mailbox(es) failed; see Settings → Mailboxes.` : null,
        })
        .eq("id", run.id)
        .eq("org_id", orgId);
    }
  }
  return summary;
}
