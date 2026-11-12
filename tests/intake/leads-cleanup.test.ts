import { describe, it, expect } from "vitest";
import { classifyLeads, type WorkingFacts, type FactSet } from "@/lib/intake/working";
import { allOpenData, drawnSet, inSet, rowsInSet, setChips, setDataFrom } from "@/lib/intake/sets";
import { BOARD_COLUMN_CAP, SHOW_MAX, SHOW_STEP, capColumn, nextShow, pageSlice, parseShow } from "@/lib/intake/paging";
import { hiddenSelectedCount, movableIds, selectShown, selectionKey } from "@/lib/intake/selection";
import { boardModel, emptyStagesLabel, moveTargetStages, ownerDrop, splitStageColumns, stageDrop } from "@/lib/intake/board-columns";
import { temperaturePill } from "@/lib/intake/temperature-pill";
import { chipCountsWithin, leadsHeaderLine, needsStageTitle, ownerColumnShown, showTimeChip } from "@/lib/intake/leads-view";
import { latestNotes, loadLatestNotes, notesIncomplete, NOTE_ID_CHUNK, NOTE_MAX_PAGES, NOTE_PAGE, type NotesDb } from "@/lib/intake/notes-read";
import { readLostCount } from "@/lib/intake/lost";
import { LEAD_ID_CHUNK } from "@/lib/time/entries";
import { buildIntakeRows, sortRows, type IntakeRow } from "@/lib/intake/rows";
import { REFERRAL_SOURCES } from "@/lib/intake";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";

const NOW = new Date("2026-11-10T14:30:00Z");
const stage = (id: string, name: string, order: number, category = "open") => ({ id, org_id: "o", name, order_index: order, category, aging_threshold_days: null }) as unknown as Stage;
const STAGES = [stage("fu", "Follow-Up", 1), stage("pnc", "Potential New Client", 2), stage("cs", "Consultation Scheduled", 3), stage("ph", "Post Consultation Email Sent", 4), stage("nur", "Long-Term Nurture", 5, "nurture"), stage("won", "Signed", 6, "won"), stage("lost", "Lost", 7, "lost")];

const lead = (id: string, st: string, over: Record<string, unknown> = {}) =>
  ({ id, org_id: "o", first_name: id, last_name: "T", email: `${id}@x.test`, current_stage_id: st, stage_entered_at: NOW.toISOString(), assigned_to: null, lane: null, ai_summary: null, last_activity_at: null, last_outbound_at: null, last_inbound_at: null, referral_source: null, ...over }) as unknown as Lead;
const ok = (...ids: string[]): FactSet => ({ status: "ok", leadIds: new Set(ids) });
const facts = (over: Partial<WorkingFacts> = {}): WorkingFacts => ({ activity: ok(), approvals: ok(), proposals: ok(), consults: ok(), booth: ok(), ...over });
const category = (id: string | null) => STAGES.find((s) => s.id === id)?.category ?? null;
const rowsOf = (leads: Lead[]) => buildIntakeRows({ leads, stages: STAGES, members: [], now: NOW });

const LEADS = [lead("w", "cs"), lead("a", "pnc"), lead("e", "pnc", { referral_source: "UGW" }), lead("n", "fu"), lead("nur", "nur")];
const data = setDataFrom(classifyLeads({ leads: LEADS, stages: STAGES, facts: facts({ activity: ok("a") }) }), LEADS, category);

