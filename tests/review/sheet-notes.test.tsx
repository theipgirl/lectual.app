import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { noteCellFor, noteCommitter, noteFirstLine, noteKeyIntent, pickLatestNotes, SHEET_NOTE_CLIP, type SheetNotes } from "@/lib/review/sheet-notes";
import { readSheetNotes, type NotesDb } from "@/lib/review/sheet-notes-load";
import { SHEET_COLUMNS } from "@/lib/review/sheet";
import { row, TODAY } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));

const M1 = "00000000-0000-4000-8000-000000000001";
const L1 = "00000000-0000-4000-8000-000000000002";

/** A fake scoped client: records each query's filters and answers from `answer`. */
function fakeDb(answer: (q: { eqs: [string, string][]; ins: [string, readonly string[]][]; from: number }) => { data: unknown[] | null; error: unknown }) {
  const calls: { table: string; select: string; eqs: [string, string][]; ins: [string, readonly string[]][]; from: number }[] = [];
  const db: NotesDb = {
    from(table: string) {
      return {
        select(select: string) {
          const c = { table, select, eqs: [] as [string, string][], ins: [] as [string, readonly string[]][], from: 0 };
          calls.push(c);
          const q = {
            eq(col: string, v: string) { c.eqs.push([col, v]); return q; },
            in(col: string, v: readonly string[]) { c.ins.push([col, v]); return q; },
            order() { return q; },
            range(from: number) { c.from = from; return q; },
            then(res: (v: { data: unknown[] | null; error: unknown }) => unknown, rej?: (e: unknown) => unknown) {
              return Promise.resolve(answer(c)).then(res as never, rej);
            },
          };
          return q as never;
        },
      };
    },
  };
  return { db, calls };
}

describe("the latest note per row (pure)", () => {
  it("first non-blank line, whitespace tidied, clipped", () => {
    expect(noteFirstLine("\n\n  Called   Ana \nsecond line")).toBe("Called Ana");
    expect(noteFirstLine("   ")).toBeNull();
    expect(noteFirstLine(null)).toBeNull();
    const long = noteFirstLine("x".repeat(200))!;
    expect(long.length).toBe(SHEET_NOTE_CLIP);
    expect(long.endsWith("…")).toBe(true);
  });

  it("keeps the newest note with text per record, keyed by kind, in the firm's date", () => {
    const map = pickLatestNotes(
      [
        { matter_id: M1, lead_id: null, created_at: "2026-11-10T15:00:00Z", note: "older" },
        { matter_id: M1, lead_id: null, created_at: "2026-11-16T15:00:00Z", note: "Newest\nmore" },
        { matter_id: M1, lead_id: null, created_at: "2026-11-17T15:00:00Z", note: "   " },
        { matter_id: null, lead_id: L1, created_at: "2026-11-12T15:00:00Z", body: "from body" },
      ],
      (iso) => iso.slice(0, 10),
    );
    expect(map.get(`matter:${M1}`)).toEqual({ text: "Newest", date: "2026-11-16" });
    expect(map.get(`lead:${L1}`)).toEqual({ text: "from body", date: "2026-11-12" });
  });

  it("three cell states: a note, none, couldn't load (never 'none' for a failed read)", () => {
    const ok: SheetNotes = { status: "ok", byKey: new Map([[`matter:${M1}`, { text: "Hi", date: TODAY }]]) };
    expect(noteCellFor(ok, { kind: "matter", id: M1 })).toEqual({ state: "note", note: { text: "Hi", date: TODAY } });
    expect(noteCellFor(ok, { kind: "lead", id: L1 })).toEqual({ state: "none" });
    expect(noteCellFor({ status: "unavailable" }, { kind: "matter", id: M1 })).toEqual({ state: "unavailable" });
    expect(noteCellFor(null, { kind: "matter", id: M1 })).toEqual({ state: "unavailable" });
  });
});

describe("the loader (three states, batched, plain notes only)", () => {
  it("reads type note, by matter and by lead, one query per chunk of 80", async () => {
    const matters = Array.from({ length: 81 }, (_, i) => ({ kind: "matter" as const, id: `m${i}` }));
    const { db, calls } = fakeDb((q) => ({ data: q.ins[0][1].includes("m0") ? [{ matter_id: "m0", lead_id: null, created_at: "2026-11-16T15:00:00Z", note: "Hello" }] : [], error: null }));
    const out = await readSheetNotes(db, [...matters, { kind: "lead", id: L1 }], "America/New_York");
    expect(out.status).toBe("ok");
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.table).toBe("crm_activity");
      expect(c.eqs).toContainEqual(["type", "note"]);
      expect(c.select).not.toMatch(/\*/);
    }
    expect(calls.map((c) => c.ins[0][1].length).sort((a, b) => a - b)).toEqual([1, 1, 80]);
    if (out.status === "ok") expect(out.byKey.get("matter:m0")).toEqual({ text: "Hello", date: "2026-11-16" });
  });

  it("a read that found nothing is ok and empty", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    const out = await readSheetNotes(db, [{ kind: "matter", id: M1 }], "UTC");
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.byKey.size).toBe(0);
  });

  it("an error is unavailable, never 'no notes'", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { code: "500" } }));
    expect(await readSheetNotes(db, [{ kind: "matter", id: M1 }], "UTC")).toEqual({ status: "unavailable" });
  });

  it("a read that runs out of pages is unavailable, not cut short", async () => {
    const full = Array.from({ length: 1000 }, () => ({ matter_id: M1, lead_id: null, created_at: "2026-11-16T15:00:00Z", note: "n" }));
    const { db } = fakeDb(() => ({ data: full, error: null }));
    expect(await readSheetNotes(db, [{ kind: "matter", id: M1 }], "UTC")).toEqual({ status: "unavailable" });
  });
});

