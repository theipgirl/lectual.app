// S2b: the full prep's files to the lead's Documents & files: the one service-role crm_file write.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepFileStore } from "@/lib/consult-prep/save-files";
import type { PrepFile } from "@/lib/consult-prep/attachments";
import { memDb, type DbError, type Tables } from "../agents/mem-db";
import type { Recorded } from "../mailbox/fake-db";
import { fakeAdmin } from "../mailbox/fake-db";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const LEAD = "aaaaaaaa-0000-4000-8000-000000000001";
const KEY = `${LEAD}:e1:2026-11-25T19:00:00.000Z`;

const files: PrepFile[] = [
  { kind: "uspto_xlsx", fileName: "tmSearchResults2026-11-24.xlsx", bytes: Buffer.from("xlsx-bytes") },
  { kind: "packages_pdf", fileName: "Dana_Ruiz_Packages_SANKOFA.pdf", bytes: Buffer.from("%PDF-bytes!") },
];

type StorageOpts = { uploadError?: { message: string }; downloadMissing?: boolean };

function setup(tables: Tables, opts: { storage?: StorageOpts; failures?: (q: Recorded) => DbError | undefined } = {}) {
  const db = memDb(tables, { failures: opts.failures });
  const events: string[] = [];
  const objects = new Map<string, Buffer>();
  const handler: typeof db.handler = (q) => {
    if (q.action === "insert") events.push(`insert ${q.table}`);
    return db.handler(q);
  };
  const { client, log } = fakeAdmin(handler);
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Buffer, o: { contentType: string; upsert: boolean }) => {
        events.push(`upload ${bucket} ${path} ${o.contentType} upsert=${o.upsert}`);
        if (opts.storage?.uploadError) return { data: null, error: opts.storage.uploadError };
        objects.set(path, body);
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        events.push(`remove ${paths.join(",")}`);
        for (const p of paths) objects.delete(p);
        return { data: [], error: null };
      },
      download: async (path: string) => {
        const b = objects.get(path);
        if (!b || opts.storage?.downloadMissing) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([new Uint8Array(b)]), error: null };
      },
    }),
  };
  const admin = Object.assign(client as object, { storage }) as unknown as SupabaseClient;
  return { db, admin, events, objects, log, store: prepFileStore(admin, ORG) };
}

const lead = (over: Record<string, unknown> = {}) => ({ id: LEAD, org_id: ORG, merged_into_id: null, ...over });

