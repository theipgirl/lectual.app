import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterNoteSaved, noteBlurOutcome, noteCellFor, noteCommitter, noteFirstLine, noteKeyIntent, pickLatestNotes, SHEET_NOTE_CLIP, type SheetNotes } from "@/lib/review/sheet-notes";
import { NOTES_PARALLEL, readSheetNotes, type NotesDb } from "@/lib/review/sheet-notes-load";
import { SHEET_COLUMNS } from "@/lib/review/sheet";
import { row, TODAY } from "./fixtures";
import { SHEET_NOTE_NOT_SAVED_YET } from "@/lib/ui/words";
import { makeWorld, seedTables } from "../files/helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));

const M1 = "00000000-0000-4000-8000-000000000001";
const L1 = "00000000-0000-4000-8000-000000000002";

/** A fake scoped client: records each query's filters and answers from `answer`. Tracks how many queries are open at once. */
function fakeDb(answer: (q: { eqs: [string, string][]; limit: number | null }) => { data: unknown[] | null; error: unknown }) {
  const calls: { table: string; select: string; eqs: [string, string][]; limit: number | null; orders: string[] }[] = [];
  let open = 0;
  let peak = 0;
  const db: NotesDb = {
    from(table: string) {
      return {
        select(select: string) {
          const c = { table, select, eqs: [] as [string, string][], limit: null as number | null, orders: [] as string[] };
          calls.push(c);
          const q = {
            eq(col: string, v: string) { c.eqs.push([col, v]); return q; },
            order(col: string) { c.orders.push(col); return q; },
            limit(n: number) { c.limit = n; return q; },
            then(res: (v: { data: unknown[] | null; error: unknown }) => unknown, rej?: (e: unknown) => unknown) {
              open += 1;
              peak = Math.max(peak, open);
              return new Promise((r) => setTimeout(r, 1)).then(() => { open -= 1; return answer(c); }).then(res as never, rej);
            },
          };
          return q as never;
        },
      };
    },
  };
  return { db, calls, peak: () => peak };
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

describe("the loader (three states, one bounded query per record)", () => {
  it("asks each record for its newest plain note only (limit 1), in bounded parallel batches", async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => ({ kind: "matter" as const, id: `m${i}` })), { kind: "lead" as const, id: L1 }, { kind: "lead" as const, id: L1 }];
    const { db, calls, peak } = fakeDb((q) => ({ data: q.eqs.some(([c, v]) => c === "matter_id" && v === "m0") ? [{ matter_id: "m0", lead_id: null, created_at: "2026-11-16T15:00:00Z", note: "Hello" }] : [], error: null }));
    const out = await readSheetNotes(db, rows, "America/New_York");
    expect(out.status).toBe("ok");
    expect(calls).toHaveLength(31); // the repeated lead is asked once
    for (const c of calls) {
      expect(c.table).toBe("crm_activity");
      expect(c.eqs).toContainEqual(["type", "note"]);
      expect(c.limit).toBe(1);
      expect(c.orders[0]).toBe("created_at");
      expect(c.select).not.toMatch(/\*/);
    }
    expect(calls.filter((c) => c.eqs.some(([col]) => col === "lead_id"))).toHaveLength(1);
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(NOTES_PARALLEL);
    if (out.status === "ok") expect(out.byKey.get("matter:m0")).toEqual({ text: "Hello", date: "2026-11-16" });
  });

  it("a read that found nothing is ok and empty; no rows asks nothing", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    const out = await readSheetNotes(db, [{ kind: "matter", id: M1 }], "UTC");
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.byKey.size).toBe(0);
    expect((await readSheetNotes(db, [], "UTC")).status).toBe("ok");
    expect(calls).toHaveLength(1);
  });

  it("any failed query is unavailable for the whole column, never 'no notes'", async () => {
    const { db } = fakeDb((q) => (q.eqs.some(([, v]) => v === "m3") ? { data: null, error: { code: "500" } } : { data: [], error: null }));
    const rows = Array.from({ length: 5 }, (_, i) => ({ kind: "matter" as const, id: `m${i}` }));
    expect(await readSheetNotes(db, rows, "UTC")).toEqual({ status: "unavailable" });
  });

  it("runs inside the review's one parallel read, only when the Sheet asks", () => {
    const src = readFileSync("src/lib/review/load.ts", "utf8");
    const settled = src.slice(src.indexOf("await Promise.allSettled([\n        readOpenTasks"));
    const block = settled.slice(0, settled.indexOf("])"));
    expect(block).toContain("readSheetNotes(");
    expect(block).toContain("opts.notes ?");
    const page = readFileSync("src/app/dashboard/review/page.tsx", "utf8");
    expect(page).toContain('loadReview(new Date(), { notes: params.view === "sheet" })');
    expect(page).not.toContain("loadSheetNotes");
  });
});

