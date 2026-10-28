import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { setupChecklist } from "@/lib/setup/checklist";
import { buildSetupState, type SetupReaders } from "@/lib/setup/build";
import type { SetupState } from "@/lib/setup/types";
import { SetupChecklistView, actionLabelFor, pillFor } from "@/components/setup/SetupChecklistView";
import { ALL_DONE, NOTHING_DONE, bad, ok } from "./helpers";

afterEach(() => vi.resetModules());

const NO_APPS = { lawpayApp: false, zoomApp: false };
const item = (s: SetupState, id: string) => setupChecklist(s).items.find((i) => i.id === id)!;

describe("items that are Lectual's to switch on (F9)", () => {
  it("AI is always Lectual's while it is off, LawPay only when the deployment has no LawPay app", () => {
    expect(item(NOTHING_DONE, "ai").owner).toBe("lectual");
    expect(item(NOTHING_DONE, "lawpay").owner).toBe("firm");
    expect(item({ ...NOTHING_DONE, lectual: NO_APPS }, "lawpay").owner).toBe("lectual");
    expect(item({ ...NOTHING_DONE, lectual: NO_APPS }, "meetings").owner).toBe("firm");
  });

  it("they are shown with Lectual's pill and no button, and left out of the total", () => {
    const state = { ...NOTHING_DONE, lectual: NO_APPS };
    const c = setupChecklist(state);
    expect(c.items).toHaveLength(10);
    expect(c.total).toBe(8);
    for (const id of ["ai", "lawpay"]) {
      expect(pillFor(item(state, id))).toEqual({ label: "Lectual sets this up", tone: "lx-pill-mute" });
      expect(actionLabelFor(item(state, id))).toBeNull();
    }
  });

  it("a firm with only those remaining is complete, M of M", () => {
    const c = setupChecklist({ ...ALL_DONE, aiConfigured: false, lawpay: ok(null), lectual: NO_APPS });
    expect(c).toMatchObject({ doneCount: 8, total: 8, complete: true });
    expect(c.items.filter((i) => i.status === "done")).toHaveLength(8);
  });

  it("a couldn't-check item is never Lectual's and still blocks complete", () => {
    const s = { ...ALL_DONE, aiConfigured: false, lawpay: bad, lectual: NO_APPS };
    expect(item(s, "lawpay")).toMatchObject({ status: "couldnt-check", owner: "firm" });
    expect(setupChecklist(s)).toMatchObject({ complete: false, total: 9, doneCount: 8 });
    expect(actionLabelFor(item(s, "lawpay"))).toBe("Check again");
  });

  it("a done Lectual-owned item counts as done in both", () => {
    const c = setupChecklist({ ...ALL_DONE, lectual: NO_APPS });
    expect(item({ ...ALL_DONE, lectual: NO_APPS }, "lawpay").status).toBe("done");
    expect(c).toMatchObject({ doneCount: 10, total: 10, complete: true });
  });

  it("the Zoom option says so while the firm's item stays the firm's", () => {
    const meetings = item({ ...NOTHING_DONE, lectual: { lawpayApp: true, zoomApp: false } }, "meetings");
    expect(meetings.why).toContain("Zoom: Lectual sets this up.");
    expect(meetings.owner).toBe("firm");
    expect(meetings.status).toBe("to-do");
    expect(item({ ...NOTHING_DONE, lectual: { lawpayApp: true, zoomApp: true } }, "meetings").why).not.toContain("Zoom: Lectual");
  });

  it("the ten ids and the other items' statuses are unchanged", () => {
    const withApps = setupChecklist(ALL_DONE);
    const without = setupChecklist({ ...ALL_DONE, lectual: undefined });
    expect(withApps.items.map((i) => [i.id, i.status])).toEqual(without.items.map((i) => [i.id, i.status]));
  });
});

