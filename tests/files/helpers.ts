import { vi } from "vitest";
import { createFakeDb, type FakeDb, type Row } from "../matters/helpers/fake-db";

/** Fixed ids so storage paths can be matched exactly. */
export const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const LEAD = "11111111-1111-4111-8111-111111111111";
export const MATTER = "22222222-2222-4222-8222-222222222222";
export const OTHER_LEAD = "33333333-3333-4333-8333-333333333333";
export const OTHER_MATTER = "44444444-4444-4444-8444-444444444444";
export const FILE_ID = "55555555-5555-4555-8555-555555555555";

export const STAFF_ROLES = ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk"] as const;
export const NON_STAFF_ROLES = ["viewer", "social_media"] as const;
export const DELETE_ROLES = ["owner", "admin", "senior_admin"] as const;
export const NON_DELETE_ROLES = ["intake", "paralegal", "law_clerk", "attorney", "clerk", "viewer", "social_media"] as const;

/** A string that must never reach a person: fed into errors and searched for in results. */
export const SECRET = "SECRET-raw-detail-do-not-show";

export type StorageCall = { op: string; bucket: string; args: unknown[] };

/**
 * A stand-in for the caller's scoped storage client. It records every call, holds
 * objects by path (with a size), and can be told to fail an operation. Everything
 * that touches storage in these tests goes through it: there is no network.
 */
export function createStorageStub(initial: Record<string, number> = {}) {
  const objects = new Map<string, number>(Object.entries(initial));
  const calls: StorageCall[] = [];
  const errors: Record<string, unknown> = {};
  /** Whether the crm_file row still existed when each remove() ran (the object must go first). */
  const rowPresentAtRemove: boolean[] = [];
  let db: FakeDb | null = null;

  const stub = {
    objects,
    calls,
    errors,
    rowPresentAtRemove,
    watch(fake: FakeDb) {
      db = fake;
    },
    callsTo(op: string) {
      return calls.filter((c) => c.op === op);
    },
    from(bucket: string) {
      const record = (op: string, ...args: unknown[]) => calls.push({ op, bucket, args });
      return {
        createSignedUploadUrl: async (path: string) => {
          record("createSignedUploadUrl", path);
          if (errors.createSignedUploadUrl) return { data: null, error: errors.createSignedUploadUrl };
          return { data: { signedUrl: `https://storage.test/object/upload/sign/${bucket}/${path}?token=TKN`, token: "TKN", path }, error: null };
        },
        list: async (prefix: string, opts?: { search?: string; limit?: number }) => {
          record("list", prefix, opts);
          if (errors.list) return { data: null, error: errors.list };
          const rows = [...objects.entries()]
            .filter(([p]) => p.slice(0, p.lastIndexOf("/")) === prefix)
            .map(([p, size]) => ({ name: p.slice(p.lastIndexOf("/") + 1), id: `obj-${p}`, metadata: { size, mimetype: "x" } }))
            .filter((o) => !opts?.search || o.name.startsWith(opts.search));
          return { data: rows, error: null };
        },
        remove: async (paths: string[]) => {
          record("remove", paths);
          rowPresentAtRemove.push(!!db && db.rows("crm_file").length > 0);
          if (errors.remove) return { data: null, error: errors.remove };
          const gone = paths.filter((p) => objects.delete(p));
          return { data: gone.map((name) => ({ name })), error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number, opts?: unknown) => {
          record("createSignedUrl", path, expiresIn, opts);
          if (errors.createSignedUrl) return { data: null, error: errors.createSignedUrl };
          return { data: { signedUrl: `https://storage.test/object/sign/${bucket}/${path}?token=DL&exp=${expiresIn}` }, error: null };
        },
      };
    },
  };
  return stub;
}
export type StorageStub = ReturnType<typeof createStorageStub>;

export type World = {
  db: FakeDb;
  storage: StorageStub;
  /** The client the mocked getScopedClient hands out. */
  client: ReturnType<typeof scopedClient>;
};

export function scopedClient(db: FakeDb, storage: StorageStub, opts: { signedIn?: boolean; roleError?: boolean } = {}) {
  const base = db.client();
  return {
    ...base,
    rpc: opts.roleError ? async () => ({ data: null, error: { code: "XX000", message: SECRET } }) : base.rpc,
    auth: { getUser: async () => ({ data: { user: opts.signedIn === false ? null : { id: db.userId } }, error: null }) },
    storage,
  };
}

export function seedTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    crm_lead: [
      { id: LEAD, org_id: ORG, first_name: "Mireille", last_name: "Toussaint", last_activity_at: null },
      { id: OTHER_LEAD, org_id: OTHER_ORG, first_name: "Other", last_name: "Firm", last_activity_at: null },
    ],
    crm_matter: [
      { id: MATTER, org_id: ORG, title: "Acme" },
      { id: OTHER_MATTER, org_id: OTHER_ORG, title: "Other" },
    ],
    crm_file: [],
    crm_activity: [],
    crm_document_draft: [],
    ...extra,
  };
}

export function makeWorld(opts: { role?: string | null; tables?: Record<string, Row[]>; objects?: Record<string, number>; client?: Parameters<typeof scopedClient>[2] } = {}): World {
  const db = createFakeDb({ role: opts.role === undefined ? "attorney" : opts.role, orgId: ORG, userId: "user-1", tables: opts.tables ?? seedTables() });
  const storage = createStorageStub(opts.objects);
  storage.watch(db);
  return { db, storage, client: scopedClient(db, storage, opts.client) };
}

/** Loads the actions module against `world`'s client; `revalidated` collects revalidatePath calls. */
export async function loadActions(world: World) {
  vi.resetModules();
  const revalidated: string[] = [];
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
  vi.doMock("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
  const actions = await import("../../src/app/dashboard/files/actions");
  return { ...actions, revalidated };
}

export const pathFor = (kind: "lead" | "matter", fileId: string, ext: string, org = ORG, parent = kind === "lead" ? LEAD : MATTER) =>
  `${org}/${kind}/${parent}/${fileId}.${ext}`;

export function fileRow(over: Row = {}): Row {
  return {
    id: FILE_ID,
    org_id: ORG,
    lead_id: LEAD,
    matter_id: null,
    storage_path: pathFor("lead", FILE_ID, "pdf"),
    file_name: "Signed LOE.pdf",
    mime: "application/pdf",
    size_bytes: 86_016,
    uploaded_by: "user-1",
    created_at: "2026-10-20T15:00:00Z",
    ...over,
  };
}
