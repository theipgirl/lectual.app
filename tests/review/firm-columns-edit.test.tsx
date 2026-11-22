import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { canWriteCustomValue, firmColumnsBlock } from "@/lib/custom-columns/rules";
import { EMPTY_SHEET_STATE, sheetReducer } from "@/lib/review/sheet-edit";
import { CF, TM_LEAD, customFixture, members, rows, TODAY } from "./columns-fixtures";
import * as W from "@/lib/ui/words";

/** P3 / V4: "Firm columns" on the opened card, editable for staff, values only for viewer and social media. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/custom-columns/actions", () => ({ setCustomValueAction: vi.fn() }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const ROLES = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk", "viewer", "social_media"] as const;
const TM_ROW = rows[0];
const LEAD_ROW = rows[2];

async function aside(record: { kind: "lead" | "matter"; id: string; matterType: string | null }, role: string) {
  const { ReviewCardAside } = await import("@/components/review/ReviewCardExtras");
  const block = firmColumnsBlock(customFixture, record, members, TODAY, canWriteCustomValue(role));
  return decode(renderToStaticMarkup(<ReviewCardAside open={{ kind: record.kind, id: record.id }} row={null} members={members} today={TODAY} stagesFailed={false} closeStages={[]} firmColumns={block} />));
}
const firmBlock = (html: string) => html.slice(html.indexOf('<div class="rv-cardx-firm"'));

describe("P3: who types in the card", () => {
  beforeEach(() => vi.resetModules());

  for (const role of ROLES) {
    const staff = canWriteCustomValue(role);
    it(`${role}: ${staff ? "one form per column" : "values only: no input, select, form or button"}`, async () => {
      const html = firmBlock(await aside({ kind: "matter", id: TM_ROW.id, matterType: "TM" }, role));
      expect(html).toContain(W.FIRM_COLUMNS_HEADING);
      if (staff) {
        // TM fields: Priority, Review cycle, Quoted fee, Brand note, Reviewer
        expect((html.match(/<form/g) ?? []).length).toBe(5);
      } else {
        for (const tag of ["<input", "<select", "<form", "<button"]) expect(html, tag).not.toContain(tag);
        expect(html).toContain("High");
      }
    });
  }

  it("each form posts the field, the RECORD kind and the record the card shows; a matter showing its lead's value writes the matter", async () => {
    const html = firmBlock(await aside({ kind: "matter", id: TM_ROW.id, matterType: "TM" }, "attorney"));
    const forms = [...html.matchAll(/<form[^>]*data-firm-column="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)];
    expect(forms.map((f) => f[1])).toEqual([CF.priority, CF.review, CF.quote, CF.note, CF.reviewer]);
    for (const [, fieldId, body] of forms) {
      expect(body).toContain(`<input type="hidden" name="fieldId" value="${fieldId}"/>`);
      expect(body).toContain('<input type="hidden" name="kind" value="matter"/>');
      expect(body).toContain(`<input type="hidden" name="id" value="${TM_ROW.id}"/>`);
      expect(body).toMatch(/name="value"/);
      expect(body).not.toContain(TM_LEAD);
    }
    // Priority shows the lead's value with its title; the editor's own value is empty, with the visible hint
    expect(forms[0][2]).toContain(W.fromLeadHint("High"));
    expect(forms[0][2]).toContain('<input type="hidden" name="value" value=""/>');
  });

  it("a merged lead's card writes the keeper (the id the card shows)", async () => {
    const html = firmBlock(await aside({ kind: "lead", id: LEAD_ROW.id, matterType: null }, "paralegal"));
    expect(html).toContain('<input type="hidden" name="kind" value="lead"/>');
    expect(html).toContain(`<input type="hidden" name="id" value="${LEAD_ROW.id}"/>`);
    expect(html).toContain(W.fromMergedHint("Met at the expo"));
  });

  it("text / money / date inputs use the card's field style and a label", async () => {
    const html = firmBlock(await aside({ kind: "matter", id: TM_ROW.id, matterType: "TM" }, "attorney"));
    expect(html).toMatch(/<label for="rv-fc-[^"]+">Quoted fee<\/label>/);
    const money = /<input[^>]*inputMode="decimal"[^>]*>/.exec(html)?.[0] ?? "";
    for (const a of ['class="lx-input"', 'name="value"', 'value="1250.00"', 'aria-label="Quoted fee"']) expect(money).toContain(a);
    expect(html).toContain("<dt class=\"lx-label\">");
  });

  it("not switched on: no block for any role (CO4)", async () => {
    const { ReviewCardAside } = await import("@/components/review/ReviewCardExtras");
    for (const role of ROLES) {
      const block = firmColumnsBlock({ status: "not-set-up" }, { kind: "lead", id: LEAD_ROW.id, matterType: null }, members, TODAY, canWriteCustomValue(role));
      const html = renderToStaticMarkup(<ReviewCardAside open={{ kind: "lead", id: LEAD_ROW.id }} row={null} members={members} today={TODAY} stagesFailed={false} closeStages={[]} firmColumns={block} />);
      expect(html, role).not.toContain(W.FIRM_COLUMNS_HEADING);
    }
  });
});

describe("V4: the status line", () => {
  it("is a quiet lx-note with role=status and aria-live=polite", async () => {
    const html = firmBlock(await aside({ kind: "matter", id: TM_ROW.id, matterType: "TM" }, "attorney"));
    expect(html).toContain('<p class="lx-note rv-fc-status" role="status" aria-live="polite"></p>');
  });
  it("the reducer: Saved only after { saved: true } (a matching seq)", () => {
    const cell = `matter:${TM_ROW.id}|cf:${CF.priority}`;
    const st = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 7, value: { col: `cf:${CF.priority}`, raw: "Low" }, client: "", field: `cf:${CF.priority}` });
    expect(st.status?.tone).toBe("saving");
    expect(sheetReducer(st, { type: "saved", cell, seq: 6, client: "", field: `cf:${CF.priority}` }).status?.tone).toBe("saving");
    expect(sheetReducer(st, { type: "saved", cell, seq: 7, client: "", field: `cf:${CF.priority}` }).status?.tone).toBe("saved");
    expect(sheetReducer(st, { type: "failed", cell, seq: 7, client: "", field: `cf:${CF.priority}`, message: W.CUSTOM_CHOICE_BAD }).status).toMatchObject({ tone: "error", message: W.CUSTOM_CHOICE_BAD });
  });
});

describe("R9: an unchanged editor posts nothing (no DOM here: every post site is guarded by customUnchanged)", () => {
  const src = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
  it("the owner Sheet's custom saves and the card's submit each check customUnchanged first", () => {
    const table = src("src/components/review/SheetEditTable.tsx");
    const customTd = table.slice(table.indexOf("const customTd = "), table.indexOf("const fact = "));
    const saves = customTd.split("void save(").length - 1;
    expect(saves).toBe(2);
    expect(customTd.match(/customUnchanged\(/g)?.length).toBe(2);
    const card = src("src/components/review/FirmColumnsEdit.tsx");
    const submit = card.slice(card.indexOf("async function submit("));
    expect(submit.indexOf("customUnchanged(")).toBeLessThan(submit.indexOf("setCustomValueAction("));
  });
});
