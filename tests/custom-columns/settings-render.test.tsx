import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnsSettings } from "@/components/settings/ColumnsSettings";
import { loadColumnsSettings } from "@/lib/custom-columns/settings-load";
import * as W from "@/lib/ui/words";
import { ARCHIVED, LIVE, OK, S, STAMP } from "./settings-fixtures";

vi.mock("@/lib/custom-columns/actions", () => ({ createFieldAction: vi.fn(), updateFieldAction: vi.fn(), setCustomValueAction: vi.fn() }));

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const render = (state: Parameters<typeof ColumnsSettings>[0]["state"], initialConfirm?: string) => decode(renderToStaticMarkup(<ColumnsSettings state={state} initialConfirm={initialConfirm} />));
const rows = (html: string) => [...html.matchAll(/data-column-row="([^"]+)"/g)].map((m) => m[1]);

describe("Settings -> Columns: three states", () => {
  it("F11: not switched on is the sentence, with no form and no alert", () => {
    const html = render({ status: "not-set-up" });
    expect(html).toContain(W.CUSTOM_COLUMNS_NOT_READY);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('role="alert"');
  });
  it("couldn't load is an alert with no form", () => {
    const html = render({ status: "unavailable" });
    expect(html).toContain(`role="alert">${W.CANT_SHOW}`);
    expect(html).not.toContain("<form");
  });
  it("ok with nothing live says so, and offers Add", () => {
    const html = render({ status: "ok", live: [], archived: [], dropped: 0, use: { status: "ok", counts: {} } });
    expect(html).toContain(W.COLUMNS_NONE);
    expect(html).toContain('name="label"');
    expect(html).toContain(W.columnsCount(0));
  });
});

describe("P4: the one list and its controls", () => {
  const html = render(OK);
  it("the live columns in List order, then the archived ones in a closed details", () => {
    expect(rows(html)).toEqual([S.fee, S.priority, S.review, S.old]);
    expect(html).toMatch(/<details class="lx-card cs-card cs-archived"><summary class="cs-summary">Archived columns \(1\)<\/summary>/);
    expect(html).toContain(W.columnsCount(3));
  });
  it("each row has its section word and kind word", () => {
    expect(html).toContain("Both · Money");
    expect(html).toContain("Trademarks · Choice");
    expect(html).toContain("Contracts · Date");
  });
  it("Move up is disabled on the first row and Move down on the last; each posts only id, op and dir", () => {
    const tag = (label: string) => new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ?? "missing";
    const up = (label: string) => tag(W.columnsMoveUp(label));
    const down = (label: string) => tag(W.columnsMoveDown(label));
    expect(up("Priority")).toContain('value="up"');
    expect(up("Priority")).toContain('name="dir"');
    expect(up("Quoted fee")).toContain("disabled");
    expect(up("Priority")).not.toContain("disabled");
    expect(down("Review date")).toContain("disabled");
    expect(down("Priority")).not.toContain("disabled");
    const moveForm = /<form class="cs-move"[^>]*>([\s\S]*?)<\/form>/.exec(html)![1];
    expect([...moveForm.matchAll(/name="(\w+)"/g)].map((m) => m[1]).sort()).toEqual(["dir", "dir", "id", "op"]);
  });
  it("Rename and Edit choices post the rendered updated_at; Edit choices only on a Choice column", () => {
    expect((html.match(/name="op" value="rename"/g) ?? []).length).toBe(3);
    expect((html.match(/name="op" value="options"/g) ?? []).length).toBe(1);
    expect((html.match(new RegExp(`name="updatedAt" value="${STAMP.replace(/[.+]/g, "\\$&")}"`, "g")) ?? []).length).toBe(4);
    expect(html).toContain(">High\nMedium\nLow</textarea>");
  });
  it("each choice's use count", () => {
    expect(html).toContain(W.choiceUse("High", 3));
    expect(html).toContain(W.choiceUse("Low", 1));
    expect(html).toContain(W.choiceUse("Medium", 0));
    expect(W.choiceUse("Low", 1)).toBe("Low: used on 1 record");
  });
  it("Archive on every live row, Restore on the archived one, no confirm on Restore", () => {
    expect((html.match(new RegExp(`>${W.COLUMNS_ARCHIVE}<`, "g")) ?? []).length).toBe(3);
    expect(html).toContain(`aria-label="${W.columnsRestoreLabel("Old flag")}"`);
  });
  it("Add a column: name, section, kind, choices with its hint", () => {
    for (const n of ['name="label"', 'name="section"', 'name="kind"', 'name="choices"']) expect(html).toContain(n);
    expect(html).toContain(W.COLUMNS_CHOICES_LABEL);
    expect(html).toContain(W.COLUMNS_CHOICES_HINT);
    for (const w of ["Trademarks", "Contracts", "Both", "Text", "Date", "Money", "Choice", "Person"]) expect(html).toContain(`>${w}</option>`);
  });
  it("outcome lines are polite live regions", () => {
    expect(html).toContain('class="lx-note cs-outcome" aria-live="polite"');
  });
});