describe("prepFileStore.save", () => {
  it("uploads the object, then inserts the row, then logs file_uploaded, with the org from the lead row, the path rule and the mapped type", async () => {
    const s = setup({ crm_lead: [lead()], crm_file: [], crm_activity: [] });
    const out = await s.store.save({ leadId: LEAD, prepKey: KEY, files });
    expect(out).toEqual({ saved: 2, already: 0, skipped: 0, failed: 0 });
    expect(s.events[0]).toMatch(new RegExp(`^upload client-files ${ORG}/lead/${LEAD}/[0-9a-f-]{36}\\.xlsx application/vnd\\.openxmlformats-officedocument\\.spreadsheetml\\.sheet upsert=false$`));
    expect(s.events[1]).toBe("insert crm_file");
    expect(s.events[2]).toBe("insert crm_activity");
    expect(s.events[3]).toMatch(/\.pdf application\/pdf upsert=false$/);
    const rows = s.db.tables.crm_file;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["created_at", "file_name", "id", "lead_id", "matter_id", "mime", "org_id", "size_bytes", "storage_path"].sort());
      expect(r.org_id).toBe(ORG);
      expect(r.storage_path).toBe(`${ORG}/lead/${LEAD}/${r.id}.${String(r.file_name).split(".").pop()}`);
    }
    expect(rows.find((r) => r.mime === "application/pdf")!.size_bytes).toBe(files[1].bytes.length);
    const acts = s.db.tables.crm_activity.filter((a) => a.type === "file_uploaded");
    expect(acts.map((a) => (a.payload as Record<string, unknown>).kind).sort()).toEqual(["packages_pdf", "uspto_xlsx"]);
    expect(acts.every((a) => (a.payload as Record<string, unknown>).prep_key === KEY && a.org_id === ORG)).toBe(true);
    for (const q of s.log) expect(q.filters.some((f) => f.column === "org_id" && f.value === ORG) || (q.action === "insert" && [q.values].flat().every((v) => (v as { org_id?: string }).org_id === ORG))).toBe(true);
  });

  it("saves once per prep key: a second save (a reminder, a rebuild) writes nothing", async () => {
    const s = setup({ crm_lead: [lead()], crm_file: [], crm_activity: [] });
    await s.store.save({ leadId: LEAD, prepKey: KEY, files });
    s.events.length = 0;
    expect(await s.store.save({ leadId: LEAD, prepKey: KEY, files })).toEqual({ saved: 0, already: 2, skipped: 0, failed: 0 });
    expect(s.events).toEqual([]);
    // A re-run's key is another prep: it saves its own.
    expect((await s.store.save({ leadId: LEAD, prepKey: `${KEY}:rerun:1`, files })).saved).toBe(2);
  });

  it("a lead of another firm, or a merged lead, saves nothing", async () => {
    const other = setup({ crm_lead: [lead({ org_id: OTHER })], crm_file: [], crm_activity: [] });
    expect((await other.store.save({ leadId: LEAD, prepKey: KEY, files })).failed).toBe(2);
    expect(other.events).toEqual([]);
    const merged = setup({ crm_lead: [lead({ merged_into_id: "x" })], crm_file: [], crm_activity: [] });
    expect((await merged.store.save({ leadId: LEAD, prepKey: KEY, files })).saved).toBe(0);
    expect(merged.events).toEqual([]);
  });

  it("no bucket is skipped (storage not switched on); a row that can't be written removes its object; nothing throws", async () => {
    const nobucket = setup({ crm_lead: [lead()], crm_file: [], crm_activity: [] }, { storage: { uploadError: { message: "Bucket not found" } } });
    expect(await nobucket.store.save({ leadId: LEAD, prepKey: KEY, files })).toEqual({ saved: 0, already: 0, skipped: 2, failed: 0 });
    const notable = setup({ crm_lead: [lead()], crm_activity: [] }, { failures: (q: Recorded) => (q.table === "crm_file" && q.action === "insert" ? { message: "x", code: "42P01" } : undefined) });
    expect(await notable.store.save({ leadId: LEAD, prepKey: KEY, files })).toEqual({ saved: 0, already: 0, skipped: 2, failed: 0 });
    expect(notable.events.some((e) => e.startsWith("remove "))).toBe(true);
    expect(notable.objects.size).toBe(0);
    const unreadable = setup({ crm_lead: [lead()], crm_file: [], crm_activity: [] }, { failures: (q: Recorded) => (q.table === "crm_activity" && q.action === "select" ? { message: "x" } : undefined) });
    expect((await unreadable.store.save({ leadId: LEAD, prepKey: KEY, files })).failed).toBe(2);
    expect(unreadable.events).toEqual([]);
  });

  it("reads the saved copies back for a later email", async () => {
    const s = setup({ crm_lead: [lead()], crm_file: [], crm_activity: [] });
    await s.store.save({ leadId: LEAD, prepKey: KEY, files });
    const back = await s.store.load({ leadId: LEAD, prepKey: KEY });
    expect(back.state).toBe("ok");
    if (back.state === "ok") expect(back.files.map((f) => [f.kind, f.fileName, f.bytes.toString()]).sort()).toEqual(files.map((f) => [f.kind, f.fileName, f.bytes.toString()]).sort());
    expect(await s.store.load({ leadId: LEAD, prepKey: "other" })).toEqual({ state: "ok", files: [] });
  });
});
