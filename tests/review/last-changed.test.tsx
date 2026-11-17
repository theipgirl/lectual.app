import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LEAD, MATTER, OTHER_LEAD, OTHER_ORG, ORG, makeWorld, seedTables } from "../files/helpers";
import { actorOf, changeWindowStart, firstNameOf, lastChangeFor, lastChangedText, pickLastChanges, withoutPeople, CHANGE_SELECT, type ChangeRowIn, type LastChange } from "@/lib/review/last-changed";
import { row } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const TZ = "America/New_York";
const NOW = new Date("2026-11-17T15:00:00Z");
const names = new Map([["u-cait", "Caitlyn Ross"], ["u-mail", "rayn@firm.example"]]);
const members = [{ userId: "u-cait", name: "Caitlyn Ross" }];

const change = (over: Partial<ChangeRowIn> & { type: string }): ChangeRowIn => ({
  lead_id: null,
  matter_id: MATTER,
  actor_type: "user",
  actor_id: "u-cait",
  created_at: "2026-11-16T15:00:00Z",
  actor: null,
  source: null,
  ...over,
});
const lastOf = (rows: ChangeRowIn[]): LastChange | null => pickLastChanges(rows, TZ, NOW).get(`matter:${MATTER}`) ?? null;
const text = (c: LastChange | null | undefined) => lastChangedText(c, names, "2026-11-17");

describe("who changed it (acceptance 1 and 2)", () => {
  it("a person's stage move reads Changed by <first name> and the firm-zone date", () => {
    expect(text(lastOf([change({ type: "stage_changed" })]))).toBe("Changed by Caitlyn · Nov 16");
  });

  it("a Stage Keeper move reads as an automatic change (the glossary never names the agent)", () => {
    const c = lastOf([change({ type: "stage_changed", actor_type: "ai", actor_id: null, actor: "agent:stage-keeper" })]);
    expect(text(c)).toBe("Changed automatically · Nov 16");
  });

  it("a hired-matter sync move reads Changed by Lawmatics sync (stamp on actor or on source)", () => {
    expect(text(lastOf([change({ type: "stage_changed", actor_type: "system", actor_id: null, actor: "lawmatics-sync" })]))).toBe("Changed by Lawmatics sync · Nov 16");
    expect(text(lastOf([change({ type: "matter_opened", actor_type: "system", actor_id: null, source: "lawmatics-sync" })]))).toBe("Changed by Lawmatics sync · Nov 16");
  });

  it("an import with no later change reads Not changed since import; a later change replaces it", () => {
    const imp = change({ type: "lead_created", actor_type: "system", actor_id: null, source: "lawmatics_import", created_at: "2026-11-01T15:00:00Z" });
    expect(text(lastOf([imp]))).toBe("Not changed since import");
    expect(text(lastOf([imp, change({ type: "note", created_at: "2026-11-10T15:00:00Z" })]))).toBe("Changed by Caitlyn · Nov 10");
  });

  it("a record with a read that worked and no change row says so, never 'not changed'", () => {
    expect(lastOf([])).toBeNull();
    expect(text(null)).toBe("No changes in the last year");
  });

  it("other actors are named in words, and a system row is never credited to Lectual", () => {
    expect(text(lastOf([change({ type: "note", actor_type: "automation", actor_id: null })]))).toBe("Changed by an automation · Nov 16");
    expect(text(lastOf([change({ type: "note", actor_type: "ai", actor_id: null })]))).toBe("Changed by an assistant · Nov 16");
    expect(text(lastOf([change({ type: "note", actor_type: "system", actor_id: null })]))).toBe("Updated automatically · Nov 16");
    expect(text(lastOf([change({ type: "note", actor_type: "system", actor_id: null })]))).not.toContain("Lectual");
  });

  it("system rows are named by payload.source: a form, a signing; an unknown source stays generic", () => {
    const sys = { actor_type: "system", actor_id: null };
    expect(text(lastOf([change({ type: "lead_created", ...sys, source: "Intake form" })]))).toBe("Came in through a form · Nov 16");
    expect(text(lastOf([change({ type: "matter_opened", ...sys, source: "quote_accepted" })]))).toBe("Opened when the client signed · Nov 16");
    expect(text(lastOf([change({ type: "matter_opened", ...sys, source: "something_else" })]))).toBe("Updated automatically · Nov 16");
    // the same source on the wrong type, or from a person, is not given the special reading
    expect(text(lastOf([change({ type: "note", ...sys, source: "Intake form" })]))).toBe("Updated automatically · Nov 16");
    expect(text(lastOf([change({ type: "lead_created", source: "Intake form" })]))).toBe("Changed by Caitlyn · Nov 16");
    // sheet and other imports write no row, so they are not an actor here
    expect(actorOf({ type: "lead_created", actor_type: "system", actor_id: null, source: "sheet_import" })).toEqual({ kind: "system" });
  });

  it("a person the directory does not know is a teammate; an email is never used as a name; an unreadable directory draws no line", () => {
    expect(text(lastOf([change({ type: "note", actor_id: "u-gone" })]))).toBe("Changed by a teammate · Nov 16");
    expect(text(lastOf([change({ type: "note", actor_id: "u-mail" })]))).toBe("Changed by a teammate · Nov 16");
    expect(lastChangedText(lastOf([change({ type: "note" })]), null, "2026-11-17")).toBeNull();
    // a non-person actor needs no name, so it still draws
    expect(lastChangedText(lastOf([change({ type: "stage_changed", actor_type: "system", actor_id: null, actor: "lawmatics-sync" })]), null, "2026-11-17")).toBe("Changed by Lawmatics sync · Nov 16");
    expect(withoutPeople(lastOf([change({ type: "note" })]))).toBeUndefined();
    expect(firstNameOf("rayn@firm.example")).toBeNull();
    expect(firstNameOf("  Caitlyn  Ross ")).toBe("Caitlyn");
  });

  it("an unreadable read (undefined) draws no line at all", () => {
    expect(text(undefined)).toBeNull();
  });
});

