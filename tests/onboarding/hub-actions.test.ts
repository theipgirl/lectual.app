import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const getScopedClient = vi.fn();
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: (...a: unknown[]) => getScopedClient(...a) }));
vi.mock("@/lib/db/admin", () => {
  throw new Error("the admin client must never be loaded by the hub actions");
});

import { hideHubCardAction, markHubFlowAction, pickHubRecordsAction, resetHubProgressAction } from "@/lib/onboarding/hub-actions";

function client(opts: { user?: object | null; getUserError?: object; updateError?: object } = {}) {
  const updateUser = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const getUser = vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? null : opts.user }, error: opts.getUserError ?? null });
  getScopedClient.mockResolvedValue({ auth: { getUser, updateUser } });
  return { getUser, updateUser };
}

const TOUR = { version: 1, seen_at: "2026-10-01T00:00:00.000Z", outcome: "finished" };
const USER = { id: "u1", user_metadata: { full_name: "Ada", lectual_tour: TOUR, lectual_hub: { version: 1, done: ["intake-leads"], hidden_card: true } } };

beforeEach(() => {
  getScopedClient.mockReset();
});

describe("markHubFlowAction", () => {
  it("merges the flow once and keeps every other key, the tour flag included", async () => {
    const { updateUser } = client({ user: USER });
    expect(await markHubFlowAction("matters-list", "done")).toEqual({ ok: true });
    const data = updateUser.mock.calls[0][0].data;
    expect(data.full_name).toBe("Ada");
    expect(data.lectual_tour).toEqual(TOUR);
    expect(data.lectual_hub).toEqual({ version: 1, done: ["intake-leads", "matters-list"], hidden_card: true });
  });

  it("does not duplicate a flow already done", async () => {
    const { updateUser } = client({ user: USER });
    await markHubFlowAction("intake-leads", "done");
    expect(updateUser.mock.calls[0][0].data.lectual_hub.done).toEqual(["intake-leads"]);
  });

  it("starts from empty when the stored flag is malformed", async () => {
    const { updateUser } = client({ user: { id: "u", user_metadata: { lectual_hub: "junk" } } });
    await markHubFlowAction("intake-leads", "done");
    expect(updateUser.mock.calls[0][0].data.lectual_hub).toEqual({ version: 1, done: ["intake-leads"] });
  });

  it("refuses a signed-out caller with a fixed sentence and writes nothing", async () => {
    const { updateUser } = client({ user: null });
    expect(await markHubFlowAction("intake-leads", "done")).toEqual({ ok: false, error: expect.stringMatching(/not signed in/i) });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each([["nope", "done"], ["", "done"], [undefined, "done"], [null, "done"], [{}, "done"], [["intake-leads"], "done"], [4, "done"], ["intake-leads", "undone"], ["intake-leads", undefined], ["intake-leads", ""]])(
    "rejects %j / %j before building a client",
    async (flow, status) => {
      expect((await markHubFlowAction(flow, status)).ok).toBe(false);
      expect(getScopedClient).not.toHaveBeenCalled();
    },
  );

  it("never returns raw error text, whether getUser, updateUser or the client fails", async () => {
    client({ user: USER, updateError: { message: "relation auth.users secret" } });
    expect(JSON.stringify(await markHubFlowAction("intake-leads", "done"))).not.toContain("secret");
    client({ user: USER, getUserError: { message: "jwt secret" } });
    expect(JSON.stringify(await markHubFlowAction("intake-leads", "done"))).not.toContain("secret");
  });

  it("returns a failure result when the client itself throws", async () => {
    getScopedClient.mockRejectedValue(new Error("secret cookie"));
    const r = await markHubFlowAction("intake-leads", "done");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("takes no user id or org id", () => {
    expect(markHubFlowAction.length).toBe(2);
    expect(resetHubProgressAction.length).toBe(0);
    expect(hideHubCardAction.length).toBe(0);
  });
});

describe("resetHubProgressAction and hideHubCardAction", () => {
  it("reset empties done, clears the hidden card, keeps other keys", async () => {
    const { updateUser } = client({ user: USER });
    expect(await resetHubProgressAction()).toEqual({ ok: true });
    const data = updateUser.mock.calls[0][0].data;
    expect(data.lectual_hub).toEqual({ version: 1, done: [] });
    expect(data.lectual_tour).toEqual(TOUR);
  });

  it("hide sets hidden_card and keeps the finished list", async () => {
    const { updateUser } = client({ user: { id: "u", user_metadata: { lectual_hub: { version: 1, done: ["intake-leads"] } } } });
    await hideHubCardAction();
    expect(updateUser.mock.calls[0][0].data.lectual_hub).toEqual({ version: 1, done: ["intake-leads"], hidden_card: true });
  });

  it("both refuse a signed-out caller and fail with a fixed sentence", async () => {
    client({ user: null });
    expect((await resetHubProgressAction()).ok).toBe(false);
    expect((await hideHubCardAction()).ok).toBe(false);
    client({ user: USER, updateError: { message: "secret" } });
    expect(JSON.stringify(await hideHubCardAction())).not.toContain("secret");
  });
});

describe("pickHubRecordsAction", () => {
  function reads(lead: { data: unknown; error: unknown }, matter: { data: unknown; error: unknown }, user: object | null = { id: "u" }) {
    const updateUser = vi.fn();
    const chain = (result: unknown) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.order = () => q;
      q.limit = () => Promise.resolve(result);
      return q;
    };
    const from = vi.fn((table: string) => chain(table === "crm_lead" ? lead : matter));
    getScopedClient.mockResolvedValue({ from, auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }), updateUser } });
    return { from, updateUser };
  }

  it("returns the first lead and matter, read-only", async () => {
    const { from, updateUser } = reads({ data: [{ id: "L1" }], error: null }, { data: [{ id: "M1" }], error: null });
    expect(await pickHubRecordsAction()).toEqual({ lead: { status: "ok", id: "L1" }, matter: { status: "ok", id: "M1" } });
    expect(from.mock.calls.map((c) => c[0]).sort()).toEqual(["crm_lead", "crm_matter"]);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("is three-state per kind: none and unavailable are different", async () => {
    reads({ data: [], error: null }, { data: null, error: { message: "boom secret" } });
    const result = await pickHubRecordsAction();
    expect(result).toEqual({ lead: { status: "none" }, matter: { status: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("is unavailable when signed out", async () => {
    reads({ data: [{ id: "L" }], error: null }, { data: [{ id: "M" }], error: null }, null);
    expect(await pickHubRecordsAction()).toEqual({ lead: { status: "unavailable" }, matter: { status: "unavailable" } });
  });

  it("is unavailable when the client throws", async () => {
    getScopedClient.mockRejectedValue(new Error("x"));
    expect((await pickHubRecordsAction()).lead.status).toBe("unavailable");
  });
});

describe("source gates", () => {
  const files = [
    "src/lib/onboarding/hub.ts",
    "src/lib/onboarding/hub-runner.ts",
    "src/lib/onboarding/hub-actions.ts",
    "src/components/onboarding/GettingStartedRunner.tsx",
    "src/components/onboarding/GettingStartedCard.tsx",
    "src/components/onboarding/HideHubCard.tsx",
    "src/components/onboarding/FlowList.tsx",
    "src/app/dashboard/getting-started/page.tsx",
  ];
  it.each(files)("%s has no admin client, service role, send path or logging", (f) => {
    expect(readFileSync(f, "utf8")).not.toMatch(/db\/admin|getAdminClient|service_role|SUPABASE_SERVICE|dangerouslySetInnerHTML|console\.|sendMail|\.insert\(|\.delete\(|\.upsert\(/);
  });
  it("the only write in the actions is the user's own metadata", () => {
    const src = readFileSync("src/lib/onboarding/hub-actions.ts", "utf8");
    expect(src.match(/updateUser/g)).toHaveLength(1);
    expect(src).not.toMatch(/\.update\(/);
  });
});
