import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTES_PRESENT, columnsFor } from "@/lib/review/sheet-columns";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { canWriteCustomValue } from "@/lib/custom-columns/rules";
import { COLUMNS_ADD, CUSTOM_COLUMNS_NOT_ON } from "@/lib/ui/words";
import { customFixture, members, rows, tableHeaders, TODAY } from "./columns-fixtures";
import { mockPage, renderPage, spies } from "./custom-page-harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const base = { status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, closeStages: [] };
/** No alert says anything: the owner Sheet's save-status live region is always present, and stays empty. */
const alertTexts = (html: string) => [...html.matchAll(/role="alert"[^>]*>([\s\S]*?)<\//g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim()).filter(Boolean);
const NOTE = "Some details couldn't load (custom columns). Refresh to try again.";
const builtin = (section: "trademarks" | "contracts", money: boolean) => columnsFor(section, { canSeeMoney: money, hasNotes: NOTES_PRESENT }).map((c) => c.header);

/** The read-only List (a viewer: no edit allowed) and the owner's editable Sheet (an owner in a firm with role views). */
const LISTS = [
  ["read-only List", { role: "viewer", roleViews: false, money: false, marker: 'class="rv-sheets"' }],
  ["owner's editable Sheet", { role: "owner", roleViews: true, money: true, marker: 'class="rse-root"' }],
] as const;

describe.each(LISTS)("the %s with each custom state", (_name, who) => {
  beforeEach(() => vi.resetModules());

  it("not switched on: every Sprint 1 column, no custom column, the sentence only for the admin tier (CO4), no alert, not in the details note", async () => {
    mockPage({ load: { ...base, failed: [], custom: { status: "not-set-up" } }, role: who.role, roleViews: who.roleViews });
    const html = decode(await renderPage({ view: "sheet" }));
    expect(html).toContain(who.marker);
    const [tm, ct] = tableHeaders(html);
    expect(tm).toEqual(builtin("trademarks", who.money));
    expect(ct).toEqual(builtin("contracts", who.money));
    const notes = [...html.matchAll(/<p class="lx-note rv-sheet-note" data-section-note="(\w+)">([^<]*)<\/p>/g)];
    expect(notes).toHaveLength(2);
    // The owner is the admin tier; the attorney is not.
    for (const n of notes) {
      if (who.role === "owner") expect(n[2]).toContain(CUSTOM_COLUMNS_NOT_ON);
      else expect(n[2]).not.toContain(CUSTOM_COLUMNS_NOT_ON);
    }
    expect(html).not.toContain(COLUMNS_ADD);
    expect(alertTexts(html)).toEqual([]);
    expect(html).not.toContain("custom columns)");
  });

  it("couldn't load: no custom column or cell, the details note names custom columns; fees still render for the owner", async () => {
    mockPage({ load: { ...base, failed: ["custom columns"], custom: { status: "unavailable" } }, role: who.role, roleViews: who.roleViews });
    const html = decode(await renderPage({ view: "sheet" }));
    const [tm, ct] = tableHeaders(html);
    expect(tm).toEqual(builtin("trademarks", who.money));
    expect(ct).toEqual(builtin("contracts", who.money));
    expect(html).toContain(NOTE);
    expect(html).not.toContain(CUSTOM_COLUMNS_NOT_ON);
    for (const label of customFixture.status === "ok" ? customFixture.fields.map((f) => f.label) : []) expect(html).not.toContain(`data-label="${label}"`);
    if (who.money) expect(html).toContain(">$1,250.00<");
    expect(alertTexts(html)).toEqual([]);
  });

  it("ok with zero fields: nothing added and no note", async () => {
    mockPage({ load: { ...base, failed: [], custom: { status: "ok", fields: [], values: [], mergedInto: {}, leadOfMatter: {} } }, role: who.role, roleViews: who.roleViews });
    const html = decode(await renderPage({ view: "sheet" }));
    expect(tableHeaders(html)[0]).toEqual(builtin("trademarks", who.money));
    expect(html).not.toContain(CUSTOM_COLUMNS_NOT_ON);
    expect(html).not.toContain("custom columns");
  });

  it("ok with fields: they are drawn and the chooser lists them", async () => {
    mockPage({ load: { ...base, failed: [], custom: customFixture }, role: who.role, roleViews: who.roleViews });
    const html = decode(await renderPage({ view: "sheet" }));
    // Nov 23: the Money field ("Quoted fee") is drawn for the owner only.
    const want = who.money ? ["Priority", "Review cycle", "Quoted fee", "Brand note", "Reviewer"] : ["Priority", "Review cycle", "Brand note", "Reviewer"];
    expect(tableHeaders(html)[0].slice(-want.length)).toEqual(want);
    if (!who.money) expect(html).not.toContain("$1,250.00");
  });
});

describe("only the List reads the firm's columns", () => {
  beforeEach(() => vi.resetModules());

  it("the page asks for them on ?view=sheet and on no other view", async () => {
    for (const [params, expected] of [[{ view: "sheet" }, true], [{}, false], [{ view: "board" }, false], [{ view: "cards" }, false]] as const) {
      vi.resetModules();
      mockPage({ load: { ...base, failed: [], custom: null }, role: "attorney" });
      const html = decode(await renderPage(params));
      const opts = spies.loadReview.mock.calls[0]?.[1] as { withCustom?: boolean };
      expect(opts.withCustom, JSON.stringify(params)).toBe(expected);
      if (!expected) {
        expect(html).not.toContain("custom columns");
        expect(html).not.toContain(CUSTOM_COLUMNS_NOT_ON);
      }
    }
  });
});

/* ── CO4 / R18: before 0115, the "not switched on" sentence is the admin tier's only, on the List; never a link ── */

const ROLES = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk", "viewer", "social_media"] as const;

describe("CO4: not switched on, every role and a signed-out caller", () => {
  beforeEach(() => vi.resetModules());

  for (const role of [...ROLES, null]) {
    const adminTier = role === "owner" || role === "admin" || role === "senior_admin";
    it(`${role ?? "null"}: the sentence is ${adminTier ? "in both section notes" : "absent"}, and there is no "Add a column" link`, async () => {
      // Any role whose own permissions allow an edit gets the editable List, in either look; the rest get the read-only List.
      mockPage({ load: { ...base, failed: [], custom: { status: "not-set-up" } }, role, roleViews: role === "owner" });
      const html = decode(await renderPage({ view: "sheet" }));
      const canEdit = !!role && (MATTER_WRITE_ROLES.includes(role as never) || CAN_WRITE_LEAD.includes(role as never) || canWriteCustomValue(role));
      if (role !== null) expect(html).toContain(canEdit ? 'class="rse-root"' : 'class="rv-sheets"');
      const count = html.split(CUSTOM_COLUMNS_NOT_ON).length - 1;
      expect(count).toBe(adminTier ? 2 : 0);
      expect(html).not.toContain(COLUMNS_ADD);
      expect(html).not.toContain("/dashboard/settings/columns/");
    });
  }
});

// Changed on purpose (editable views): the admin tier's "Add a column" link to Settings -> Columns is gone with that page; nobody is linked to it.
describe("no section note links to a Settings page for columns, whatever the role", () => {
  beforeEach(() => vi.resetModules());
  for (const role of ROLES) {
    it(`${role}: no link`, async () => {
      mockPage({ load: { ...base, failed: [], custom: customFixture }, role, roleViews: role === "owner" });
      const html = decode(await renderPage({ view: "sheet" }));
      expect(html).not.toContain("/dashboard/settings/columns");
    });
  }
});