describe("loadReview with notes", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  function mockAll(notes: () => Promise<unknown>) {
    const world = makeWorld({ tables: seedTables({}) });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false), activeOrgModulesOrNull: vi.fn(async () => []) }));
    vi.doMock("@/lib/matters", () => ({ listMatters: vi.fn(async () => [{ id: M1, status: "open", lead_id: null, title: "Acme", owner_name: "Acme", matter_number: "TM-1", stage_id: null, type: "TM" }]) }));
    vi.doMock("@/lib/pipeline", () => ({ listLeads: vi.fn(async () => []), listStages: vi.fn(async () => []) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
    vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "unconfigured" })) }));
    vi.doMock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: vi.fn(async () => ({ status: "ok", byLead: {} })) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "UTC") }));
    vi.doMock("@/app/dashboard/matters/list-utils", () => ({ matterIdsNeedingReview: () => new Set() }));
    const spy = vi.fn(notes);
    vi.doMock("@/lib/review/sheet-notes-load", () => ({ readSheetNotes: spy }));
    return spy;
  }

  it("attaches the notes when asked, for the review's rows, and not otherwise", async () => {
    const spy = mockAll(async () => ({ status: "ok", byKey: new Map([[`matter:${M1}`, { text: "Hi", date: "2026-11-16" }]]) }));
    const { loadReview } = await import("../../src/lib/review/load");
    const r = await loadReview(new Date("2026-11-17T15:00:00Z"), { notes: true });
    if (r.status !== "ok") return expect.unreachable();
    expect(r.notes?.status).toBe("ok");
    expect((spy.mock.calls[0] as unknown[])[1]).toEqual([{ kind: "matter", id: M1 }]);
    const plain = await loadReview(new Date("2026-11-17T15:00:00Z"));
    expect(plain.status === "ok" && plain.notes).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a notes read that rejects is unavailable", async () => {
    mockAll(async () => { throw new Error("x"); });
    const { loadReview } = await import("../../src/lib/review/load");
    const r = await loadReview(new Date("2026-11-17T15:00:00Z"), { notes: true });
    expect(r.status === "ok" && r.notes).toEqual({ status: "unavailable" });
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

  // Changed on purpose (Taylor, Nov 2026): a note saves on Enter ONLY; leaving the cell never posts.
  it("Enter, then a second Enter while it saves, then the blur: one post", async () => {
    let release: (v: { ok: boolean }) => void = () => {};
    const save = vi.fn(() => new Promise<{ ok: boolean }>((r) => (release = r)));
    const c = noteCommitter(save);
    const enter = c.commit("Called Ana");
    const again = c.commit("Called Ana");
    expect(noteBlurOutcome("Called Ana", c.busy)).toBe("none");
    release({ ok: true });
    expect(await enter).toBe("saved");
    expect(await again).toBe("ignored");
    expect(await c.commit("Called Ana")).toBe("ignored");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Called Ana");
  });

  it("leaving the cell never saves: text stays with 'Not saved yet', an empty field closes", () => {
    expect(noteBlurOutcome("  Left a message ", false)).toBe("unsaved");
    expect(noteBlurOutcome("   ", false)).toBe("close");
    expect(noteBlurOutcome("", false)).toBe("close");
    expect(SHEET_NOTE_NOT_SAVED_YET).toBe("Not saved yet. Press Enter to save.");
  });

  it("Enter saves the trimmed text", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const c = noteCommitter(save);
    expect(await c.commit("  Left a message  ")).toBe("saved");
    expect(save).toHaveBeenCalledWith("Left a message");
  });

  it("Esc posts nothing, and nothing after it posts", async () => {
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

  it("after a failed save the text stays and the next Enter tries again (leaving the cell posts nothing)", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, message: "timed out" }).mockResolvedValueOnce({ ok: true });
    const c = noteCommitter(save);
    expect(await c.commit("Called Ana")).toBe("failed");
    expect(c.ended).toBe(false);
    expect(noteBlurOutcome("Called Ana", c.busy)).toBe("unsaved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(await c.commit("Called Ana")).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("text typed while the save was in flight is kept after it succeeds", () => {
    expect(afterNoteSaved("Called Ana", "  Called Ana ")).toEqual({ keep: null });
    expect(afterNoteSaved("Called Ana", "Called Ana\nand she wants a call back")).toEqual({ keep: "Called Ana\nand she wants a call back" });
    expect(afterNoteSaved("Called Ana", "")).toEqual({ keep: "" });
  });

  it("a save that throws counts as failed", async () => {
    const c = noteCommitter(async () => {
      throw new Error("x");
    });
    expect(await c.commit("a")).toBe("failed");
  });

  it("the component clears the typed text only after a save that worked with nothing new typed, or on Esc", () => {
    const src = readFileSync("src/components/review/NotesCell.tsx", "utf8");
    const ok = src.indexOf("if (ok) {");
    const keep = src.indexOf("afterNoteSaved(body, draftRef.current)");
    const clears = [...src.matchAll(/setDraftText\(""\)/g)].map((m) => m.index!);
    expect(ok).toBeGreaterThan(0);
    expect(keep).toBeGreaterThan(ok);
    expect(clears).toHaveLength(2);
    expect(clears[0]).toBeGreaterThan(keep);
    expect(src.slice(src.indexOf("function cancel()"), src.indexOf("function cancel()") + 200)).toContain('setDraftText("")');
    // Enter commits; leaving the cell only runs the blur rule, which never posts.
    expect(src).toContain("onBlur={leave}");
    expect(src.slice(src.indexOf("function leave()"), src.indexOf("function leave()") + 500)).not.toContain("commit(");
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
