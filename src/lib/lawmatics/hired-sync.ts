import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminClient } from "@/lib/db/admin";
import type { Database, Json } from "@/lib/db/types";
import { firmToken } from "@/lib/intake-forms/lawmatics-sync";

import { createLawmaticsClient, type FetchLike, type LawmaticsClient } from "./client";
import { normalizeHiredProspect } from "./hired-sync-normalize";
import { planHiredSync, type HiredProspect, type PlanLead, type PlanMatter, type PlanStage } from "./hired-sync-plan";
import { field, idOf } from "./jsonapi";

/**
 * Hired-matter sync runner (Lawmatics -> Lectual). Runs as the SERVICE ROLE, per ACTIVE
 * `lawmatics_connection` row, using THAT firm's own token. Every read is filtered on, and every
 * insert stamped with, the `org_id` of the connection row (a database value, never request data).
 * Reads Lawmatics only; never writes to it. Logs nothing about people: the result is counts.
 *
 * Fail closed: a failed or truncated Lawmatics read, or an unreadable matter/lead/stage list,
 * creates NOTHING for that firm and counts the firm as failed.
 */

type Admin = SupabaseClient<Database>;

export const SOURCE = "lawmatics-sync";

export type FirmResult = {
  ok: boolean;
  created: number;
  linked: number;
  /** Records left for a person (skipped for any reason, over-limit included). */
  skipped: number;
  /** Inserts or links that failed one by one. */
  failedWrites: number;
};

export type HiredSyncSummary = {
  connections: number;
  created: number;
  linked: number;
  skipped: number;
  failedFirms: number;
  failedWrites: number;
};

export type HiredSyncDeps = {
  admin?: Admin;
  /** Restrict to one firm (the manual button). The org comes from the session, never a form. */
  orgId?: string;
  getToken?: (admin: Admin, orgId: string) => Promise<string | null>;
  fetchImpl?: FetchLike;
  client?: (token: string) => LawmaticsClient;
  now?: () => Date;
};

const FAILED: FirmResult = { ok: false, created: 0, linked: 0, skipped: 0, failedWrites: 0 };

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, max = 30_000): Promise<T[] | null> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await read(from, from + size - 1);
    if (error || !data) return null;
    rows.push(...data);
    if (data.length < size) return rows;
  }
  return null; // more than `max` rows: not a complete read
}

async function readProspects(client: LawmaticsClient): Promise<HiredProspect[] | null> {
  const areas = await client.listAll("/practice_areas", { params: { fields: "all" } });
  if (areas.truncated || areas.unrecognisedShape) return null;
  const names = new Map<string, string>();
  for (const a of areas.records) {
    const id = idOf(a);
    const name = field(a, "name", "title", "label");
    if (id && name) names.set(id, name);
  }
  const pulled = await client.listAll("/prospects", { params: { fields: "all" } });
  if (pulled.truncated || pulled.unrecognisedShape) return null;
  const out: HiredProspect[] = [];
  for (const raw of pulled.records) {
    const n = normalizeHiredProspect(raw, names);
    if (n) out.push(n);
  }
  return out;
}

export async function syncFirm(admin: Admin, orgId: string, client: LawmaticsClient, now: Date): Promise<FirmResult> {
  try {
    const prospects = await readProspects(client);
    if (!prospects) return { ...FAILED };

    const [matters, leads, stages] = await Promise.all([
      pageAll<PlanMatter>((a, b) =>
        admin.from("crm_matter").select("id,owner_name,title,mark_text,matter_number,lawmatics_id").eq("org_id", orgId).order("created_at", { ascending: true }).range(a, b),
      ),
      pageAll<PlanLead>((a, b) => admin.from("crm_lead").select("id,email,lawmatics_id").eq("org_id", orgId).order("created_at", { ascending: true }).range(a, b)),
      pageAll<PlanStage>((a, b) => admin.from("crm_matter_stage").select("id,label").eq("org_id", orgId).order("order_index", { ascending: true }).range(a, b)),
    ]);
    if (!matters || !leads || !stages) return { ...FAILED };

    const plan = planHiredSync({ prospects, matters, leads, stages });
    const stamp = now.toISOString();
    let created = 0;
    let linked = 0;
    let failedWrites = 0;

    for (const c of plan.create) {
      const { data, error } = await admin
        .from("crm_matter")
        .insert({
          org_id: orgId,
          type: c.type,
          status: "open",
          title: c.title,
          mark_text: c.mark_text,
          owner_name: c.owner_name,
          matter_number: c.matter_number,
          stage_id: c.stage_id,
          stage_entered_at: c.stage_id ? stamp : null,
          lead_id: c.lead_id,
          notes: c.notes,
          lawmatics_id: c.lawmaticsId,
          lawmatics_synced_at: stamp,
        })
        .select("id")
        .single();
      if (error || !data) {
        failedWrites += 1;
        continue;
      }
      created += 1;
      await logRow(admin, orgId, data.id, "matter_opened", "Matter added from Lawmatics (hired)", c.lawmaticsId);
    }

    for (const l of plan.link) {
      const { data, error } = await admin
        .from("crm_matter")
        .update({ lawmatics_id: l.lawmaticsId, lawmatics_synced_at: stamp })
        .eq("id", l.matterId)
        .eq("org_id", orgId)
        .is("lawmatics_id", null)
        .select("id");
      if (error) {
        failedWrites += 1;
        continue;
      }
      if (!data?.length) continue; // someone linked it meanwhile: nothing to do
      linked += 1;
      await logRow(admin, orgId, l.matterId, "matter_updated", "Matter linked to its Lawmatics record", l.lawmaticsId);
    }

    return { ok: true, created, linked, skipped: plan.skipped.length, failedWrites };
  } catch {
    return { ...FAILED };
  }
}

/** Best effort: a failed timeline row never undoes the matter. */
async function logRow(admin: Admin, orgId: string, matterId: string, type: "matter_opened" | "matter_updated", summary: string, lawmaticsId: string): Promise<void> {
  try {
    await admin.from("crm_activity").insert({
      org_id: orgId,
      matter_id: matterId,
      type,
      actor_type: "system",
      actor_id: null,
      payload: { summary, source: SOURCE, lawmatics_id: lawmaticsId } as Json,
    });
  } catch {
    /* counts only */
  }
}

export async function runHiredSync(deps: HiredSyncDeps = {}): Promise<HiredSyncSummary> {
  const admin = deps.admin ?? getAdminClient();
  const getToken = deps.getToken ?? ((a, o) => firmToken(a, o));
  const makeClient = deps.client ?? ((token: string) => createLawmaticsClient({ token, fetchImpl: deps.fetchImpl }));
  const now = deps.now ?? (() => new Date());

  let q = admin.from("lawmatics_connection").select("id, org_id").eq("status", "active");
  if (deps.orgId) q = q.eq("org_id", deps.orgId);
  const { data: conns, error } = await q;
  if (error) throw new Error("connection read failed");

  const summary: HiredSyncSummary = { connections: conns?.length ?? 0, created: 0, linked: 0, skipped: 0, failedFirms: 0, failedWrites: 0 };
  for (const conn of conns ?? []) {
    let result: FirmResult;
    try {
      const token = await getToken(admin, conn.org_id);
      result = token ? await syncFirm(admin, conn.org_id, makeClient(token), now()) : { ...FAILED };
    } catch {
      result = { ...FAILED };
    }
    if (!result.ok) summary.failedFirms += 1;
    summary.created += result.created;
    summary.linked += result.linked;
    summary.skipped += result.skipped;
    summary.failedWrites += result.failedWrites;
  }
  return summary;
}