describe("where the facts come from", () => {
  const readers = (over: Partial<SetupReaders> = {}): SetupReaders => ({
    getOrgProfile: async () => null,
    listMemberDirectory: async () => [],
    readModules: async () => ({ ok: true, modules: [] }),
    listConnections: async () => ({ ok: true, connections: [] }),
    getLawmaticsConnection: async () => ({ ok: true, connection: null }),
    listMeetingConnections: async () => ({ ok: true, connections: [] }),
    getLawPayConnection: async () => ({ ok: true, connection: null }),
    readAgentSettings: async () => ({ ok: true, rows: [] }),
    listIntakeForms: async () => ({ status: "ok", value: [] }),
    listServiceItems: async () => [],
    aiConfigured: () => false,
    ...over,
  });

  it("only an explicit false makes a step Lectual's; a missing or failing reader leaves it the firm's", async () => {
    expect((await buildSetupState(readers())).lectual).toEqual({ lawpayApp: true, zoomApp: true });
    expect((await buildSetupState(readers({ lawpayAppConfigured: () => false, zoomAppConfigured: () => false }))).lectual).toEqual(NO_APPS);
    const throwing = () => {
      throw new Error("x");
    };
    expect((await buildSetupState(readers({ lawpayAppConfigured: throwing, zoomAppConfigured: throwing }))).lectual).toEqual({ lawpayApp: true, zoomApp: true });
  });

  it("the live readers use the deployment's own LawPay and Zoom app checks", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/setup/readers.ts", "utf8");
    expect(src).toContain("lawPayClientCredentials() !== null");
    expect(src).toContain("zoomClientCredentials() !== null");
  });
});

describe("the checklist view (F10)", () => {
  const view = (state: SetupState) => renderToStaticMarkup(createElement(SetupChecklistView, { checklist: setupChecklist(state) }));

  it("button labels follow the status", () => {
    const html = view({ ...ALL_DONE, lawmatics: bad, lawpay: ok(null) });
    expect(html).toContain(">Review<");
    expect(html).toContain(">Check again<");
    expect(html).toContain(">Set up<");
  });

  it("the progress bar is a progressbar with now, min and max", () => {
    const html = view({ ...ALL_DONE, lawpay: ok(null) });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="10"');
    expect(html).toContain('aria-valuenow="9"');
    const lectual = view({ ...ALL_DONE, aiConfigured: false });
    expect(lectual).toContain('aria-valuemax="9"');
    expect(lectual).toContain('aria-valuenow="9"');
    expect(lectual).toContain("9 of 9 done");
    expect(lectual).toContain("Lectual sets this up");
    expect(lectual).toContain("All set. Next: try the");
  });
});

describe("the Settings shell (F8)", () => {
  async function layout(session: unknown, state: SetupState = NOTHING_DONE) {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ usePathname: () => "/dashboard/settings/setup/" }));
    vi.doMock("@/lib/org/modules", () => ({ activeOrgModules: vi.fn(async () => []) }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => session) }));
    const loadSetupState = vi.fn(async () => state);
    vi.doMock("@/lib/setup/load", () => ({ loadSetupState }));
    const { default: Layout } = await import("../../src/app/dashboard/settings/layout");
    return { html: renderToStaticMarkup(await Layout({ children: null })), loadSetupState };
  }

  it.each(["owner", "admin", "senior_admin"])("%s sees a Setup tab with N of M", async (role) => {
    const { html } = await layout({ kind: "ok", role }, { ...ALL_DONE, aiConfigured: false });
    expect(html).toMatch(/href="\/dashboard\/settings\/setup\/?"/);
    expect(html).toContain(">Setup<");
    expect(html).toContain("9 of 9");
    expect(html).toContain('aria-current="page"');
  });

  it.each(["attorney", "viewer", "clerk", "not-a-role"])("%s sees no Setup tab and nothing is read", async (role) => {
    const { html, loadSetupState } = await layout({ kind: "ok", role });
    expect(html).not.toContain(">Setup<");
    expect(loadSetupState).not.toHaveBeenCalled();
  });

  it("signed out sees no Setup tab", async () => {
    expect((await layout({ kind: "signed-out", redirectTo: "/x" })).html).not.toContain(">Setup<");
  });

  it("the side note names the admin tier from one constant", async () => {
    const { html } = await layout({ kind: "ok", role: "viewer" });
    expect(html).toContain("Firm-wide settings need Senior admin or above.");
  });

  it("the old /dashboard/setup/ address redirects to the Settings tab", async () => {
    vi.resetModules();
    vi.doUnmock("next/navigation");
    const { default: Old } = await import("../../src/app/dashboard/setup/page");
    let digest = "";
    try {
      Old();
    } catch (e) {
      digest = (e as { digest?: string }).digest ?? "";
    }
    expect(digest).toContain("/dashboard/settings/setup/");
    const { SETUP_PATH } = await import("@/lib/setup/routes");
    expect(SETUP_PATH).toBe("/dashboard/settings/setup/");
  });
});
