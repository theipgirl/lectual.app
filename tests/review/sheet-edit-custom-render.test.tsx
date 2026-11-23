import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomColumnsState, CustomValue } from "@/lib/custom-columns/rules";
import { nextEditableCell, type SheetPerms } from "@/lib/review/sheet-edit";
import { CF, OWNER_PERMS, TM_LEAD, customFields, customFixture, members, rows, TODAY } from "./columns-fixtures";
import * as W from "@/lib/ui/words";
import { UNASSIGNED_LANE } from "@/lib/review/lanes";

/** P1 / P2 / R9 / R10: the owner Sheet's custom-cell editors, drawn with `initial.open`. Invented names only. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));
vi.mock("@/lib/custom-columns/actions", () => ({ setCustomValueAction: vi.fn(), createFieldAction: vi.fn(), updateFieldAction: vi.fn() }));

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const params = { view: "sheet", who: "all", kind: "both", q: "", i: 1, person: null, open: null, since: "default" } as never;
const PERMS: SheetPerms = { ...OWNER_PERMS, writeCustom: true };
const col = (id: string) => `cf:${id}` as const;
const TM = rows[0].key;
const BL = rows[1].key;
const LEAD = rows[2].key;

async function render(opts: { open: { rowKey: string; col: string }[]; custom?: CustomColumnsState; perms?: SheetPerms }) {
  const { SheetEdit } = await import("@/components/review/SheetEdit");
  return decode(
    renderToStaticMarkup(
      <div className="rv-owner">
        <SheetEdit rows={rows} perms={opts.perms ?? PERMS} owner today={TODAY} members={members} canWrite params={params} canSeeMoney canSeeCustomMoney custom={opts.custom ?? customFixture} initial={{ open: opts.open as never }} />
      </div>,
    ),
  );
}
/** The cell's `<td>` (its button and its open editor) by `data-rse-cell`. */
const td = (html: string, key: string) => {
  const at = html.indexOf(`data-rse-cell="${key}"`);
  if (at < 0) return "";
  const start = html.lastIndexOf("<td", at);
  return html.slice(start, html.indexOf("</td>", at) + 5);
};

/** The TM matter with NO own values, its lead holding one of each kind: every editor opens empty with a "From the lead" line. */
const DATE_F = "00000000-0000-4000-8000-00000000c007";
const v = (id: string, over: Partial<CustomValue> & { fieldId: string }): CustomValue => ({ id, leadId: null, matterId: null, text: null, date: null, cents: null, choice: null, userId: null, updatedAt: "2026-11-01T10:00:00Z", ...over });
const inheritedFixture: CustomColumnsState = {
  status: "ok",
  fields: [...customFields, { id: DATE_F, section: "trademarks", label: "Review date", kind: "date", position: 7, options: [] }],
  values: [
    v("w1", { fieldId: CF.priority, leadId: TM_LEAD, choice: "High" }),
    v("w2", { fieldId: CF.quote, leadId: TM_LEAD, cents: 50000 }),
    v("w3", { fieldId: CF.reviewer, leadId: TM_LEAD, userId: "u-sam" }),
    v("w4", { fieldId: CF.note, leadId: TM_LEAD, text: "Met at the expo" }),
    v("w5", { fieldId: DATE_F, leadId: TM_LEAD, date: "2026-12-01" }),
  ],
  mergedInto: {},
  leadOfMatter: customFixture.status === "ok" ? customFixture.leadOfMatter : {},
};

