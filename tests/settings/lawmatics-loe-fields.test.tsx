import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/**
 * Settings -> Integrations -> Lawmatics -> "LOE fields" (Sprint 19, stretch). Off by default, drawn
 * only for the admin tier of a firm with the proposals module, and a Lawmatics field list that
 * can't be loaded never clears what was saved.
 */

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
const CONCIERGE = { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const APPROVER = "99999999-9999-4999-8999-999999999999";

const settingsRow = (pricing: Record<string, unknown>) => ({ org_id: "o", approver_user_ids: [APPROVER], default_pay_url: "https://pay.example/x", notify_email: "o@firm.example", pricing });

/* ─────────────────────────── the action ─────────────────────────── */

describe("saveLoeFieldsAction", () => {
  beforeEach(() => vi.resetModules());

  async function setup(opts: { gate?: { error: string } | null | "notfound"; existing?: unknown; saveError?: unknown } = {}) {
    vi.resetModules();
    const save = vi.fn(async (input: unknown) => {
      if (opts.saveError) throw opts.saveError;
      return input;
    });
    const revalidate = vi.fn();
    vi.doMock("next/cache", () => ({ revalidatePath: revalidate }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({
      gateAdminAction: vi.fn(async () => {
        if (opts.gate === "notfound") throw NOT_FOUND;
        return opts.gate ?? null;
      }),
    }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalSettings: vi.fn(async () => {
        if (opts.existing === "fail") throw new Error("db down");
        return opts.existing === undefined ? settingsRow({ packages: [CONCIERGE], includes: [{ label: "a", included: "b" }] }) : opts.existing;
      }),
      saveProposalSettings: save,
    }));
    const { saveLoeFieldsAction } = await import("../../src/app/dashboard/settings/integrations/lawmatics/loe-fields-actions");
    const run = (entries: Array<[string, string]>) => {
      const f = new FormData();
      for (const [k, v] of entries) f.append(k, v);
      return saveLoeFieldsAction({}, f);
    };
    return { save, revalidate, run };
  }
  const saved = (save: ReturnType<typeof vi.fn>) => save.mock.calls[0][0] as { approverUserIds: string[]; defaultPayUrl: string | null; notifyEmail: string | null; pricing: Record<string, unknown> };

  it("saves the setting under lawmatics_loe_fields and keeps approvers, links, packages and includes", async () => {
    const { save, run, revalidate } = await setup();
    const r = await run([["enabled", "on"], ["map.LOE Package", "301"], ["map.LOE Legal Fee", "304"]]);
    expect(r).toEqual({ saved: true, notice: "Saved." });
    const input = saved(save);
    expect(input.pricing.lawmatics_loe_fields).toEqual({ enabled: true, map: { "LOE Package": "301", "LOE Legal Fee": "304" } });
    expect(input.pricing.packages).toEqual([CONCIERGE]);
    expect(input.pricing.includes).toEqual([{ label: "a", included: "b" }]);
    expect(input.approverUserIds).toEqual([APPROVER]);
    expect(input.defaultPayUrl).toBe("https://pay.example/x");
    expect(input.notifyEmail).toBe("o@firm.example");
    expect(revalidate).toHaveBeenCalledWith("/dashboard/settings/integrations/lawmatics/");
  });

  it("an unticked box saves it OFF, with the mapping kept for later", async () => {
    const { save, run } = await setup();
    await run([["map.LOE Package", "301"]]);
    expect(saved(save).pricing.lawmatics_loe_fields).toEqual({ enabled: false, map: { "LOE Package": "301" } });
  });

  it("with no settings row yet, the first save creates one with no approvers", async () => {
    const { save, run } = await setup({ existing: null });
    await run([["enabled", "on"], ["map.LOE Package", "301"]]);
    expect(saved(save)).toMatchObject({ approverUserIds: [], defaultPayUrl: null, notifyEmail: null });
    expect(saved(save).pricing).toEqual({ lawmatics_loe_fields: { enabled: true, map: { "LOE Package": "301" } } });
  });

  it("when the Lawmatics list couldn't be loaded (mapping=keep) the saved matches are kept and only the switch changes", async () => {
    const existing = settingsRow({ lawmatics_loe_fields: { enabled: false, map: { "LOE Package": "301", "LOE Fee Chart": "302" } } });
    const { save, run } = await setup({ existing });
    await run([["mapping", "keep"], ["enabled", "on"]]);
    expect(saved(save).pricing.lawmatics_loe_fields).toEqual({ enabled: true, map: { "LOE Package": "301", "LOE Fee Chart": "302" } });
  });

  it("only the admin tier: a refused role saves nothing, a firm without the module is notFound()", async () => {
    const refused = await setup({ gate: { error: "Only owners, admins and senior admins can change the proposal settings." } });
    expect(await refused.run([["enabled", "on"]])).toEqual({ error: "Only owners, admins and senior admins can change the proposal settings." });
    expect(refused.save).not.toHaveBeenCalled();
    const off = await setup({ gate: "notfound" });
    await expect(off.run([["enabled", "on"]])).rejects.toBe(NOT_FOUND);
    expect(off.save).not.toHaveBeenCalled();
  });

  it("refuses an id that isn't a Lawmatics field id, without saving", async () => {
    const { save, run } = await setup();
    const r = await run([["map.LOE Package", "../x"]]);
    expect(r.error).toContain("LOE Package");
    expect(save).not.toHaveBeenCalled();
  });

  it("an unreadable settings row, or a refused save, is an error and never a silent 'off'", async () => {
    const unreadable = await setup({ existing: "fail" });
    expect((await unreadable.run([["enabled", "on"]])).error).toBe("Couldn't save the LOE fields.");
    expect(unreadable.save).not.toHaveBeenCalled();
    const refused = await setup({ saveError: new Error("rls") });
    expect((await refused.run([["enabled", "on"]])).error).toBe("Couldn't save the LOE fields.");
  });
});

/* ─────────────────────────── the field list ─────────────────────── */

describe("loadLawmaticsCustomFields", () => {
  beforeEach(() => vi.resetModules());

  async function load(client: () => Promise<{ get: (path: string, params?: Record<string, string>) => Promise<unknown> }>) {
    vi.resetModules();
    class NotConnected extends Error {}
    vi.doMock("@/lib/lawmatics/connection", () => ({ firmLawmaticsClient: vi.fn(client), LawmaticsNotConnectedError: NotConnected }));
    vi.doMock("@/lib/proposals/store", () => ({ getProposalSettings: vi.fn() }));
    return { mod: await import("@/lib/proposals/loe-fields-load"), NotConnected };
  }

  it("asks GET /custom_fields?fields=all through the read client and lists id + name, sorted", async () => {
    const get = vi.fn(async () => ({ data: [{ id: "302", attributes: { name: "Fee chart" } }, { id: 301, name: "Package" }, { id: "x y", name: "Bad id" }, { id: "303" }, { id: "301", name: "Duplicate" }] }));
    const { mod } = await load(async () => ({ get }));
    expect(await mod.loadLawmaticsCustomFields()).toEqual([{ id: "302", name: "Fee chart" }, { id: "301", name: "Package" }].sort((a, b) => a.name.localeCompare(b.name)));
    expect(get).toHaveBeenCalledWith("/custom_fields", expect.objectContaining({ fields: "all" }));
  });

  it("null (not an empty list) when it can't be loaded: not connected, rejected or unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { mod, NotConnected } = await load(async () => {
      throw new NotConnected("no");
    });
    expect(await mod.loadLawmaticsCustomFields()).toBeNull();
    const down = await load(async () => ({ get: async () => { throw new Error("401"); } }));
    expect(await down.mod.loadLawmaticsCustomFields()).toBeNull();
  });
});

