import { vi } from "vitest";
import { createFakeDb, type FakeDb, type Row } from "../matters/helpers/fake-db";
import { runStageKeeper } from "../../src/lib/agents/stage-keeper/run";
import { keeperWorld, lead, mail, stageRows, type WorldInit } from "./db";
import { L, ORG, S } from "./fixtures";
import type { Autonomy } from "../../src/lib/agents/types";

/**
 * The Undo / Accept / Dismiss server actions over a stateful stand-in for the caller's scoped
 * client (RLS by org), with the REAL moveLeadStage and logActivity underneath. Only the things
 * that reach outside the pipeline are replaced by spies: the matter handoff, the sequence stop,
 * the automation rules and the cache refresh.
 */
export async function loadKeeperActions(opts: { role?: string | null; leads: Row[]; activity: Row[]; stages?: Row[] }) {
  vi.resetModules();
  const db: FakeDb = createFakeDb({
    role: opts.role === undefined ? "attorney" : opts.role,
    orgId: ORG,
    userId: "user-1",
    tables: { crm_lead: opts.leads, crm_activity: opts.activity, crm_stage: opts.stages ?? stageRows() },
  });
  const ensureMatterForLead = vi.fn(async () => {});
  const stopLeadSequencesAsStaff = vi.fn(async () => {});
  const runRules = vi.fn(async () => {});
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => db.client()) }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/lib/matters", async (orig) => ({ ...(await orig<typeof import("../../src/lib/matters")>()), ensureMatterForLead }));
  vi.doMock("@/lib/campaigns/stop-staff", () => ({ stopLeadSequencesAsStaff }));
  vi.doMock("@/lib/automation", () => ({ runRules }));
  vi.doMock("@/lib/notifications/producers", () => ({ notifyAssigned: vi.fn() }));
  const actions = await import("../../src/app/dashboard/leads/[id]/stage-keeper-actions");
  return { actions, db, ensureMatterForLead, stopLeadSequencesAsStaff, runRules };
}

export const form = (fields: Record<string, string>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

/** What the agent itself leaves behind, produced by really running it, for the actions to act on. */
export async function agentFixture(autonomy: Autonomy, init: Partial<WorldInit> = {}) {
  const w = keeperWorld({
    leads: [lead(L.amara, S.newPnc)],
    activity: [mail(L.amara, "loe-invoice", { subject: "Your engagement letter" })],
    ...init,
  });
  const result = await runStageKeeper(w.ctx(autonomy).ctx);
  return { w, result, leads: w.rows("crm_lead"), activity: w.rows("crm_activity") };
}

export const REAL_PAST = "2026-01-05T00:00:00.000Z";
