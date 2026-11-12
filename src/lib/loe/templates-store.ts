import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isMissingTableError } from "@/lib/files/errors";
import type { ApprovedLetter } from "@/lib/proposals/loe-snapshot";
import { letterErrorSentence } from "./errors";
import { isLoeKindName, type LoeKindName } from "./kinds";
import type { LetterStatus, LetterVersion } from "./page-model";

/**
 * The firm's engagement letter versions (lectual 0106 `client_proposal_loe_template`).
 *
 * The caller's SCOPED client only: RLS limits every row to the active firm, and the database (not this file)
 * decides who may start a draft, edit it, approve it and what is frozen. No service-role client is imported
 * here. Reads are three-state: ok / not-set-up (the table is missing, judged on the error CODE) / unavailable.
 * A failed read is never an empty list. The letter text is privileged firm content and is never logged.
 *
 * The inserts never name `version`, `status`, `created_by` or `approved_*`: they have no grant and the
 * database assigns them.
 */

type Db = SupabaseClient<Database>;

export type VersionsRead =
  | { status: "ok"; versions: LetterVersion[] }
  | { status: "not-set-up" }
  | { status: "unavailable" };

export type ApprovedRead =
  | { status: "ok"; letter: ApprovedLetter | null }
  | { status: "not-set-up" }
  | { status: "unavailable" };

export type VersionRead =
  | { status: "ok"; version: LetterVersion }
  | { status: "none" }
  | { status: "not-set-up" }
  | { status: "unavailable" };

/** A write either landed, or says why in a fixed sentence. */
export type LetterWrite = { ok: true; id?: string } | { ok: false; error: string; missing?: boolean };

const COLUMNS = "id, kind, version, status, title, body, updated_at, approved_at";

type Row = {
  id: string;
  kind: string;
  version: number;
  status: string;
  title: string;
  body: string;
  updated_at: string;
  approved_at: string | null;
};

const isStatus = (s: string): s is LetterStatus => s === "draft" || s === "approved" || s === "retired";

function toVersion(r: Row): LetterVersion | null {
  if (!isLoeKindName(r.kind) || !isStatus(r.status)) return null;
  return { id: r.id, kind: r.kind, version: r.version, status: r.status, title: r.title, body: r.body, updatedAt: r.updated_at, approvedAt: r.approved_at };
}

const failure = (error: unknown): "not-set-up" | "unavailable" => (isMissingTableError(error as never) ? "not-set-up" : "unavailable");

export async function listLetterVersions(db: Db): Promise<VersionsRead> {
  try {
    const { data, error } = await db
      .from("client_proposal_loe_template")
      .select(COLUMNS)
      .order("kind", { ascending: true })
      .order("version", { ascending: false })
      .limit(200);
    if (error) return { status: failure(error) };
    const versions = ((data ?? []) as Row[]).map(toVersion);
    // A row this code can't read is a failed read, never a version that quietly isn't there.
    if (versions.some((v) => v === null)) return { status: "unavailable" };
    return { status: "ok", versions: versions as LetterVersion[] };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * The firm's currently approved letter of one kind (for `withLoeSnapshot`), or null when it has none.
 *
 * `orgId`, when given, fences the read on that firm as well. A signed-in person's scoped client is already limited to the active
 * firm by RLS; a caller that holds a row and must read THAT row's firm's letter (the make-live guard, an assistant run that may be
 * on the service role) passes the row's own `org_id`, so the answer never depends on what the connection can see.
 */
export async function getApprovedLetter(db: Db, kind: LoeKindName, orgId?: string): Promise<ApprovedRead> {
  try {
    let query = db.from("client_proposal_loe_template").select(COLUMNS).eq("kind", kind).eq("status", "approved");
    if (orgId !== undefined) query = query.eq("org_id", orgId);
    const { data, error } = await query.maybeSingle();
    if (error) return { status: failure(error) };
    if (!data) return { status: "ok", letter: null };
    const v = toVersion(data as Row);
    if (!v) return { status: "unavailable" };
    return { status: "ok", letter: { id: v.id, kind: v.kind, version: v.version, title: v.title, body: v.body } };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getLetterVersion(db: Db, id: string): Promise<VersionRead> {
  try {
    const { data, error } = await db.from("client_proposal_loe_template").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) return { status: failure(error) };
    if (!data) return { status: "none" };
    const v = toVersion(data as Row);
    return v ? { status: "ok", version: v } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function currentOrgId(db: Db): Promise<string | null> {
  try {
    const { data, error } = await db.rpc("current_org_id");
    return !error && typeof data === "string" && data ? data : null;
  } catch {
    return null;
  }
}

function written(error: unknown): LetterWrite {
  return { ok: false, error: letterErrorSentence(error as never), missing: isMissingTableError(error as never) };
}

export async function createLetterDraft(db: Db, args: { orgId: string; kind: LoeKindName; title: string; body: string }): Promise<LetterWrite> {
  try {
    const { data, error } = await db
      .from("client_proposal_loe_template")
      .insert({ org_id: args.orgId, kind: args.kind, title: args.title, body: args.body })
      .select("id")
      .single();
    if (error || !data) return written(error);
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return written(err);
  }
}

/** Saves a draft's title and text. Fenced on the row still being a draft: a version that moved on updates nothing. */
export async function saveLetterDraft(db: Db, id: string, input: { title: string; body: string }): Promise<LetterWrite> {
  try {
    const { data, error } = await db
      .from("client_proposal_loe_template")
      .update({ title: input.title, body: input.body })
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (error) return written(error);
    if (!data || data.length === 0) return { ok: false, error: letterErrorSentence({ message: "loe_template_frozen" }) };
    return { ok: true, id };
  } catch (err) {
    return written(err);
  }
}

/** Draft -> approved. Only `status` is sent; the database checks the approver and retires the earlier version. */
export async function approveLetterDraft(db: Db, id: string): Promise<LetterWrite> {
  try {
    const { data, error } = await db
      .from("client_proposal_loe_template")
      .update({ status: "approved" })
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (error) return written(error);
    if (!data || data.length === 0) return { ok: false, error: letterErrorSentence({ message: "loe_template_not_approver" }) };
    return { ok: true, id };
  } catch (err) {
    return written(err);
  }
}
