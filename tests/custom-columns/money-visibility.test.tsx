import { beforeEach, describe, expect, it, vi } from "vitest";
import { MONEY_COLUMNS, NOTES_PRESENT, columnsFor, parseColumnPrefs } from "@/lib/review/sheet-columns";
import { canSeeCustomMoney, withoutMoney } from "@/lib/custom-columns/rules";
import { COL_GOV_FEE, COL_GOV_FEE_DUE, COL_LEGAL_FEE, COL_LEGAL_FEE_DUE } from "@/lib/ui/words";
import { CF, customFields, customFixture, members, rows, TODAY } from "../review/columns-fixtures";
import { mockPage, renderPage, spies } from "../review/custom-page-harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const load = { status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, failed: [], closeStages: [], custom: customFixture };
const FEE_HEADERS = [COL_LEGAL_FEE, COL_LEGAL_FEE_DUE, COL_GOV_FEE, COL_GOV_FEE_DUE];
const NON_OWNERS = ["admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk", "viewer", "social_media"];

/**
 * Changed on purpose (Taylor, Nov 23): a firm's own Money columns are owner-only, the same rule as the built-in fee columns
 * (`canSeeBilling`). This file used to pin the opposite (the open question, "every member sees it").
 */
describe("custom Money columns are owner-only, like the fee columns", () => {
  beforeEach(() => vi.resetModules());

  it("the predicate is canSeeBilling: owner only; unknown, null and every other role is no", () => {
    expect(canSeeCustomMoney("owner", false)).toBe(true);
    for (const r of [...NON_OWNERS, null, undefined, "", "Owner"]) expect(canSeeCustomMoney(r, false), String(r)).toBe(false);
    // Lectual staff acting inside the firm (owner role claim) never; an unknown session fails closed (Nov 23).
    for (const staff of [true, undefined, null, "false", 0]) expect(canSeeCustomMoney("owner", staff), String(staff)).toBe(false);
  });

  it("every non-owner: no money custom column, no amount anywhere in the page, no fee header; the page asks loadReview for no custom money", async () => {
    for (const role of NON_OWNERS) {
      vi.resetModules();
      mockPage({ load, role });
      const html = await renderPage({ view: "sheet" });
      expect(html, role).not.toContain(">Quoted fee</th>");
      expect(html, role).not.toContain("$1,250.00");
      for (const h of FEE_HEADERS) expect(html, `${role} ${h}`).not.toContain(`>${h}</th>`);
      // The chooser (draw-only) lists no Money field either.
      expect(html, role).not.toContain("Quoted fee");
      // The server read itself is told not to read amounts.
      expect(spies.loadReview.mock.calls[0][1]).toMatchObject({ customMoney: false });
    }
  });

  it("the owner sees both: the fee columns and the money custom column, and the read asks for amounts", async () => {
    mockPage({ load, role: "owner" });
    const html = await renderPage({ view: "sheet" });
    expect(html).toContain(">Quoted fee</th>");
    for (const h of FEE_HEADERS) expect(html, h).toContain(`>${h}</th>`);
    expect(spies.loadReview.mock.calls[0][1]).toMatchObject({ customMoney: true });
  });

  it("stored prefs: a forged fee id AND a forged Money cf: id are dropped for a non-owner", () => {
    const allowed = columnsFor("trademarks", { canSeeMoney: false, hasNotes: NOTES_PRESENT, customFields }).map((c) => c.id);
    const quote = `cf:${CF.quote}`;
    const clean = parseColumnPrefs({ order: ["legalFee", quote, "govFee"], hidden: ["legalFeeDue", quote] }, allowed);
    for (const m of [...MONEY_COLUMNS, quote]) {
      expect(clean.order).not.toContain(m);
      expect(clean.hidden).not.toContain(m);
    }
    expect(columnsFor("trademarks", { canSeeMoney: true, canSeeCustomMoney: true, hasNotes: NOTES_PRESENT, customFields }).find((c) => c.id === quote)?.money).toBe(true);
  });

  it("withoutMoney drops the Money fields and every amount, and passes the other states through", () => {
    const clean = withoutMoney(customFixture);
    if (clean.status !== "ok") throw new Error("ok expected");
    expect(clean.fields.some((f) => f.kind === "money")).toBe(false);
    expect(clean.values.some((v) => v.cents !== null || v.fieldId === CF.quote)).toBe(false);
    expect(clean.values.length).toBe(customFixture.status === "ok" ? customFixture.values.filter((v) => v.fieldId !== CF.quote).length : -1);
    expect(withoutMoney({ status: "unavailable" })).toEqual({ status: "unavailable" });
    expect(withoutMoney({ status: "not-set-up" })).toEqual({ status: "not-set-up" });
  });
});