describe("F7: the Archive question", () => {
  it("asks the exact question before anything is written", () => {
    const html = render(OK, S.priority);
    expect(html).toContain(W.archiveQuestion("Priority"));
    expect(W.archiveQuestion("Priority")).toBe("Archive Priority? It leaves the List; its values are kept.");
  });
});

describe("F5: 40 live columns", () => {
  it("replaces the Add form with the limit sentence", () => {
    const live = Array.from({ length: 40 }, (_, i) => ({ ...LIVE[0], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, label: `Column ${i + 1}`, position: i }));
    const html = render({ status: "ok", live, archived: [], dropped: 0, use: { status: "ok", counts: {} } });
    expect(html).toContain(W.COLUMNS_AT_LIMIT);
    expect(html).not.toContain('name="section"');
  });
});

describe("F6 / R16: an unreadable use count keeps the page ok", () => {
  it("the list and the forms, the one uncounted line, no per-choice counts", () => {
    const html = render({ ...OK, use: { status: "unavailable" } });
    expect(rows(html)).toHaveLength(4);
    expect(html).toContain(W.COLUMNS_USE_UNCOUNTED);
    expect(html).not.toContain("used on");
    expect(html).toContain('name="choices"');
  });
});

describe("N4: two Renames in a row in the same tab", () => {
  it("the hidden stamp is the one rendered from the latest read", () => {
    const first = render(OK);
    const later = "2026-11-20T10:05:00.654321+00:00";
    const second = render({ ...OK, live: OK.live.map((f) => (f.id === S.priority ? { ...f, label: "Urgency", updatedAt: later } : f)) });
    expect(first).toContain(`value="${STAMP}"`);
    expect(second).toContain(`name="updatedAt" value="${later}"`);
    expect(second).toContain('defaultValue="Urgency"'.replace("defaultValue", "value"));
  });
});

describe("V1: tokens only", () => {
  it("no inline colour, only the shared classes", () => {
    const html = render(OK);
    expect(html).not.toMatch(/style="[^"]*colou?r/i);
    expect(html).toContain("lx-card");
    expect(html).toContain("lx-btn");
  });
});

describe("the loader: three states, the database's order, archived kept apart, the count its own state", () => {
  type Answer = { data: unknown; error: unknown };
  const client = (fields: Answer, values: Answer = { data: [], error: null }) => {
    const calls: string[][] = [];
    return {
      calls,
      db: {
        from(table: string) {
          const chain: string[] = [table];
          calls.push(chain);
          const q: Record<string, unknown> = {};
          for (const m of ["select", "eq", "in", "not", "order", "range", "limit"])
            q[m] = (...a: unknown[]) => {
              chain.push(`${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
              return q;
            };
          q.then = (res: (a: Answer) => unknown) => Promise.resolve(table === "crm_custom_field" ? fields : values).then(res);
          return q;
        },
      },
    };
  };
  const raw = (f: (typeof LIVE)[number]) => ({ id: f.id, section: f.section, label: f.label, kind: f.kind, options: f.options, position: f.position, archived: f.archived, updated_at: f.updatedAt });
  it("ok, in the order returned (never re-sorted), a stored-impossible row dropped and counted", async () => {
    const rowsIn = [raw(LIVE[2]), raw(ARCHIVED[0]), raw(LIVE[0]), { ...raw(LIVE[1]), label: " bad" }];
    const c = client({ data: rowsIn, error: null }, { data: [{ field_id: S.priority, value_choice: "High" }], error: null });
    const st = await loadColumnsSettings(c.db);
    expect(st.status).toBe("ok");
    if (st.status !== "ok") return;
    expect(st.live.map((f) => f.label)).toEqual(["Review date", "Quoted fee"]);
    expect(st.archived.map((f) => f.label)).toEqual(["Old flag"]);
    expect(st.dropped).toBe(1);
    expect(c.calls[0]).toEqual(["crm_custom_field", 'select("id, section, label, kind, options, position, archived, updated_at")', 'order("position")', 'order("label")', 'order("id")', "limit(1000)"]);
  });
  it("not-set-up and unavailable", async () => {
    expect(await loadColumnsSettings(client({ data: null, error: { code: "42P01" } }).db)).toEqual({ status: "not-set-up" });
    expect(await loadColumnsSettings(client({ data: null, error: { code: "PGRST205" } }).db)).toEqual({ status: "not-set-up" });
    expect(await loadColumnsSettings(client({ data: null, error: { code: "XX000" } }).db)).toEqual({ status: "unavailable" });
    expect(await loadColumnsSettings(client({ data: "x", error: null }).db)).toEqual({ status: "unavailable" });
    expect(await loadColumnsSettings(client({ data: Array.from({ length: 1000 }, () => ({})), error: null }).db)).toEqual({ status: "unavailable" });
  });
  it("a failed count read leaves the page ok", async () => {
    const st = await loadColumnsSettings(client({ data: [raw(LIVE[1])], error: null }, { data: null, error: { code: "XX000" } }).db);
    expect(st).toMatchObject({ status: "ok", use: { status: "unavailable" } });
  });
});
