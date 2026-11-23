import { beforeEach, describe, expect, it, vi } from "vitest";
import { MONEY_COLUMNS, NOTES_PRESENT, columnsFor, parseColumnPrefs } from "@/lib/review/sheet-columns";
import { COL_GOV_FEE, COL_GOV_FEE_DUE, COL_LEGAL_FEE, COL_LEGAL_FEE_DUE } from "@/lib/ui/words";
import { CF, customFields, customFixture, members, rows, TODAY } from "../review/columns-fixtures";
import { mockPage, renderPage } from "../review/custom-page-harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const load = { status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, failed: [], closeStages: [], custom: customFixture };
const FEE_HEADERS = [COL_LEGAL_FEE, COL_LEGAL_FEE_DUE, COL_GOV_FEE, COL_GOV_FEE_DUE];

describe("custom money columns are NOT under the owner-only fee rule (OPEN QUESTION for the firm: shown to every member who can read the table)", () => {
  beforeEach(() => vi.resetModules());

  it("an attorney, a paralegal and a viewer see the money custom column's value; the four fee headers are absent", async () => {
    for (const role of ["attorney", "paralegal", "viewer"]) {
      vi.resetModules();
      mockPage({ load, role });
      const html = await renderPage({ view: "sheet" });
      expect(html, role).toContain(">Quoted fee</th>");
      expect(html, role).toContain(">$1,250.00<");
      for (const h of FEE_HEADERS) expect(html, `${role} ${h}`).not.toContain(`>${h}</th>`);
    }
  });

  it("the owner sees both: the fee columns and the money custom column", async () => {
    mockPage({ load, role: "owner" });
    const html = await renderPage({ view: "sheet" });
    expect(html).toContain(">Quoted fee</th>");
    for (const h of FEE_HEADERS) expect(html, h).toContain(`>${h}</th>`);
  });

  it("stored prefs: a forged fee id is dropped for a non-owner while a given money field's cf: id is kept", () => {
    const allowed = columnsFor("trademarks", { canSeeMoney: false, hasNotes: NOTES_PRESENT, customFields }).map((c) => c.id);
    const quote = `cf:${CF.quote}`;
    const clean = parseColumnPrefs({ order: ["legalFee", quote, "govFee"], hidden: ["legalFeeDue"] }, allowed);
    for (const m of MONEY_COLUMNS) {
      expect(clean.order).not.toContain(m);
      expect(clean.hidden).not.toContain(m);
    }
    expect(clean.order).toContain(quote);
    expect(columnsFor("trademarks", { canSeeMoney: false, hasNotes: NOTES_PRESENT, customFields }).find((c) => c.id === quote)?.money).toBe(false);
  });
});