describe("Settings -> Columns: the Money hint sits outside the kind label and describes the select (review fix)", () => {
  it("aria-describedby ties the select to the hint; the hint is not inside the <label>", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/settings/ColumnsSettingsForms.tsx", "utf8");
    expect(src).toContain('aria-describedby="cs-kind-money-hint"');
    const label = src.slice(src.indexOf("{COLUMNS_KIND_LABEL}"), src.indexOf("</label>", src.indexOf("{COLUMNS_KIND_LABEL}")));
    expect(label).not.toContain("COLUMNS_KIND_MONEY_HINT");
    expect(src).toMatch(/<\/label>\s*\{\/\*[^]*?\*\/\}\s*<span id="cs-kind-money-hint" className="lx-note">\s*\{COLUMNS_KIND_MONEY_HINT\}/);
  });
});

describe("the review's matter input declares the stage's phase (review fix)", () => {
  it("ReviewMatterIn's stage type carries phase, so the registered-mark rule can't be dropped silently", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/review/build.ts", "utf8")).toMatch(/stage: \{ code: string; label: string; is_open: boolean; waiting_on: MatterWaitingOn; order_index\?: number; phase\?: string \| null \} \| null;/);
  });
});

describe("Lectual staff acting inside a firm (owner role claim) get no custom money anywhere on the page (Nov 23)", () => {
  beforeEach(() => vi.resetModules());

  it("the List: loadReview is asked for no custom money; no Money column or amount; the built-in fee columns are unchanged", async () => {
    mockPage({ load, role: "owner", staff: true });
    const html = await renderPage({ view: "sheet" });
    expect(spies.loadReview.mock.calls[0][1]).toMatchObject({ customMoney: false, withFees: true });
    // The built-in Legal Fee is also $1,250.00 in the fixture, so the custom amount is checked by its column, never by the figure.
    expect(html).not.toContain("Quoted fee");
    expect(html).not.toContain(`cf:${CF.quote}`);
    for (const h of FEE_HEADERS) expect(html, h).toContain(`>${h}</th>`);
  });

  it("the owner Sheet (role-views): no Money column or amount in what is drawn or handed to the client table", async () => {
    mockPage({ load, role: "owner", staff: true, roleViews: true });
    const html = await renderPage({ view: "sheet" });
    expect(html).not.toContain("Quoted fee");
    expect(html).not.toContain(`cf:${CF.quote}`);
    expect(html).not.toContain('"1250.00"');
  });

  it("columnsFor: the built-in fees follow canSeeMoney, the custom Money field only canSeeCustomMoney === true", () => {
    const ids = (o: { canSeeMoney: boolean; canSeeCustomMoney?: boolean }) => columnsFor("trademarks", { ...o, hasNotes: NOTES_PRESENT, customFields }).map((c) => c.id);
    expect(ids({ canSeeMoney: true })).toContain("legalFee");
    expect(ids({ canSeeMoney: true })).not.toContain(`cf:${CF.quote}`);
    expect(ids({ canSeeMoney: true, canSeeCustomMoney: true })).toContain(`cf:${CF.quote}`);
  });
});