/* ─────────────────────────── the page ───────────────────────────── */

describe("the Lawmatics settings page: LOE fields section", () => {
  beforeEach(() => vi.resetModules());

  async function page(opts: { role?: string; modules?: string[]; active?: boolean; fields?: Array<{ id: string; name: string }> | null; config?: { status: "ok"; config: { enabled: boolean; map: Record<string, string> } } | { status: "unavailable" } }) {
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: opts.role ?? "owner", org: { id: "o", name: "RPB", slug: "rpb" }, user: { id: "u" } })) }));
    vi.doMock("@/lib/lawmatics/connection", () => ({
      getLawmaticsConnection: vi.fn(async () => ({ ok: true, connection: { id: "c", org_id: "o", status: opts.active === false ? "invalid" : "active", token_hint: "…0123", created_at: "2026-10-01T00:00:00Z", last_import_at: null, last_error: null } })),
    }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => (opts.modules ?? ["proposals"]).includes(m)) }));
    vi.doMock("@/lib/proposals/loe-fields-load", () => ({
      loadLawmaticsCustomFields: vi.fn(async () => (opts.fields === undefined ? [{ id: "301", name: "LOE Package (custom)" }, { id: "302", name: "Fee chart text" }] : opts.fields)),
      loadLoeFieldsConfig: vi.fn(async () => opts.config ?? { status: "ok", config: { enabled: false, map: {} } }),
    }));
    vi.doMock("@/components/lawmatics/LawmaticsImport", () => {
      const stub = () => createElement("div", { "data-stub": "import" });
      return { ClientsImport: stub, ConnectLawmatics: stub, DisconnectLawmatics: stub, MattersImport: stub, HiredMattersSync: stub };
    });
    vi.doMock("@/app/dashboard/settings/integrations/lawmatics/loe-fields-actions", () => ({ saveLoeFieldsAction: vi.fn() }));
    const { default: Page } = await import("../../src/app/dashboard/settings/integrations/lawmatics/page");
    return renderToStaticMarkup(createElement("div", null, await Page()));
  }

  it("is off by default: an unticked switch and six unmatched fields", async () => {
    const html = await page({});
    expect(html).toContain("LOE fields");
    expect(html).not.toMatch(/<input[^>]*name="enabled"[^>]*checked/);
    for (const name of ["LOE Package", "LOE Fee Chart", "LOE Classes", "LOE Legal Fee", "LOE USPTO Fees", "LOE Signature Deadline"]) expect(html).toContain(`name="map.${name}"`);
    expect(html).toContain("LOE Package (custom)");
    expect(html).toContain("Fee chart text");
    expect(html).toContain("Off unless you switch it on");
  });

  it("shows a saved, switched-on mapping as selected", async () => {
    const html = await page({ config: { status: "ok", config: { enabled: true, map: { "LOE Package": "301" } } } });
    expect(html).toMatch(/<input[^>]*name="enabled"[^>]*checked/);
    expect(html).toMatch(/<option value="301" selected/);
  });

  it("a saved match whose field is no longer listed stays visible (nothing is silently cleared)", async () => {
    const html = await page({ config: { status: "ok", config: { enabled: true, map: { "LOE Package": "999" } } } });
    expect(html).toContain("Field 999 (no longer in the list)");
  });

  it("a field list that couldn't be loaded says so, keeps the saved matches and posts mapping=keep", async () => {
    const html = await page({ fields: null, config: { status: "ok", config: { enabled: true, map: { "LOE Package": "301" } } } });
    expect(html).toContain("custom fields couldn&#x27;t be loaded just now");
    expect(html).toContain("Matched to field 301");
    expect(html).toContain('name="mapping" value="keep"');
    expect(html).not.toContain("<select");
  });

  it("unreadable settings say so, and are not drawn as 'off'", async () => {
    const html = await page({ config: { status: "unavailable" } });
    expect(html).toContain("couldn&#x27;t read your proposal settings");
    expect(html).not.toContain('name="enabled"');
  });

  it.each(["paralegal", "attorney", "intake", "viewer"])("is not drawn for a %s", async (role) => {
    const html = await page({ role });
    expect(html).not.toContain("LOE fields");
  });

  it("is not drawn for a firm without the proposals module", async () => {
    expect(await page({ modules: [] })).not.toContain("LOE fields");
  });
});