describe("picking the newest change", () => {
  it("takes the newest change row per record and ignores types that are not changes", () => {
    const rows = [
      change({ type: "stage_changed", created_at: "2026-11-10T15:00:00Z" }),
      change({ type: "note", created_at: "2026-11-14T15:00:00Z", actor_id: "u-mail" }),
      change({ type: "email_received", created_at: "2026-11-16T15:00:00Z" }),
      change({ type: "quote_payment", created_at: "2026-11-16T16:00:00Z" }),
    ];
    const c = lastOf(rows)!;
    expect(c.date).toBe("2026-11-14");
    expect(c.actor).toEqual({ kind: "person", userId: "u-mail" });
  });

  it("dates in the firm's zone, ignores a future row, and keeps leads and matters apart", () => {
    const late = change({ type: "note", created_at: "2026-11-17T04:30:00Z" }); // 11:30 PM on Nov 16 in New York
    expect(lastOf([late])!.date).toBe("2026-11-16");
    expect(lastOf([change({ type: "note", created_at: "2026-11-20T00:00:00Z" })])).toBeNull();
    const both = pickLastChanges([late, change({ type: "note", matter_id: null, lead_id: LEAD })], TZ, NOW);
    expect([...both.keys()].sort()).toEqual([`lead:${LEAD}`, `matter:${MATTER}`].sort());
  });

  it("keeps only a date and an actor: no payload value, note text or address can ride along", () => {
    const c = lastOf([change({ type: "note", actor: "someone@firm.example", source: "x@y.co" })])!;
    expect(Object.keys(c).sort()).toEqual(["actor", "at", "date"]);
    expect(JSON.stringify(c)).not.toContain("@");
    expect(text(c)).not.toContain("@");
    expect(actorOf({ type: "note", actor_type: "user", actor_id: "u", actor: "someone@firm.example", source: null })).toEqual({ kind: "person", userId: "u" });
    expect(CHANGE_SELECT).not.toMatch(/payload(?!->>(actor|source))/);
  });
});