describe("sets: membership and the chips", () => {
  it("each lead is in exactly the sets its bucket says; Lost is never a member (its own read)", () => {
    const sets = (id: string) => (["working", "event", "not-started", "open", "nurture", "lost"] as const).filter((s) => inSet(data, id, s));
    expect(sets("w")).toEqual(["working", "open"]);
    expect(sets("a")).toEqual(["working", "open"]);
    expect(sets("e")).toEqual(["event", "open"]);
    expect(sets("n")).toEqual(["not-started", "open"]);
    expect(sets("nur")).toEqual(["nurture"]);
  });

  it("the chip counts are what each set lists (workingShown for Working) and a zero chip is hidden unless chosen", () => {
    expect(data.counts).toEqual({ working: 2, event: 1, notStarted: 1, open: 4, nurture: 1 });
    const labels = (chosen: Parameters<typeof setChips>[2], d = data) => setChips(d, { status: "none" }, chosen).map((c) => `${c.label}${c.count === null ? "" : ` ${c.count}`}`);
    expect(labels("working")).toEqual(["Working 2", "Event contacts 1", "Not started 1", "All open 4", "Nurture 1"]);
    const none = setDataFrom(classifyLeads({ leads: [lead("x", "pnc")], stages: STAGES, facts: facts() }), [lead("x", "pnc")], category);
    expect(labels("working", none)).toEqual(["Working 0", "Not started 1", "All open 1"]);
    expect(labels("event", none)).toContain("Event contacts 0");
  });

  it("Lost: counted when read, shown WITHOUT a number when its read failed, hidden with none or when there is no lost stage", () => {
    const chip = (lost: Parameters<typeof setChips>[1]) => setChips(data, lost, "working").find((c) => c.set === "lost");
    expect(chip({ status: "ok", count: 12 })).toMatchObject({ count: 12 });
    expect(chip({ status: "unavailable" })).toMatchObject({ count: null });
    expect(chip({ status: "ok", count: 0 })).toBeUndefined();
    expect(chip({ status: "none" })).toBeUndefined();
  });

  it("with the Working rule unavailable the page draws All open and offers no Working-derived chip", () => {
    const down = setDataFrom(classifyLeads({ leads: LEADS, stages: STAGES, facts: facts({ activity: { status: "unavailable" } }) }), LEADS, category);
    expect(down.status).toBe("unavailable");
    expect(drawnSet(down, "working")).toBe("open");
    expect(drawnSet(down, "nurture")).toBe("nurture");
    expect(drawnSet(down, "lost")).toBe("lost");
    const rows = rowsOf(LEADS);
    expect(rowsInSet(rows, down, "open").map((r) => r.lead.id).sort()).toEqual(["a", "e", "n", "w"]);
    expect(setChips(down, { status: "none" }, "open").map((c) => c.set)).toEqual(["open", "nurture"]);
  });

  it("an uncertain lead (a source down) is listed by Working and counted in its chip", () => {
    const d = setDataFrom(classifyLeads({ leads: LEADS, stages: STAGES, facts: facts({ activity: ok("a"), consults: { status: "unavailable" } }) }), LEADS, category);
    expect(d.counts.working).toBe(4);
    expect(rowsInSet(rowsOf(LEADS), d, "working")).toHaveLength(4);
    expect(d.degraded).toEqual(["consults"]);
  });

  it("allOpenData (a caller with no set data) shows every lead as open or nurture", () => {
    const d = allOpenData(rowsOf(LEADS), STAGES);
    expect(d.status).toBe("unavailable");
    expect(d.counts).toMatchObject({ open: 4, nurture: 1 });
  });

  it("counts within the chosen set: the secondary chips count only that set's rows", () => {
    const rows = rowsOf(LEADS);
    const flag = { lawmaticsStage: "X", hired: false, stageId: "pnc" };
    rows.find((r) => r.lead.id === "a")!.decision = flag;
    rows.find((r) => r.lead.id === "n")!.decision = { ...flag, stageId: "fu" };
    const reads = { approvals: { status: "ok", byLead: { a: [{ headline: "h" }], w: [{ headline: "h" }] } } as never, decisionsRead: true, agentRead: false };
    const working = chipCountsWithin(rowsInSet(rows, data, "working"), reads);
    const open = chipCountsWithin(rowsInSet(rows, data, "open"), reads);
    expect(working).toMatchObject({ decision: 1, needsAttorney: 2, agent: null });
    expect(open).toMatchObject({ decision: 2, needsAttorney: 2 });
    expect(chipCountsWithin(rows, { ...reads, decisionsRead: false, approvals: { status: "unavailable" } })).toMatchObject({ decision: null, needsAttorney: null });
  });
});

