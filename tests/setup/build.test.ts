import { describe, expect, it } from "vitest";
import { buildSetupState, type SetupReaders } from "@/lib/setup/build";
import { setupChecklist } from "@/lib/setup/checklist";
import { ALL_DONE, ITEM_IDS } from "./helpers";

const SECRET = "org_9f3a1c77 violates constraint crm_org_profile_pkey_secret";

/** Fake readers returning what the real ones return, shaped to make every item done. */
function readers(over: Partial<SetupReaders> = {}): SetupReaders {
  return {
    getOrgProfile: async () => ({ display_name: "Hartwell IP", email_signature: "Best,\nHartwell IP" }),
    listMemberDirectory: async () => [{}, {}, {}],
    readModules: async () => ({ ok: true, modules: ["mailbox", "agents"] }),
    listConnections: async () => ({
      ok: true,
      connections: [{ provider: "microsoft", status: "active" }] as never,
    }),
    getLawmaticsConnection: async () => ({ ok: true, connection: { status: "active" } as never }),
    listMeetingConnections: async () => ({ ok: true, connections: [{ provider: "fathom", status: "active" }] as never }),
    getLawPayConnection: async () => ({ ok: true, connection: { status: "active" } as never }),
    readAgentSettings: async () => ({ ok: true, rows: [{ enabled: true }] }),
    listIntakeForms: async () => ({ status: "ok", value: [{ status: "live" }] }),
    listServiceItems: async () => [{ active: true, kind: "legal_fee" }],
    aiConfigured: () => true,
    ...over,
  };
}

const KEYS = Object.keys(readers()) as (keyof SetupReaders)[];

describe("buildSetupState maps each reader", () => {
  it("to the state that makes all ten items done", async () => {
    const state = await buildSetupState(readers());
    expect(state).toEqual(ALL_DONE);
    expect(setupChecklist(state)).toMatchObject({ doneCount: 10, complete: true });
  });

  it("keeps 'no connection' and 'no profile' as values, not as failures", async () => {
    const state = await buildSetupState(
      readers({
        getOrgProfile: async () => null,
        getLawmaticsConnection: async () => ({ ok: true, connection: null }),
        getLawPayConnection: async () => ({ ok: true, connection: null }),
        listConnections: async () => ({ ok: true, connections: [] }),
        listMeetingConnections: async () => ({ ok: true, connections: [] }),
        readAgentSettings: async () => ({ ok: true, rows: [] }),
        listIntakeForms: async () => ({ status: "ok", value: [] }),
        listServiceItems: async () => [],
        aiConfigured: () => false,
      }),
    );
    expect(state.profile).toEqual({ ok: true, value: null });
    expect(state.lawmatics).toEqual({ ok: true, value: null });
    expect(state.lawpay).toEqual({ ok: true, value: null });
    expect(state.mailboxes).toEqual({ ok: true, value: [] });
    expect(state.aiConfigured).toBe(false);
    expect(setupChecklist(state).items.filter((i) => i.status === "couldnt-check")).toHaveLength(0);
  });

  it("counts the member directory, and treats a null module list as unreadable rather than 'no modules'", async () => {
    expect((await buildSetupState(readers({ listMemberDirectory: async () => [{}] }))).members).toEqual({ ok: true, value: { count: 1 } });
    expect((await buildSetupState(readers({ readModules: async () => ({ ok: true, modules: [] }) }))).modules).toEqual({ ok: true, value: [] });
    expect((await buildSetupState(readers({ readModules: async () => ({ ok: false }) }))).modules).toEqual({ ok: false });
  });
});