describe("the editor's save rule", () => {
  it("Enter (not Shift+Enter) saves, Esc cancels, IME composition does nothing", () => {
    expect(noteKeyIntent("Enter", false)).toBe("commit");
    expect(noteKeyIntent("Enter", true)).toBe("none");
    expect(noteKeyIntent("Escape", false)).toBe("cancel");
    expect(noteKeyIntent("a", false)).toBe("none");
    expect(noteKeyIntent("Enter", false, true)).toBe("none");
  });

  it("Enter then the blur that follows posts once", async () => {
    let release: (v: { ok: boolean }) => void = () => {};
    const save = vi.fn(() => new Promise<{ ok: boolean }>((r) => (release = r)));
    const c = noteCommitter(save);
    const enter = c.commit("Called Ana");
    const blur = c.commit("Called Ana");
    release({ ok: true });
    expect(await enter).toBe("saved");
    expect(await blur).toBe("ignored");
    expect(await c.commit("Called Ana")).toBe("ignored");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Called Ana");
  });

  it("blur alone saves once (trimmed)", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const c = noteCommitter(save);
    expect(await c.commit("  Left a message  ")).toBe("saved");
    expect(save).toHaveBeenCalledWith("Left a message");
  });

  it("Esc posts nothing, and the blur after it posts nothing", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const c = noteCommitter(save);
    c.cancel();
    expect(await c.commit("typed")).toBe("ignored");
    expect(save).not.toHaveBeenCalled();
  });

  it("empty text saves nothing", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const c = noteCommitter(save);
    expect(await c.commit("   \n ")).toBe("empty");
    expect(await c.commit("later")).toBe("ignored");
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed save keeps the session open (the text stays) and can be tried again", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, message: "nope" }).mockResolvedValueOnce({ ok: true });
    const c = noteCommitter(save);
    expect(await c.commit("Called Ana")).toBe("failed");
    expect(c.ended).toBe(false);
    expect(await c.commit("Called Ana")).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("a save that throws counts as failed", async () => {
    const c = noteCommitter(async () => {
      throw new Error("x");
    });
    expect(await c.commit("a")).toBe("failed");
  });

  it("the component only clears the typed text after a save that worked", () => {
    const src = readFileSync("src/components/review/NotesCell.tsx", "utf8");
    const ok = src.indexOf("if (ok) {");
    const clear = src.indexOf('setDraft("")');
    expect(ok).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(ok);
    expect(src.indexOf('setDraft("")', clear + 1)).toBe(-1);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe("the Notes cell, drawn", () => {
  async function cell(props: Partial<Parameters<typeof import("@/components/review/NotesCell").NotesCell>[0]>) {
    const { NotesCell } = await import("@/components/review/NotesCell");
    return renderToStaticMarkup(<NotesCell kind="matter" id={M1} client="Matter Co" cell={{ state: "none" }} canEdit={false} today={TODAY} {...props} />);
  }

  it("a writer gets a button into the editor; a note shows its first line and date", async () => {
    const html = await cell({ canEdit: true, cell: { state: "note", note: { text: "Called <b>Ana</b>", date: "2026-11-16" } } });
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Note for Matter Co"');
    expect(html).toContain("Called &lt;b&gt;Ana&lt;/b&gt;");
    expect(html).toContain("Nov 16");
  });

  it("a writer with no note sees an empty cell to type in", async () => {
    const html = await cell({ canEdit: true });
    expect(html).toContain("<button");
    expect(html).toContain("Add a note");
  });

  it("other roles read the latest note with no editor", async () => {
    const html = await cell({ canEdit: false, cell: { state: "note", note: { text: "Called Ana", date: "2026-11-16" } } });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Called Ana");
    expect(await cell({ canEdit: false })).not.toContain("Add a note");
  });

  it("a failed read says Couldn't load, for writers and readers", async () => {
    expect(await cell({ canEdit: true, cell: { state: "unavailable" } })).toContain("Couldn&#x27;t load");
    expect(await cell({ canEdit: false, cell: { state: "unavailable" } })).toContain("Couldn&#x27;t load");
  });

  it("the plain Sheet has a Notes column with the stacked label, editable only for a writer", async () => {
    expect(SHEET_COLUMNS[SHEET_COLUMNS.length - 1]).toBe("Notes");
    const { SheetView } = await import("@/components/review/SheetView");
    const params = { view: "sheet", who: "all", kind: "both", q: "", i: 1, person: null, open: null, since: "default" } as never;
    const rows = [row({ key: `matter:${M1}`, id: M1, client: "Matter Co" })];
    const notes: SheetNotes = { status: "ok", byKey: new Map([[`matter:${M1}`, { text: "Sent the draft", date: "2026-11-16" }]]) };
    const w = renderToStaticMarkup(<SheetView rows={rows} notes={notes} today={TODAY} members={[]} canWrite params={params} />);
    expect(w).toContain('data-label="Notes"');
    expect(w).toContain("Sent the draft");
    expect(w).toContain('aria-label="Note for Matter Co"');
    const r = renderToStaticMarkup(<SheetView rows={rows} notes={{ status: "unavailable" }} today={TODAY} members={[]} canWrite={false} params={params} />);
    expect(r).not.toContain('aria-label="Note for Matter Co"');
    expect(r).toContain("Couldn&#x27;t load");
  });
});
