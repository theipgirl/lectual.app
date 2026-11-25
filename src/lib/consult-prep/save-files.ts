import { hash } from "node:crypto";
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
 *   - ONCE per prep key and kind: the file's id is derived from (org, prep key, kind) (`prepFileId`), so "already saved" is the `crm_file`
 *     row itself (a timeline entry that did not land changes nothing), a second save answers "already", and an object left by a
 *     half-finished save is reused. A reminder email never saves anything; a re-run's key is another prep and saves its own;
 *   - a missing table or bucket is "skipped", any other failure is "failed"; nothing throws, nothing is logged.
 */

export type SaveOutcome = {
  saved: number;
  already: number;
  skipped: number;
  failed: number;
  /** Saved, but the `file_uploaded` timeline entry did not land (the file is on the lead all the same). */
  unlogged: number;
};
export type LoadOutcome = { state: "ok"; files: PrepFile[] } | { state: "unavailable" };

export type PrepFileStore = {
  save(input: { leadId: string; prepKey: string; files: readonly PrepFile[] }): Promise<SaveOutcome>;
  /** The files saved for a prep key, read back for a later email. A file whose row or object can't be read is left out. */
  load(input: { leadId: string; prepKey: string }): Promise<LoadOutcome>;
};

/** The file's id for this prep key and kind: a uuid made from sha256(org, prep key, kind), the same every time. */
export function prepFileId(orgId: string, prepKey: string, kind: PrepFileKind): string {
  const h = hash("sha256", `${PREP_SOURCE}\u0000${orgId}\u0000${prepKey}\u0000${kind}`, "hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type Row = { id: string; org_id: string; lead_id: string | null; storage_path: string; file_name: string };

/** This prep key's `crm_file` rows on this lead. Null = couldn't be read. */
async function rowsFor(admin: SupabaseClient, orgId: string, leadId: string, prepKey: string): Promise<Map<PrepFileKind, Row> | null> {
  const ids = new Map(PREP_FILE_KINDS.map((k) => [prepFileId(orgId, prepKey, k), k] as const));
  const { data, error } = await admin
    .from("crm_file")
    .select("id, org_id, lead_id, storage_path, file_name")
    .eq("org_id", orgId)
    .eq("lead_id", leadId)
    .in("id", [...ids.keys()]);
  if (error) return isMissingTableError(error) ? new Map() : null;
  const out = new Map<PrepFileKind, Row>();
  for (const r of (data ?? []) as Row[]) {
    const kind = ids.get(r.id);
    if (kind && r.org_id === orgId && r.lead_id === leadId) out.set(kind, r);
  }
  return out;
}

const alreadyThere = (failure: { message?: unknown; statusCode?: unknown; status?: unknown } | null): boolean =>
  !!failure && (/already exists|duplicate/i.test(String(failure.message ?? "")) || String(failure.statusCode ?? failure.status ?? "") === "409");

export function prepFileStore(admin: SupabaseClient, orgId: string): PrepFileStore {
  return {
    async save({ leadId, prepKey, files }) {
      const out: SaveOutcome = { saved: 0, already: 0, skipped: 0, failed: 0, unlogged: 0 };
      if (files.length === 0) return out;
      let handled = 0;
      try {
        // The org comes from the lead row itself (fenced on the run's firm, live: a merged lead's files are not written).
        const lead = await leadRead(({ live }) => live(admin.from("crm_lead").select("id, org_id")).eq("org_id", orgId).eq("id", leadId).limit(1));
        const row = ((lead.data ?? [])[0] as { id?: string; org_id?: string } | undefined) ?? null;
        if (lead.error || !row || row.org_id !== orgId || row.id !== leadId) {
          out.failed += files.length;
          return out;
        }
        const rowOrg = row.org_id;
        const done = await rowsFor(admin, rowOrg, leadId, prepKey);
        if (done === null) {
          // Not knowing what is saved is not "nothing saved": no second copy on a guess.
          out.failed += files.length;
          return out;
        }
        const bucket = admin.storage.from(FILES_BUCKET);
        for (let i = 0; i < files.length; i += 1, handled = i) {
          const file = files[i];
          if (done.has(file.kind)) {
            out.already += 1;
            continue;
          }
          const type = checkFileName(file.fileName);
          const size = file.bytes.length;
          if (!type.ok || size <= 0 || size > MAX_FILE_BYTES) {
            out.failed += 1;
            continue;
          }
          const fileId = prepFileId(rowOrg, prepKey, file.kind);
          const path = buildStoragePath({ orgId: rowOrg, kind: "lead", parentId: leadId, fileId, ext: type.ext });
          const up = await bucket.upload(path, file.bytes, { contentType: type.mime, upsert: false });
          if (up.error && !alreadyThere(up.error)) {
            if (isBucketMissingError(up.error)) {
              out.skipped += files.length - i; // no bucket: storage isn't switched on for the firm
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
            // The id is this key's own: a duplicate means another run saved it first.
            if ((insertError as { code?: string }).code === "23505") {
              out.already += 1;
              continue;
            }
            await bucket.remove([path]).catch(() => undefined);
            if (isMissingTableError(insertError)) {
              out.skipped += files.length - i; // no table: storage isn't switched on for the firm
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
          // The row is the file (and what "saved" is read from); a timeline entry that did not land is counted, nothing more.
          out.saved += 1;
          if (activityError) out.unlogged += 1;
        }
        return out;
      } catch {
        out.failed += Math.max(0, files.length - Math.max(handled, out.saved + out.already + out.skipped + out.failed));
        return out;
      }
    },

    async load({ leadId, prepKey }) {
      try {
        const rows = await rowsFor(admin, orgId, leadId, prepKey);
        if (rows === null) return { state: "unavailable" };
        const files: PrepFile[] = [];
        for (const [kind, row] of rows) {
          const got = await admin.storage.from(FILES_BUCKET).download(row.storage_path);
          if (got.error || !got.data) continue;
          files.push({ kind, fileName: row.file_name, bytes: Buffer.from(await got.data.arrayBuffer()) });
        }
        return { state: "ok", files };
      } catch {
        return { state: "unavailable" };
      }
    },
  };
}