describe("a failing reader is isolated to its own reading", () => {
  const THROWS: Record<keyof SetupReaders, Partial<SetupReaders>> = Object.fromEntries(
    KEYS.map((k) => [k, { [k]: () => Promise.reject(new Error(SECRET)) }]),
  ) as never;

  const STATE_KEY: Record<keyof SetupReaders, string> = {
    getOrgProfile: "profile",
    listMemberDirectory: "members",
    readModules: "modules",
    listConnections: "mailboxes",
    getLawmaticsConnection: "lawmatics",
    listMeetingConnections: "meetings",
    getLawPayConnection: "lawpay",
    readAgentSettings: "agents",
    listIntakeForms: "intakeForms",
    listServiceItems: "services",
    aiConfigured: "aiConfigured",
  };

  it.each(KEYS.filter((k) => k !== "aiConfigured"))("%s throwing gives 'could not be read' for that item only, and the loader does not throw", async (key) => {
    const state = await buildSetupState(readers(THROWS[key]));
    const expected = { ...ALL_DONE, [STATE_KEY[key]]: { ok: false } };
    expect(state).toEqual(expected);
    expect(JSON.stringify(state)).not.toContain("org_9f3a1c77");
    expect(JSON.stringify(state)).not.toContain("constraint");
  });

  it.each([
    ["listConnections", { listConnections: async () => ({ ok: false as const, error: SECRET }) }, "mailboxes"],
    ["getLawmaticsConnection", { getLawmaticsConnection: async () => ({ ok: false as const }) }, "lawmatics"],
    ["listMeetingConnections", { listMeetingConnections: async () => ({ ok: false as const }) }, "meetings"],
    ["getLawPayConnection", { getLawPayConnection: async () => ({ ok: false as const }) }, "lawpay"],
    ["readAgentSettings", { readAgentSettings: async () => ({ ok: false as const }) }, "agents"],
    ["readModules", { readModules: async () => ({ ok: false as const }) }, "modules"],
    ["listIntakeForms unavailable", { listIntakeForms: async () => ({ status: "unavailable" as const, error: new Error(SECRET) }) }, "intakeForms"],
    ["listIntakeForms unconfigured", { listIntakeForms: async () => ({ status: "unconfigured" as const }) }, "intakeForms"],
  ])("%s reporting a failure is that reading only", async (_name, over, key) => {
    const state = await buildSetupState(readers(over as Partial<SetupReaders>));
    expect(state).toEqual({ ...ALL_DONE, [key]: { ok: false } });
    expect(JSON.stringify(state)).not.toContain("org_9f3a1c77");
  });

  it("an unconfigured intake table is 'could not be read', so the item says couldn't-check, never 'none'", async () => {
    const state = await buildSetupState(readers({ listIntakeForms: async () => ({ status: "unconfigured" }) }));
    expect(setupChecklist(state).items.find((i) => i.id === "intake")!.status).toBe("couldnt-check");
  });

  it("a reader that throws synchronously is handled the same way", async () => {
    const state = await buildSetupState(readers({ getOrgProfile: (() => { throw new Error(SECRET); }) as never }));
    expect(state.profile).toEqual({ ok: false });
  });

  it("every reader failing at once still returns a state, and none of the ten items is done but AI", async () => {
    const all = Object.fromEntries(KEYS.filter((k) => k !== "aiConfigured").map((k) => [k, () => Promise.reject(new Error(SECRET))]));
    const state = await buildSetupState(readers(all));
    const c = setupChecklist(state);
    expect(c.items.filter((i) => i.status === "done").map((i) => i.id)).toEqual(["ai"]);
    expect(c.items.filter((i) => i.status === "couldnt-check")).toHaveLength(9);
    expect(ITEM_IDS).toHaveLength(10);
    expect(JSON.stringify(state)).not.toContain("org_9f3a1c77");
  });

  it("the rendered why-lines never carry the error text", async () => {
    const all = Object.fromEntries(KEYS.filter((k) => k !== "aiConfigured").map((k) => [k, () => Promise.reject(new Error(SECRET))]));
    const c = setupChecklist(await buildSetupState(readers(all)));
    expect(JSON.stringify(c)).not.toMatch(/org_9f3a1c77|violates|crm_org_profile_pkey/);
  });
});
