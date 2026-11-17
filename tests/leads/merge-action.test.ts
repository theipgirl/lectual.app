import { beforeEach, describe, expect, it, vi } from "vitest";
import { MERGE_REFUSALS } from "@/lib/ui/words";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({ role: "owner" as string | null, calls: [] as string[], rpc: { data: { tasks: 1 }, error: null } as { data: unknown; error: unknown } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    rpc: vi.fn(async (name: string, args: unknown) => {
      state.calls.push(name === "current_org_role" ? "role" : `${name}:${JSON.stringify(args)}`);
      if (name === "current_org_role") return { data: state.role, error: null };
      return state.rpc;
    }),
    from: vi.fn(() => {
      state.calls.push("read");
      throw new Error("no reads expected");
    }),
  })),
}));

const { mergeLeadsAction } = await import("@/app/dashboard/intake/merge/actions");

function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set("keeper", A);
  f.set("loser", B);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.calls = [];
  state.role = "owner";
  state.rpc = { data: { tasks: 1 }, error: null };
});

describe("mergeLeadsAction", () => {
  it("re-resolves the role first; a refused role reads and writes nothing", async () => {
    state.role = "attorney";
    expect(await mergeLeadsAction({}, form())).toEqual({ error: MERGE_REFUSALS.merge_not_allowed });
    expect(state.calls).toEqual(["role"]);
  });

  it("calls crm_merge_leads once through the scoped client and redirects to the kept lead", async () => {
    await expect(mergeLeadsAction({}, form({ "choice.email": "loser", "choice.org_id": "loser" }))).rejects.toMatchObject({ to: `/dashboard/leads/${A}/?merged=1` });
    expect(state.calls).toEqual(["role", `crm_merge_leads:${JSON.stringify({ p_keeper: A, p_loser: B, p_choices: { email: "loser" } })}`]);
  });

  it("a refusal is its fixed sentence", async () => {
    state.rpc = { data: null, error: { code: "23514", message: "merge_chain: secret" } };
    expect(await mergeLeadsAction({}, form())).toEqual({ error: MERGE_REFUSALS.merge_chain });
  });
});
