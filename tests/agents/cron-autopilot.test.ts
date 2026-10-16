import { describe, it, expect, vi } from "vitest";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";

/** The cron route goes through runAllAgents, so a paused firm is skipped end to end. */
const ORG_PAUSED = "org-paused";
const ORG_ON = "org-on";
const { client, log } = fakeAdmin((q: Recorded) => {
  if (q.table === "crm_org" && q.filters.some((f) => f.op === "contains")) return { data: [{ id: ORG_PAUSED }, { id: ORG_ON }], error: null };
  if (q.table === "agent_autopilot") {
    const org = q.filters.find((f) => f.column === "org_id")?.value;
    return { data: [{ paused: org === ORG_PAUSED }], error: null };
  }
  if (q.table === "agent_setting") return { data: [{ agent: "intake-triage", enabled: true, autonomy: "draft" }], error: null };
  if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "r" }], error: null };
  return undefined;
});

vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s3cret" } }));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
vi.mock("@/lib/agents/deps", () => ({
  productionRunnerDeps: () => ({ admin: client, llm: async () => ({ output: {}, costUsd: 0 }), createDraft: async () => ({ id: "q" }) }),
}));

const { GET } = await import("@/app/api/cron/agents/route");

describe("agents cron", () => {
  it("runs the firm that is on and nothing for the paused firm", async () => {
    const res = await GET(new Request("https://x/api/cron/agents/", { headers: { authorization: "Bearer s3cret" } }) as never);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, runs: 1 });
    const runInserts = log.filter((q) => q.table === "agent_run" && q.action === "insert");
    expect(runInserts.map((q) => (q.values as { org_id: string }).org_id)).toEqual([ORG_ON]);
  });
});