describe("paging", () => {
  it("?show= is a whole number of steps, at least one, at most the maximum", () => {
    expect(parseShow(undefined)).toBe(25);
    expect(parseShow("26")).toBe(50);
    expect(parseShow("100")).toBe(100);
    expect(parseShow("0")).toBe(25);
    expect(parseShow("nope")).toBe(25);
    expect(parseShow("999999")).toBe(SHOW_MAX);
    expect(nextShow(25)).toBe(50);
    expect(nextShow(SHOW_MAX)).toBe(SHOW_MAX);
  });

  it("sorts BEFORE it slices, and every count is over the whole filtered set", () => {
    const leads = Array.from({ length: 60 }, (_, i) => lead(`l${String(i).padStart(2, "0")}`, "pnc", { first_name: `N${String(60 - i).padStart(2, "0")}` }));
    const sorted = sortRows(rowsOf(leads), "lead", "asc");
    const page = pageSlice(sorted, 25);
    expect(page.shown.map((r) => r.lead.first_name)).toEqual(Array.from({ length: 25 }, (_, i) => `N${String(i + 1).padStart(2, "0")}`));
    expect(page.total).toBe(60);
    expect(page.left).toBe(35);
    expect(pageSlice(sorted, 75)).toMatchObject({ total: 60, left: 0 });
  });

  it("a board column draws the cap and counts what is left; pinned cards come first and never count against it", () => {
    const rows = rowsOf(Array.from({ length: 20 }, (_, i) => lead(`c${i}`, "pnc")));
    expect(capColumn(rows, BOARD_COLUMN_CAP)).toMatchObject({ left: 5 });
    expect(capColumn(rows, BOARD_COLUMN_CAP).shown).toHaveLength(15);
    const pinned = capColumn(rows, BOARD_COLUMN_CAP, ["c19", "c18"]);
    expect(pinned.shown.slice(0, 2).map((r) => r.lead.id)).toEqual(["c19", "c18"]);
    expect(pinned.shown).toHaveLength(17);
    expect(pinned.left).toBe(3);
    expect(capColumn(rows, BOARD_COLUMN_CAP, ["not-here"]).shown).toHaveLength(15);
  });
});

describe("bulk selection uses only what is rendered", () => {
  const rendered = ["a", "b", "c"];
  it("sends the ticked ids that are on screen, in screen order; counts the hidden ones", () => {
    const selected = new Set(["c", "z", "a"]);
    expect(movableIds(selected, rendered)).toEqual(["a", "c"]);
    expect(hiddenSelectedCount(selected, rendered)).toBe(1);
    expect(movableIds(new Set(["z"]), rendered)).toEqual([]);
  });
  it("'Select the N shown' is the rendered ids, at most 200", () => {
    expect(selectShown(rendered)).toEqual(rendered);
    expect(selectShown(Array.from({ length: 500 }, (_, i) => String(i)))).toHaveLength(200);
  });
  it("any change of set, filters, page, view or grouping is a different key", () => {
    const base = { set: "working", query: "", show: 25, view: "board", group: "stage" };
    expect(selectionKey(base)).toBe(selectionKey({ ...base }));
    for (const change of [{ set: "open" }, { query: "q=a" }, { show: 50 }, { view: "table" }, { group: "owner" }]) expect(selectionKey({ ...base, ...change })).not.toBe(selectionKey(base));
  });
  it("the board model's rendered ids are exactly the cards drawn (the cap hides the rest)", () => {
    const rows = rowsOf(Array.from({ length: 20 }, (_, i) => lead(`c${i}`, "pnc")));
    const m = boardModel({ rows, stages: STAGES.filter((s) => s.category === "open"), members: [], group: "stage", pinned: [], extra: {}, showEmpty: false });
    expect(m.renderedIds).toHaveLength(15);
    expect(movableIds(new Set(rows.map((r) => r.lead.id)), m.renderedIds)).toHaveLength(15);
    const more = boardModel({ rows, stages: STAGES.filter((s) => s.category === "open"), members: [], group: "stage", pinned: [], extra: { pnc: 15 }, showEmpty: false });
    expect(more.renderedIds).toHaveLength(20);
  });
});