describe("rows with both ids, and a matter's lead (item 4)", () => {
  it("a row carrying both lead_id and matter_id counts under both", () => {
    const m = pickLastChanges([change({ type: "stage_changed", lead_id: LEAD })], TZ, NOW);
    expect([...m.keys()].sort()).toEqual([`lead:${LEAD}`, `matter:${MATTER}`].sort());
  });

  it("a matter also takes changes filed on its lead; the newer wins; a lead-less matter is unchanged", () => {
    const m = pickLastChanges([
      change({ type: "note", matter_id: MATTER, created_at: "2026-11-10T15:00:00Z" }),
      change({ type: "note", matter_id: null, lead_id: LEAD, created_at: "2026-11-14T15:00:00Z" }),
    ], TZ, NOW);
    expect(lastChangeFor(m, "matter", MATTER, LEAD)!.date).toBe("2026-11-14");
    expect(lastChangeFor(m, "matter", MATTER, null)!.date).toBe("2026-11-10");
    expect(lastChangeFor(m, "matter", "other", LEAD)!.date).toBe("2026-11-14");
    expect(lastChangeFor(m, "lead", LEAD)!.date).toBe("2026-11-14");
    expect(lastChangeFor(new Map(), "matter", MATTER, LEAD)).toBeNull();
  });
});

describe("the 12-month window (item 3)", () => {
  it("starts twelve months before now", () => {
    expect(changeWindowStart(NOW)).toBe("2025-11-17T15:00:00.000Z");
  });
});

describe("the line on a card, a sheet row and the panel (acceptance 4)", () => {
  const withChange = row({ key: "m-1", lastChange: { date: "2026-11-16", at: 0, actor: { kind: "person", userId: "u-cait" } } });
  const failed = row({ key: "m-2", id: "00000000-0000-4000-8000-000000000002" }); // lastChange undefined
  const params = { view: "sheet", who: "all", kind: "both", q: "", i: 1, person: null, open: null, since: "default" } as never;

  it("the shared line draws the text, and nothing when the read failed", async () => {
    const { LastChanged } = await import("@/components/review/shared");
    const html = renderToStaticMarkup(<LastChanged row={withChange} members={members} today="2026-11-17" />);
    expect(html).toContain("Changed by Caitlyn · Nov 16");
    expect(html).toContain("data-last-changed");
    expect(renderToStaticMarkup(<LastChanged row={failed} members={members} today="2026-11-17" />)).toBe("");
  });

  it.each([true, false])("the Sheet row draws it for a reader whether or not they can write (canWrite %s), and no failed row says 'not changed'", async (canWrite) => {
    const { SheetView } = await import("@/components/review/SheetView");
    const html = renderToStaticMarkup(<SheetView rows={[withChange, failed]} today="2026-11-17" members={members} canWrite={canWrite} params={params} />);
    expect(html.match(/data-last-changed/g)).toHaveLength(1);
    expect(html).toContain("Changed by Caitlyn · Nov 16");
    expect(html).not.toMatch(/Not changed|No changes recorded/);
  });

  it("the Board card draws it", async () => {
    const { ReviewBoard } = await import("@/components/review/ReviewViews");
    const lane = { userId: "u-cait", name: "Caitlyn Ross", our: [withChange, failed], client: [], count: 2 };
    const html = renderToStaticMarkup(<ReviewBoard lanes={[lane as never]} today="2026-11-17" members={members} canWrite params={{ ...(params as object), view: "board" } as never} />);
    expect(html.match(/data-last-changed/g)).toHaveLength(1);
    expect(html).toContain("Changed by Caitlyn · Nov 16");
  });

  it("the panel shows it as a fact, and none when the read failed", async () => {
    const { ReviewPanel } = await import("@/components/review/ReviewPanel");
    const detail = { status: "ok", openId: "x", currentStageId: null, assignedTo: null, cameFrom: null, steps: { ok: true, items: [] }, activity: { ok: true, items: [] }, stages: { ok: true, options: [] }, documents: { files: { status: "unavailable" }, letters: null } };
    const props = { open: { kind: "matter", id: "x" }, detail, today: "2026-11-17", timeZone: TZ, members: [{ userId: "u-cait", name: "Caitlyn Ross", role: "owner" }], canWrite: false, canMove: false, closeStages: [], closeHref: "/dashboard/review/" };
    const ok = renderToStaticMarkup(<ReviewPanel {...(props as never)} row={withChange} />);
    expect(ok).toContain("Last changed");
    expect(ok).toContain("Changed by Caitlyn · Nov 16");
    const bad = renderToStaticMarkup(<ReviewPanel {...(props as never)} row={failed} />);
    expect(bad).not.toContain("Last changed");
  });
});

