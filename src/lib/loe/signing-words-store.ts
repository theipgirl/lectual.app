import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isMissingObjectError } from "./email-signing/codes";
import { wordsErrorSentence } from "./signing-words-errors";
import { WORDS_FIELDS, type SigningWords } from "./signing-words";

/**
 * The firm's signing words versions (lectual 0117 `client_proposal_signing_words`), modelled on `templates-store.ts`.
 *
 * The caller's SCOPED client only: RLS limits every row to the active firm, and the database (not this file) decides who may
 * start a draft, edit it, approve it and what is frozen. No service-role client is imported here (the public path's read of the
 * APPROVED version lives in `email-signing/gate.ts`). Reads are three-state: ok / not-set-up (judged on the error CODE) /
 * unavailable. A failed read is never an empty list. The words are the firm's own and are never logged.
 *
 * The inserts never name `version`, `status`, `created_by` or `approved_*`: they have no grant and the database assigns them.
 */

type Db = SupabaseClient<Database>;

export type WordsStatus = "draft" | "approved" | "retired";
export type WordsVersion = SigningWords & { id: string; version: number; status: WordsStatus; updatedAt: string; approvedAt: string | null };

export type WordsVersionsRead = { status: "ok"; versions: WordsVersion[] } | { status: "not-set-up" } | { status: "unavailable" };
export type WordsVersionRead = { status: "ok"; version: WordsVersion } | { status: "none" } | { status: "not-set-up" } | { status: "unavailable" };
export type WordsWrite = { ok: true; id?: string } | { ok: false; error: string; missing?: boolean };

const COLUMNS = `id, version, status, updated_at, approved_at, ${WORDS_FIELDS.join(", ")}`;

const isStatus = (s: unknown): s is WordsStatus => s === "draft" || s === "approved" || s === "retired";

function toVersion(r: Record<string, unknown>): WordsVersion | null {
  if (typeof r.id !== "string" || typeof r.version !== "number" || !isStatus(r.status) || typeof r.updated_at !== "string") return null;
  const words = {} as SigningWords;
  for (const f of WORDS_FIELDS) {
    if (typeof r[f] !== "string") return null;
    words[f] = r[f] as string;
  }
  return { ...words, id: r.id, version: r.version, status: r.status, updatedAt: r.updated_at, approvedAt: typeof r.approved_at === "string" ? r.approved_at : null };
}

const failure = (error: unknown): "not-set-up" | "unavailable" => (isMissingObjectError(error as never) ? "not-set-up" : "unavailable");

function pickWords(words: SigningWords): SigningWords {
  const out = {} as SigningWords;
  for (const f of WORDS_FIELDS) out[f] = words[f];
  return out;
}

export async function listWordsVersions(db: Db): Promise<WordsVersionsRead> {
  try {
    const { data, error } = await db.from("client_proposal_signing_words").select(COLUMNS).order("version", { ascending: false }).limit(100);
    if (error) return { status: failure(error) };
    const versions = ((data ?? []) as unknown as Record<string, unknown>[]).map(toVersion);
    if (versions.some((v) => v === null)) return { status: "unavailable" };
    return { status: "ok", versions: versions as WordsVersion[] };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getWordsVersion(db: Db, id: string): Promise<WordsVersionRead> {
  try {
    const { data, error } = await db.from("client_proposal_signing_words").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) return { status: failure(error) };
    if (!data) return { status: "none" };
    const v = toVersion(data as unknown as Record<string, unknown>);
    return v ? { status: "ok", version: v } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

function written(error: unknown): WordsWrite {
  return { ok: false, error: wordsErrorSentence(error as never), missing: isMissingObjectError(error as never) };
}

export async function createWordsDraft(db: Db, args: { orgId: string; words: SigningWords }): Promise<WordsWrite> {
  try {
    const { data, error } = await db
      .from("client_proposal_signing_words")
      .insert({ org_id: args.orgId, ...pickWords(args.words) })
      .select("id")
      .single();
    if (error || !data) return written(error);
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return written(err);
  }
}

/** Saves a draft's eight fields. Fenced on the row still being a draft: a version that moved on updates nothing. */
export async function saveWordsDraft(db: Db, id: string, words: SigningWords): Promise<WordsWrite> {
  try {
    const { data, error } = await db.from("client_proposal_signing_words").update(pickWords(words)).eq("id", id).eq("status", "draft").select("id");
    if (error) return written(error);
    if (!data || data.length === 0) return { ok: false, error: wordsErrorSentence({ message: "signing_words_frozen" }) };
    return { ok: true, id };
  } catch (err) {
    return written(err);
  }
}

/** Draft -> approved. Only `status` is sent; the database checks the approver and retires the earlier version. */
export async function approveWordsDraft(db: Db, id: string): Promise<WordsWrite> {
  try {
    const { data, error } = await db.from("client_proposal_signing_words").update({ status: "approved" }).eq("id", id).eq("status", "draft").select("id");
    if (error) return written(error);
    if (!data || data.length === 0) return { ok: false, error: wordsErrorSentence({ message: "signing_words_not_approver" }) };
    return { ok: true, id };
  } catch (err) {
    return written(err);
  }
}