describe("board columns", () => {
  const open = STAGES.filter((s) => s.category === "open");
  it("only stages that hold a lead are columns; the rest are named once and can be shown", () => {
    const rows = rowsOf([lead("a", "pnc"), lead("b", "cs")]);
    const m = boardModel({ rows, stages: open, members: [], group: "stage", pinned: [], extra: {}, showEmpty: false });
    expect(m.columns.map((c) => c.label)).toEqual(["Potential New Client", "Consultation Scheduled"]);
    expect(m.empty.map((e) => e.label)).toEqual(["Follow-Up", "Post Consultation Email Sent"]);
    expect(emptyStagesLabel(2, false)).toBe("2 empty stages · Show");
    expect(emptyStagesLabel(1, true)).toBe("1 empty stage · Hide");
    const shown = boardModel({ rows, stages: open, members: [], group: "stage", pinned: [], extra: {}, showEmpty: true });
    expect(shown.columns.map((c) => c.label)).toEqual(["Follow-Up", "Potential New Client", "Consultation Scheduled", "Post Consultation Email Sent"]);
    expect(shown.empty).toEqual([]);
  });
  it("a card moved in this session sits in its new stage, so that column exists and the card is pinned", () => {
    const rows = rowsOf([lead("a", "pnc"), lead("b", "pnc")]);
    rows[0] = { ...rows[0], lead: { ...rows[0].lead, current_stage_id: "ph" } } as IntakeRow;
    const m = boardModel({ rows, stages: open, members: [], group: "stage", pinned: ["a"], extra: {}, showEmpty: false });
    expect(m.columns.find((c) => c.key === "ph")!.shown.map((r) => r.lead.id)).toEqual(["a"]);
    expect(splitStageColumns(rows, open).populated).toHaveLength(2);
  });
  it("the owner board has Unassigned first, then every member, each a drop target", () => {
    const members = [{ userId: "u1", displayName: "Dana Roe", email: "d@x.test" } as MemberIdentity];
    const m = boardModel({ rows: rowsOf([lead("a", "pnc", { assigned_to: "u1" }), lead("b", "pnc", { assigned_to: "ghost" })]), stages: open, members, group: "owner", pinned: [], extra: {}, showEmpty: false });
    expect(m.columns.map((c) => c.key)).toEqual(["unassigned", "u1", "ghost"]);
    expect(m.columns[2].drop).toEqual({ kind: "owner", key: "ghost", stray: true });
  });
  it("the drop rules: same column does nothing; an unknown teammate is refused; Unassigned unassigns", () => {
    expect(stageDrop("pnc", { current_stage_id: "pnc" })).toBe("noop");
    expect(stageDrop("cs", { current_stage_id: "pnc" })).toBe("move");
    expect(ownerDrop({ key: "u1", stray: false }, { assigned_to: "u1" })).toBe("noop");
    expect(ownerDrop({ key: "u1", stray: false }, { assigned_to: null })).toBe("assign");
    expect(ownerDrop({ key: null, stray: false }, { assigned_to: "u1" })).toBe("assign");
    expect(ownerDrop({ key: null, stray: false }, { assigned_to: null })).toBe("noop");
    expect(ownerDrop({ key: "ghost", stray: true }, { assigned_to: null })).toBe("refuse");
  });
});

describe("the temperature pill", () => {
  const t = (value: "hot" | "warm" | "cold" | null, source: "person" | "suggested") => ({ value, source, reason: "why" });
  it("a person's level is the filled pill; a suggestion is the same pill marked suggested; no level is nothing", () => {
    expect(temperaturePill(t("hot", "person"))).toMatchObject({ text: "Hot", tone: "hot", suggested: false, ariaLabel: "Hot", title: "why" });
    expect(temperaturePill(t("warm", "suggested"))).toMatchObject({ text: "Warm", tone: "warm", suggested: true, ariaLabel: "Warm, suggested" });
    expect(temperaturePill(t("warm", "suggested"))!.title).toBe("Suggested: Warm\nwhy");
    expect(temperaturePill(t(null, "suggested"))).toBeNull();
  });
});

describe("how the page draws itself", () => {
  const row = (assigned: boolean, replied = false) => ({ lead: { assigned_to: assigned ? "u" : null }, reply: replied ? "replied" : "unknown" }) as unknown as IntakeRow;
  it("the owner column exists only when someone in view has an owner", () => {
    expect(ownerColumnShown([row(false), row(false)])).toBe(false);
    expect(ownerColumnShown([row(false), row(true)])).toBe(true);
    expect(ownerColumnShown([])).toBe(false);
  });
  it("the header line: counts, and one owners note (Nobody is assigned yet / N unassigned / nothing)", () => {
    expect(leadsHeaderLine("working", [row(false, true), row(false)])).toBe("2 working leads · 1 need a first reply · Nobody is assigned yet");
    expect(leadsHeaderLine("event", [row(true), row(false)])).toBe("2 event contacts · 0 need a first reply · 1 unassigned");
    expect(leadsHeaderLine("not-started", [row(true)])).toBe("1 lead not started · 0 need a first reply");
    expect(leadsHeaderLine("nurture", [])).toBe("0 leads in nurture · 0 need a first reply");
  });
  it("the time chip shows only with time this week or a running timer on this lead", () => {
    expect(showTimeChip(undefined, null, "a")).toBe(false);
    expect(showTimeChip({ seconds: 0 } as never, null, "a")).toBe(false);
    expect(showTimeChip({ seconds: 600 } as never, null, "a")).toBe(true);
    expect(showTimeChip(undefined, { leadId: "a" } as never, "a")).toBe(true);
    expect(showTimeChip(undefined, { leadId: "b" } as never, "a")).toBe(false);
  });
  it("the Needs a stage marker's title carries the Lawmatics stage, read only", () => {
    expect(needsStageTitle({ lawmaticsStage: "Proposal Sent", hired: false })).toContain("Proposal Sent");
    expect(needsStageTitle({ lawmaticsStage: null, hired: true })).toContain("Hired");
  });
});

