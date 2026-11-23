import { vi } from "vitest";

/**
 * The fees-load mock set for loadReview (every source but the scoped client's tables is mocked), shared by the custom-column loader
 * tests. Invented names only. `fakeDb` answers per table and records every chain, so a test can see which reads were made and when.
 */
export type Call = { table: string; select: string; eq: [string, unknown][]; inn: [string, readonly string[]][]; range: [number, number] | null; limit: number | null };
export function fakeDb(answer: (call: Call) => { data: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      return {
        select(select: string) {
          const call: Call = { table, select, eq: [], inn: [], range: null, limit: null };
          const b: Record<string, unknown> = {
            eq: (c: string, v: unknown) => (call.eq.push([c, v]), b),
            in: (c: string, v: readonly string[]) => (call.inn.push([c, v]), b),
            // The non-owner's value read filters `value_cents is null` (Taylor, Nov 23: custom money is owner-only).
            is: () => b,
            gte: () => b,
            order: () => b,
            range: (from: number, to: number) => ((call.range = [from, to]), b),
            limit: (n: number) => ((call.limit = n), b),
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
              calls.push(call);
              try {
                const r = answer(call);
                return resolve({ data: r.data, error: r.error ?? null });
              } catch (e) {
                return reject ? reject(e) : Promise.reject(e);
              }
            },
          };
          return b;
        },
      };
    },
  };
  return { db, calls };
}

export const state = { db: null as unknown, matters: [] as unknown[], merged: false, events: [] as string[] };

export function mockReviewSources() {
  vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => state.db }));
  vi.mock("@/lib/matters", () => ({ listMatters: async () => state.matters }));
  vi.mock("@/lib/pipeline", () => ({ listLeads: async () => [], listStages: async () => [] }));
  vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));
  vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => ({ status: "unconfigured" }) }));
  vi.mock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: async () => ({ status: "ok", byLead: {} }) }));
  vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
  vi.mock("@/lib/org/modules", () => ({ activeOrgModulesOrNull: async () => [] }));
  vi.mock("@/lib/files/read", () => ({ countFilesByParent: async () => new Map(), countLettersByMatter: async () => new Map() }));
  vi.mock("@/lib/leads/live", () => ({ leadRead: async (fn: (kit: { merged: boolean }) => Promise<unknown>) => fn({ merged: state.merged }) }));
  vi.mock("@/app/dashboard/matters/list-utils", () => ({ matterIdsNeedingReview: () => new Set() }));
}

export const NOW = new Date("2026-11-02T15:00:00Z");
export const matter = (id: string, over: Record<string, unknown> = {}) => ({
  id, matter_number: `TM-${id}`, title: "Northwind Tea", mark_text: "NORTHWIND", owner_name: "Northwind Tea LLC", status: "open", type: "TM", lead_id: null, assigned_to: null,
  stage_entered_at: "2026-10-20T00:00:00Z", created_at: "2026-01-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null,
  stage: { code: "10", label: "Application Filed", is_open: true, waiting_on: "uspto", order_index: 5 }, ...over,
});