describe("P1: each kind's editor", () => {
  beforeEach(() => vi.resetModules());

  it("text, date and money inputs (money with $), each with the Enter / Esc line", async () => {
    const html = await render({ open: [{ rowKey: BL, col: col(CF.review) }, { rowKey: BL, col: col(CF.signed) }, { rowKey: TM, col: col(CF.quote) }] });
    const text = td(html, `${BL}|${col(CF.review)}`);
    expect(text).toMatch(/<div class="rse-pop rse-cv-pop" role="dialog" aria-label="Review cycle">/);
    expect(text).toMatch(/<input[^>]*class="rse-in"[^>]*type="text"[^>]*aria-label="Review cycle"[^>]*value="Yearly"/);
    expect(text).toContain(`<span class="rse-ed-hint">${W.SHEET_ENTER_ESC}</span>`);
    const date = td(html, `${BL}|${col(CF.signed)}`);
    expect(date).toMatch(/<input[^>]*class="rse-in rse-in-date"[^>]*type="date"[^>]*value="2026-10-15"/);
    const money = td(html, `${TM}|${col(CF.quote)}`);
    expect(money).toContain('<span class="rse-money-sign" aria-hidden="true">$</span>');
    expect(money).toMatch(/<input[^>]*inputMode="decimal"[^>]*value="1250.00"/);
  });

  it("choice: ChoicePop (a listbox named by the field) with a dash and the choices; person: PersonPop with the field's name and No one", async () => {
    const html = await render({ open: [{ rowKey: BL, col: col(CF.review) }, { rowKey: TM, col: col(CF.reviewer) }, { rowKey: LEAD, col: col(CF.priority) }] });
    const choice = td(html, `${LEAD}|${col(CF.priority)}`);
    expect(choice).toMatch(/<div class="rse-pop" role="listbox" aria-label="Priority">/);
    const options = [...choice.matchAll(/role="option"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(options).toEqual(["—", "High", "Low", W.noLongerAChoice("Urgent (old)")]);
    expect(choice).toMatch(/aria-selected="true" class="rse-opt sel">Urgent \(old\) \(no longer a choice\)</);
    const person = td(html, `${TM}|${col(CF.reviewer)}`);
    expect(person).toMatch(/<div class="rse-pop" role="listbox" aria-label="Reviewer">/);
    expect(person).toContain(`${W.CUSTOM_NO_ONE}</button>`);
    expect(person).not.toContain(UNASSIGNED_LANE);
  });

  it("R10: inherited cells open empty with a visible hint line, for every kind", async () => {
    const html = await render({
      custom: inheritedFixture,
      open: [col(CF.priority), col(CF.quote), col(CF.reviewer), col(CF.note), col(DATE_F)].map((c) => ({ rowKey: TM, col: c })),
    });
    const hint = (c: string) => td(html, `${TM}|${c}`);
    expect(hint(col(CF.priority))).toContain(`<span class="rse-ed-hint">${W.fromLeadHint("High")}</span>`);
    expect(hint(col(CF.priority))).toMatch(/aria-selected="true" class="rse-opt sel">—</);
    expect(hint(col(CF.quote))).toContain(W.fromLeadHint("$500.00"));
    expect(hint(col(CF.quote))).toMatch(/inputMode="decimal"[^>]*value=""/);
    expect(hint(col(CF.reviewer))).toContain(W.fromLeadHint("Sam Park"));
    expect(hint(col(CF.note))).toContain(W.fromLeadHint("Met at the expo"));
    expect(hint(col(DATE_F))).toContain(W.fromLeadHint("Dec 1"));
    expect(hint(col(DATE_F))).toMatch(/type="date"[^>]*value=""/);
  });

  it("a merged duplicate's value: the merged hint", async () => {
    const html = await render({ open: [{ rowKey: LEAD, col: col(CF.note) }] });
    expect(td(html, `${LEAD}|${col(CF.note)}`)).toContain(W.fromMergedHint("Met at the expo"));
  });

  it("the Owner column's PersonPop is unchanged: Owner and Unassigned", async () => {
    const html = await render({ open: [{ rowKey: TM, col: "court" }] });
    const owner = td(html, `${TM}|court`);
    expect(owner).toMatch(/role="listbox" aria-label="Owner"/);
    expect(owner).toContain(`${UNASSIGNED_LANE}</button>`);
    expect(owner).not.toContain("rse-ed-hint");
  });
});

describe("P2: every drawn editable custom cell is a stop Tab can land on", () => {
  beforeEach(() => vi.resetModules());

  it("a <button> with data-rse-cell, aria-haspopup and aria-expanded, keyed as nextEditableCell keys it", async () => {
    const html = await render({ open: [] });
    const stops = [...html.matchAll(/<button[^>]*data-rse-cell="([^"]+)"[^>]*>/g)].filter((m) => m[1].includes("|cf:"));
    expect(stops.length).toBeGreaterThan(0);
    for (const m of stops) {
      expect(m[0]).toContain('class="rse-cell rse-edit');
      expect(m[0]).toMatch(/aria-haspopup="(dialog|listbox)"/);
      expect(m[0]).toContain('aria-expanded="false"');
    }
    // text / money / date are dialogs; choice / person are listboxes
    expect(html).toMatch(new RegExp(`aria-haspopup="dialog"[^>]*data-rse-cell="${TM}\\|${col(CF.quote)}"|data-rse-cell="${TM}\\|${col(CF.quote)}"[^>]*aria-haspopup="dialog"`));
    expect(html).toMatch(new RegExp(`aria-haspopup="listbox"[^>]*data-rse-cell="${TM}\\|${col(CF.priority)}"|data-rse-cell="${TM}\\|${col(CF.priority)}"[^>]*aria-haspopup="listbox"`));
    // a key nextEditableCell returns is a drawn stop
    const keys = new Set(stops.map((m) => m[1]));
    const sectionOf = (k: string) => (k === BL ? "contracts" : "trademarks");
    const fits = (c: string, k: string) => {
      const f = customFields.find((x) => col(x.id) === c);
      return !!f && (f.section === "both" || f.section === sectionOf(k));
    };
    const drawnCols = (r: { key: string }) => [...new Set([...keys].filter((k) => k.startsWith(`${r.key}|`)).map((k) => k.split("|")[1]))];
    const to = nextEditableCell(rows, { rowKey: TM, col: "next" }, PERMS, 1, drawnCols as never, (c, r) => fits(c, r.key));
    expect(to && keys.has(`${to.rowKey}|${to.col}`)).toBe(true);
  });

  it("a Contracts-only field draws no editor on a Trademarks row; without writeCustom no custom cell is a button", async () => {
    const html = await render({ open: [] });
    expect(html).not.toContain(`data-rse-cell="${TM}|${col(CF.signed)}"`);
    expect(html).toContain(`data-rse-cell="${BL}|${col(CF.signed)}"`);
    const ro = await render({ open: [], perms: { ...OWNER_PERMS } });
    expect(ro).not.toMatch(/data-rse-cell="[^"]*\|cf:/);
  });
});