describe("reads", () => {
  it("'Assessment' is a referral source", () => {
    expect(REFERRAL_SOURCES).toContain("Assessment");
  });

  it("time entries are read in chunks of at most 80 lead ids (300+ in one .in() was a URL too long: every row showed a dash)", () => {
    expect(LEAD_ID_CHUNK).toBeLessThanOrEqual(80);
  });

  it("the notes read is scoped to the listed leads in chunks, asks only for note-carrying types, pages, and reports a cut-short chunk", async () => {
    const calls: Array<{ ids: readonly string[]; types: readonly string[]; range: [number, number] }> = [];
    const db = (pages: (ids: readonly string[], page: number) => Array<Record<string, unknown>>, error = false): NotesDb =>
      ({
        from: () => ({
          select: () => ({
            in: (_c: string, ids: readonly string[]) => ({
              in: (_t: string, types: readonly string[]) => ({
                gte: () => ({
                  order: () => ({
                    order: () => ({
                      range: (a: number, b: number) => {
                        calls.push({ ids, types, range: [a, b] });
                        return Promise.resolve({ data: error ? null : pages(ids, a / NOTE_PAGE), error: error ? {} : null });
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }) as never;
    const ids = Array.from({ length: 250 }, (_, i) => `l${i}`);
    const full = (id: string) => Array.from({ length: NOTE_PAGE }, () => ({ lead_id: id, type: "note", payload: { note: "n" } }));
    const r = await loadLatestNotes("2026-01-01", ids, db((chunk, page) => (page === 0 ? full(chunk[0]) : [{ lead_id: "late", type: "note", payload: { summary: "s" } }])));
    expect(r).toMatchObject({ status: "ok", truncated: false });
    expect(r.status === "ok" && r.byLead.late).toBe("s");
    expect(calls[0].types).toEqual(["note", "call_logged", "email_sent", "voice_note"]);
    expect(calls.map((c) => c.ids.length).filter((n, i, a) => a.indexOf(n) === i).sort((x, y) => y - x)).toEqual([100, 50]);
    expect(calls.every((c) => c.ids.length <= NOTE_ID_CHUNK)).toBe(true);
    calls.length = 0;
    // A chunk that never ends is truncated: reported, and the page then says "Note couldn't load" instead of "No activity yet".
    const endless = await loadLatestNotes("2026-01-01", ["a"], db((chunk) => full(chunk[0])));
    expect(endless).toMatchObject({ status: "ok", truncated: true });
    expect(notesIncomplete(endless)).toBe(true);
    expect(calls).toHaveLength(NOTE_MAX_PAGES);
    expect(await loadLatestNotes("2026-01-01", ["a"], db(() => [], true))).toEqual({ status: "unavailable" });
    expect(notesIncomplete({ status: "unavailable" })).toBe(true);
    expect(notesIncomplete({ status: "ok", byLead: {}, truncated: false })).toBe(false);
    expect(await loadLatestNotes("2026-01-01", [], db(() => []))).toEqual({ status: "ok", byLead: {}, truncated: false });
    expect(latestNotes([{ lead_id: "a", type: "note", payload: { note: " new " } }, { lead_id: "a", type: "note", payload: { note: "old" } }])).toEqual({ a: "new" });
  });

  it("the page asks the notes read only about the leads it shows and the row says so when it was cut short", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/dashboard/intake/page.tsx", "utf8");
    expect(page).toContain("loadLatestNotes(sinceIso, leads.map");
    expect(page).toContain("notesUnavailable={notesIncomplete(notes)}");
  });

  it("an unreadable module list makes consults unavailable (never skipped); a readable list without Mailboxes is skipped", async () => {
    const { loadWorkingFacts } = await import("@/lib/intake/working-load");
    const db = { from: () => ({ select: () => ({ in: () => ({ or: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }), not: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }), eq: () => ({ not: () => ({ gte: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }) }) }) } as never;
    const base = { leadIds: ["a"], approvals: { status: "ok", byLead: {} } as never };
    const deps = { db, now: NOW, readProposals: async () => [] };
    expect((await loadWorkingFacts({ ...base, mailboxOn: false, mailboxUnknown: true }, deps)).consults).toEqual({ status: "unavailable" });
    expect((await loadWorkingFacts({ ...base, mailboxOn: false }, deps)).consults).toEqual({ status: "skipped" });
    expect((await loadWorkingFacts({ ...base, mailboxOn: true }, deps)).consults).toEqual({ status: "ok", leadIds: new Set() });
  });

  it("lost stages are a move destination only while the Lost set is shown, and never a won stage", () => {
    const intake = STAGES.filter((s) => s.category === "open" || s.category === "nurture");
    const lostStages = STAGES.filter((s) => s.category === "lost");
    expect(moveTargetStages(intake, lostStages, false).map((s) => s.id)).not.toContain("lost");
    expect(moveTargetStages(intake, lostStages, true).map((s) => s.id)).toContain("lost");
    expect(moveTargetStages([...intake, STAGES.find((s) => s.id === "won")!], lostStages, true).map((s) => s.id)).not.toContain("won");
  });

  it("the URL keeps the set the person chose while the All-open fallback is drawn", async () => {
    const { readFileSync } = await import("node:fs");
    const ws = readFileSync("src/app/dashboard/intake/_components/IntakeWorkspace.tsx", "utf8");
    expect(ws).not.toContain("{ ...viewState, set: drawn }");
    const { intakeHref, DEFAULT_VIEW_STATE, EMPTY_INTAKE_FILTERS } = await import("@/lib/intake/rows");
    expect(intakeHref(EMPTY_INTAKE_FILTERS, { ...DEFAULT_VIEW_STATE, set: "event" })).toBe("/dashboard/intake/?set=event");
  });

  it("the time chip keeps its em dash on every row when the time read failed", () => {
    expect(showTimeChip(undefined, null, "a", true)).toBe(true);
    expect(showTimeChip(undefined, null, "a", false)).toBe(false);
  });

  it("the lost count is none without a lost stage and never reads one", async () => {
    expect(await readLostCount(STAGES.filter((s) => s.category !== "lost"))).toEqual({ status: "none" });
  });
});

describe("what the rail and the Pipeline share is untouched", () => {
  it("the intake scope and the practice-area filter are the same files with no lost stage in them", async () => {
    const { intakeStages } = await import("@/lib/intake/scope");
    expect(intakeStages(STAGES).map((s) => s.id)).toEqual(["fu", "pnc", "cs", "ph", "nur"]);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/intake/scope.ts", "utf8")).not.toContain("lost");
    expect(readFileSync("src/lib/intake/counts.ts", "utf8")).not.toContain("lost");
    expect(SHOW_STEP).toBe(25);
  });
});

describe("chip strips, header and menus (review fixes)", () => {
  it("a popover wrapper inside a no-wrap chip strip does not shrink (it made chips draw over each other)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/list-page/list-page.css", "utf8")).toMatch(/\.lp-chips > \.lp-pop[^{]*\{ flex: 0 0 auto; \}/);
    expect(readFileSync("src/app/dashboard/intake/leads.css", "utf8")).toContain(".ix-sets > *, .ix-filters > * { flex: 0 0 auto; }");
  });
  it("the grouping reads By stage / By owner so 'Stage' is not said twice side by side; the row menu is named for its lead", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/dashboard/intake/_components/IntakeControls.tsx", "utf8");
    expect(src).toContain("By stage");
    expect(src).toContain("By owner");
    const { LEADS_ROW_MENU } = await import("@/lib/ui/words");
    expect(LEADS_ROW_MENU("Ana Ruiz")).toBe("Actions for Ana Ruiz");
  });
});
