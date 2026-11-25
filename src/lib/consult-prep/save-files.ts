import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FILES_BUCKET, MAX_FILE_BYTES, buildStoragePath, checkFileName } from "@/lib/files/rules";
import { isBucketMissingError, isMissingTableError } from "@/lib/files/errors";
import { leadRead } from "@/lib/leads/live";
import { PREP_SOURCE } from "@/lib/agents/consult-prep/constants";
import { PREP_FILE_KINDS, type PrepFile, type PrepFileKind } from "./attachments";

/**
 * Saving a full consult prep's two files to the lead's Documents & files (S2b). This is the ONE place a service-role `crm_file`
 * write (and its storage upload) happens. The client it uses is the agent run's own (`ctx.admin`), handed in; nothing is imported
 * for it. The rules are the scoped flow's (src/app/dashboard/files/actions.ts), applied to a job:
 *
 *   - the org is the LEAD ROW's own `org_id`, re-read org-fenced and live (a merged or foreign lead saves nothing);
 *   - the path is `{org}/lead/{lead}/{file}.{ext}` (`buildStoragePath`), the type is the extension's (`checkFileName`), the size is the
 *     real byte count, and the row carries exactly the scoped flow's columns (never `uploaded_by` or `contact_id`);
 *   - the object is uploaded first, then the row, then the `file_uploaded` timeline entry; a row that cannot be written removes the object;
 *   - once per prep key: the `file_uploaded` rows carry `source: consult-prep`, the prep key and the file's kind, and a kind already saved
 *     for that key is not saved again (that is how "done" is read; a reminder email never saves anything);
 *   - a missing table or bucket is "skipped", any other failure is "failed"; nothing throws, nothing is logged.
 */

export type SaveOutcome = { saved: number; already: number; skipped: number; failed: number };
export type LoadOutcome = { state: "ok"; files: PrepFile[] } | { state: "unavailable" };

export type PrepFileStore = {
  save(input: { leadId: string; prepKey: string; files: readonly PrepFile[] }): Promise<SaveOutcome>;
  /** The files saved for a prep key, read back for a later email. */
  load(input: { leadId: string; prepKey: string }): Promise<LoadOutcome>;
};

type Saved = { fileId: string; kind: PrepFileKind };

const isKind = (v: unknown): v is PrepFileKind => typeof v === "string" && (PREP_FILE_KINDS as readonly string[]).includes(v);

/** The files already saved for this prep key: the `file_uploaded` rows this file wrote. Null = couldn't be read. */
async function savedFor(admin: SupabaseClient, orgId: string, leadId: string, prepKey: string): Promise<Saved[] | null> {
  const { data, error } = await admin
    .from("crm_activity")
    .select("payload")
    .eq("org_id", orgId)
    .eq("lead_id", leadId)
    .eq("type", "file_uploaded")
    .eq("payload->>source", PREP_SOURCE)
    .eq("payload->>prep_key", prepKey)
    .limit(20);
  if (error) return null;
  const out: Saved[] = [];
  for (const row of (data ?? []) as Array<{ payload: Record<string, unknown> | null }>) {
    const p = row.payload ?? {};
    if (typeof p.file_id === "string" && isKind(p.kind)) out.push({ fileId: p.file_id, kind: p.kind });
  }
  return out;
}