describe("the read, three-state (acceptance 3)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  // Each module path is mocked exactly once per test (a second vi.doMock for the same path raced the first and made
  // two tests flaky), so a test that needs a different answer passes it in here.
  function mockAll(world: ReturnType<typeof makeWorld>, over: { matterLeadId?: string; directoryFails?: boolean } = {}) {
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false), activeOrgModulesOrNull: vi.fn(async () => []) }));
    vi.doMock("@/lib/matters", () => ({ listMatters: vi.fn(async () => [{ id: MATTER, status: "open", lead_id: over.matterLeadId ?? null, title: "Acme", owner_name: "Acme", matter_number: "TM-1", stage_id: null, type: "TM" }]) }));
    vi.doMock("@/lib/pipeline", () => ({ listLeads: vi.fn(async () => []), listStages: vi.fn(async () => []) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => { if (over.directoryFails) throw new Error("x"); return []; }) }));
    vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "unconfigured" })) }));
    vi.doMock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: vi.fn(async () => ({ status: "ok", byLead: {} })) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => TZ) }));
    vi.doMock("@/app/dashboard/matters/list-utils", () => ({ matterIdsNeedingReview: () => new Set() }));
  }
  const act = (over: Record<string, unknown>) => ({ id: `a-${Math.random()}`, org_id: ORG, lead_id: null, matter_id: MATTER, type: "stage_changed", actor_type: "user", actor_id: "u-cait", created_at: "2026-11-16T15:00:00Z", actor: null, source: null, ...over });

  it("reads the change rows and sets lastChange; a record of another firm or with no row is not named", async () => {
    const world = makeWorld({ tables: seedTables({ crm_activity: [act({}), act({ org_id: OTHER_ORG, matter_id: null, lead_id: OTHER_LEAD })] }) });
    mockAll(world);
    const { loadReview } = await import("../../src/lib/review/load");
    const r = await loadReview(NOW);
    expect(r.status === "ok" && r.failed).not.toContain("last change");
    expect(r.status === "ok" && r.rows[0].lastChange).toMatchObject({ date: "2026-11-16", actor: { kind: "person", userId: "u-cait" } });
  });

  it("only the last 12 months are asked for: an older row is not read, and the record reads 'No changes in the last year'", async () => {
    const world = makeWorld({ tables: seedTables({ crm_activity: [act({ created_at: "2025-06-01T15:00:00Z" })] }) });
    mockAll(world);
    const { loadReview } = await import("../../src/lib/review/load");
    const r = await loadReview(NOW);
    expect(r.status === "ok" && r.rows[0].lastChange).toBeNull();
    expect(lastChangedText(null, names, "2026-11-17")).toBe("No changes in the last year");
  });

  it("a failed team-names read draws no line for a person's change, but keeps an automatic one", async () => {
    const world = makeWorld({ tables: seedTables({ crm_activity: [act({})] }) });
    mockAll(world, { directoryFails: true });
    const { loadReview } = await import("../../src/lib/review/load");
    const r = await loadReview(NOW);
    expect(r.status === "ok" && r.failed).toContain("team names");
    expect(r.status === "ok" && r.rows[0].lastChange).toBeUndefined();
  });

  it("a matter also shows a change filed on its lead", async () => {
    const world = makeWorld({ tables: seedTables({ crm_activity: [act({ matter_id: null, lead_id: LEAD, created_at: "2026-11-15T15:00:00Z" })] }) });
    mockAll(world, { matterLeadId: LEAD });
    const { loadReview } = await import("../../src/lib/review/load");
    const r = await loadReview(NOW);
    expect(r.status === "ok" && r.rows[0].lastChange).toMatchObject({ date: "2026-11-15" });
  });

  it("a failed read leaves lastChange unset on every row (no line) and names 'last change' in the note", async () => {
    const world = makeWorld({ tables: seedTables({ crm_activity: [act({})] }) });
    mockAll(world);
    const { loadReview } = await import("../../src/lib/review/load");
    const good = await loadReview(NOW);
    expect(good.status === "ok" && good.rows[0].lastChange).not.toBeUndefined();
    world.db.fail("crm_activity", "select");
    const bad = await loadReview(NOW);
    expect(bad.status === "ok" && bad.failed).toContain("last change");
    expect(bad.status === "ok" && bad.rows.every((x) => x.lastChange === undefined)).toBe(true);
    const { detailsNote } = await import("../../src/lib/review/notes");
    expect(detailsNote(["last change"])).toBe("Some details couldn't load (last change). Refresh to try again.");
  });
});
