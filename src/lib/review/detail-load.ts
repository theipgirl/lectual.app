import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadDocumentsRead } from "@/lib/files/read";
import { mergedSetFor } from "@/lib/leads/live";
import type { RecordDocuments } from "./documents";
import { activeOrgModulesOrNull } from "@/lib/org/modules";
import { clipNote } from "./detail";
import type { OpenRef } from "./open";

export type LatestNote = { status: "ok"; text: string | null } | { status: "unavailable" };

/** The newest plain note on the record, clipped, for the Cards view. A failed read says so; it is never "no note". */
export async function loadLatestNote(ref: OpenRef): Promise<LatestNote> {
  try {
    const db = await getScopedClient();
    const column = ref.kind === "matter" ? "matter_id" : "lead_id";
    const { data, error } = await db.from("crm_activity").select("payload").eq(column, ref.id).eq("type", "note").order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    const p = (data?.[0]?.payload ?? null) as Record<string, unknown> | null;
    const raw = p && [p.note, p.body, p.text].find((v) => typeof v === "string" && v.trim());
    return { status: "ok", text: typeof raw === "string" ? clipNote(raw) : null };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * The record's documents through the existing Documents & files loader (no second reader of crm_file). A matter
 * also lists its generated letters, as a separate read, only for a firm with Document Center; an UNREADABLE module
 * list makes the letters read "unavailable" (never "none", never "No documents yet."). A lead lists its own files
 * plus those of leads merged into it, as the lead page does (`mergedSetFor`); when that set can't be read the
 * keeper's own files are listed and `mergedPartial` says so. Never throws.
 */
export async function readRecordDocuments(ref: OpenRef): Promise<RecordDocuments> {
  let includeLetters = false;
  let modulesUnreadable = false;
  if (ref.kind === "matter") {
    try {
      const modules = await activeOrgModulesOrNull();
      if (modules === null) modulesUnreadable = true;
      else includeLetters = modules.includes("document-center");
    } catch {
      modulesUnreadable = true;
    }
  }
  let mergedIds: string[] = [];
  let mergedPartial = false;
  if (ref.kind === "lead") {
    try {
      const set = await mergedSetFor(await getScopedClient(), ref.id);
      mergedIds = set.ids.filter((x) => x !== ref.id);
      mergedPartial = set.status === "unavailable";
    } catch {
      mergedPartial = true;
    }
  }
  const read = await loadDocumentsRead({ kind: ref.kind, id: ref.id, mergedIds }, { includeLetters });
  return { ...read, letters: modulesUnreadable ? { status: "unavailable" } : read.letters, mergedPartial };
}

/**
 * The newest documents for the Cards deck's CURRENT card only. It is the same reader as the opened record card (one small
 * read for one record, up to 100 files and 100 letters, of which the card draws three), not a read per card.
 * `ok: false` is a read that threw; the loader's own per-source failures ride inside `read`.
 */
export type DeckDocuments = { ok: true; read: RecordDocuments } | { ok: false };

export async function loadDeckDocuments(ref: OpenRef): Promise<DeckDocuments> {
  try {
    return { ok: true, read: await readRecordDocuments(ref) };
  } catch {
    return { ok: false };
  }
}