export function prepFileStore(admin: SupabaseClient, orgId: string): PrepFileStore {
  return {
    async save({ leadId, prepKey, files }) {
      const out: SaveOutcome = { saved: 0, already: 0, skipped: 0, failed: 0 };
      if (files.length === 0) return out;
      try {
        // The org comes from the lead row itself (fenced on the run's firm, live: a merged lead's files are not written).
        const lead = await leadRead(({ live }) => live(admin.from("crm_lead").select("id, org_id")).eq("org_id", orgId).eq("id", leadId).limit(1));
        const row = ((lead.data ?? [])[0] as { id?: string; org_id?: string } | undefined) ?? null;
        if (lead.error || !row || row.org_id !== orgId || row.id !== leadId) {
          out.failed += files.length;
          return out;
        }
        const rowOrg = row.org_id;
        const done = await savedFor(admin, rowOrg, leadId, prepKey);
        if (done === null) {
          // Not knowing what is saved is not "nothing saved": no second copy on a guess.
          out.failed += files.length;
          return out;
        }
        const bucket = admin.storage.from(FILES_BUCKET);
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          if (done.some((d) => d.kind === file.kind)) {
            out.already += 1;
            continue;
          }
          const type = checkFileName(file.fileName);
          const size = file.bytes.length;
          if (!type.ok || size <= 0 || size > MAX_FILE_BYTES) {
            out.failed += 1;
            continue;
          }
          const fileId = randomUUID();
          const path = buildStoragePath({ orgId: rowOrg, kind: "lead", parentId: leadId, fileId, ext: type.ext });
          const up = await bucket.upload(path, file.bytes, { contentType: type.mime, upsert: false });
          if (up.error) {
            if (isBucketMissingError(up.error)) {
              out.skipped += files.length - i; // no bucket, or no table: storage isn't switched on for the firm
              return out;
            }
            out.failed += 1;
            continue;
          }
          // Exactly the scoped flow's columns: no uploaded_by, no contact_id, no created_at.
          const { error: insertError } = await admin.from("crm_file").insert({
            id: fileId,
            org_id: rowOrg,
            lead_id: leadId,
            matter_id: null,
            storage_path: path,
            file_name: type.name,
            mime: type.mime,
            size_bytes: size,
          });
          if (insertError) {
            await bucket.remove([path]).catch(() => undefined);
            if (isMissingTableError(insertError)) {
              out.skipped += files.length - i; // no bucket, or no table: storage isn't switched on for the firm
              return out;
            }
            out.failed += 1;
            continue;
          }
          const { error: activityError } = await admin.from("crm_activity").insert({
            org_id: rowOrg,
            lead_id: leadId,
            type: "file_uploaded",
            actor_id: null,
            actor_type: "ai",
            payload: { file_id: fileId, file_name: type.name, size_bytes: size, source: PREP_SOURCE, prep_key: prepKey, kind: file.kind },
          });
          // The row is the file; a timeline entry that did not land is counted (the file stands, as in the scoped flow).
          if (activityError) out.failed += 1;
          else out.saved += 1;
        }
        return out;
      } catch {
        out.failed = Math.max(out.failed, files.length - out.saved - out.already - out.skipped);
        return out;
      }
    },

    async load({ leadId, prepKey }) {
      try {
        const saved = await savedFor(admin, orgId, leadId, prepKey);
        if (saved === null) return { state: "unavailable" };
        if (saved.length === 0) return { state: "ok", files: [] };
        const { data, error } = await admin
          .from("crm_file")
          .select("id, org_id, lead_id, storage_path, file_name")
          .eq("org_id", orgId)
          .eq("lead_id", leadId)
          .in("id", saved.map((s) => s.fileId));
        if (error) return { state: "unavailable" };
        const rows = (data ?? []) as Array<{ id: string; org_id: string; lead_id: string | null; storage_path: string; file_name: string }>;
        const files: PrepFile[] = [];
        for (const s of saved) {
          const row = rows.find((r) => r.id === s.fileId && r.org_id === orgId && r.lead_id === leadId);
          if (!row || files.some((f) => f.kind === s.kind)) continue;
          const got = await admin.storage.from(FILES_BUCKET).download(row.storage_path);
          if (got.error || !got.data) continue;
          files.push({ kind: s.kind, fileName: row.file_name, bytes: Buffer.from(await got.data.arrayBuffer()) });
        }
        return { state: "ok", files };
      } catch {
        return { state: "unavailable" };
      }
    },
  };
}
