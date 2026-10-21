import { vi } from "vitest";
import { includedIndex, records, type Raw } from "../../src/lib/lawmatics/jsonapi";
import type { LawmaticsClient, ListResult } from "../../src/lib/lawmatics/client";
import { prospectsPayload } from "../__fixtures__/lawmatics.fixture";
import { createFakeDb, type FakeDb, type Row } from "../matters/helpers/fake-db";
import { ORG, OTHER_ORG, S, SECRET, STAGES } from "./helpers";

export const L = {
  amara: "11111111-0000-4000-8000-000000000001",
  kwame: "11111111-0000-4000-8000-000000000002",
  priya: "11111111-0000-4000-8000-000000000003",
  margo: "11111111-0000-4000-8000-000000000004",
  desmond: "11111111-0000-4000-8000-000000000005",
  lena: "11111111-0000-4000-8000-000000000006",
  hollis: "11111111-0000-4000-8000-000000000007",
  ines: "11111111-0000-4000-8000-000000000008",
  other: "11111111-0000-4000-8000-0000000000ff",
} as const;

export function stageRows(org = ORG): Row[] {
  return STAGES.map((s) => ({ id: s.id, org_id: org, name: s.name, category: s.category, order_index: s.orderIndex }));
}

export function leadRow(over: Row & { id: string }): Row {
  return {
    org_id: ORG,
    first_name: "Test",
    last_name: "Lead",
    email: `${String(over.id).slice(-4)}@intake.invalid`,
    current_stage_id: S.pnc,
    sheet_key: null,
    lawmatics_id: null,
    practice_area: null,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

export type World = {
  db: FakeDb;
  /** The client the mocked getScopedClient hands out. */
  client: ReturnType<typeof makeClient>;
};

function makeClient(db: FakeDb, opts: { signedIn?: boolean; roleError?: boolean }) {
  const base = db.client();
  return {
    ...base,
    rpc: opts.roleError ? async () => ({ data: null, error: { code: "XX000", message: "SECRET" } }) : base.rpc,
    auth: { getUser: async () => ({ data: { user: opts.signedIn === false ? null : { id: db.userId } }, error: null }) },
  };
}

export function makeWorld(opts: { role?: string | null; leads?: Row[]; activity?: Row[]; stages?: Row[]; client?: { signedIn?: boolean; roleError?: boolean } } = {}): World {
  const db = createFakeDb({
    role: opts.role === undefined ? "admin" : opts.role,
    orgId: ORG,
    userId: "user-1",
    tables: {
      crm_stage: opts.stages ?? stageRows(),
      crm_lead: opts.leads ?? [],
      crm_activity: opts.activity ?? [],
    },
  });
  return { db, client: makeClient(db, opts.client ?? {}) };
}

/** A lead that belongs to another firm: RLS hides it from the fake client. */
export const foreignLead = (id = L.other) => leadRow({ id, org_id: OTHER_ORG });

export const mockScoped = (client: unknown) => vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client) }));

/** A read-only Lawmatics client stand-in that records every call. */
export function lawmaticsStub(opts: { prospects?: () => Raw; truncated?: boolean; includeDropped?: boolean; contactsFail?: boolean } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const client: LawmaticsClient = {
    get: async (path) => {
      calls.push({ method: "get", path });
      return {};
    },
    listAll: async (path): Promise<ListResult> => {
      calls.push({ method: "listAll", path });
      if (path === "/contacts") {
        if (opts.contactsFail) throw new Error(SECRET);
        return { records: [], included: new Map(), pagesFetched: 1, truncated: false, includeDropped: false };
      }
      const payload = (opts.prospects ?? (() => prospectsPayload([{ id: "100", matterName: "A", firstName: "Amara", stage: "Consultation Scheduled", email: "amara@example.com" }])))();
      return {
        records: records(payload),
        included: includedIndex(payload),
        pagesFetched: 1,
        truncated: opts.truncated ?? false,
        truncatedReason: opts.truncated ? `stopped at 5000 ${SECRET}` : undefined,
        includeDropped: opts.includeDropped ?? false,
        includeDroppedReason: opts.includeDropped ? SECRET : undefined,
      };
    },
  };
  return { client, calls };
}

