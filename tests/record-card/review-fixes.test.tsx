import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, Stage } from "@/lib/pipeline";
import { buildIntakeRows } from "@/lib/intake/rows";
import { resyncRows } from "@/lib/intake/resync";
import { beginOnce } from "@/lib/record-card/hold";
import { closeHref, openHrefFromHref } from "@/lib/record-card/open";
import { RecordCardHost } from "@/components/record-card/RecordCardHost";
import { LEAD, NOW, TZ, facts as stepFacts } from "../lead-step/fixtures";
import type { RecordCardLoad } from "@/lib/record-card/model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const root = path.resolve(__dirname, "../..");
const src = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const WON = "55555555-5555-4555-8555-555555555555";
const OPEN = "66666666-6666-4666-8666-666666666666";
const OUTSIDER = "77777777-7777-4777-8777-777777777777";
const INSIDER = "88888888-8888-4888-8888-888888888888";

// 1 ----------------------------------------------------------------------------------------------------------------------
const stage = (id: string, name: string) => ({ id, org_id: "o", name, order_index: 1, category: "open", aging_threshold_days: 30 }) as unknown as Stage;
const lead = (over: Record<string, unknown>) =>
  ({ id: LEAD, first_name: "Ana", last_name: "Ruiz", email: "a@x.test", current_stage_id: "s1", stage_entered_at: "2026-11-10T12:00:00Z", assigned_to: null, lane: null, ai_summary: null, last_activity_at: null, last_outbound_at: null, last_inbound_at: null, ...over }) as unknown as Lead;
const build = (l: Lead) => buildIntakeRows({ leads: [l], stages: [stage("s1", "New"), stage("s2", "Held")], members: [], now: new Date(NOW) });

describe("fresh rows from the server replace the drawn ones (a save in the opened card)", () => {
  it("updates the temperature, stage, owner and name", () => {
    const before = build(lead({}));
    const after = build(lead({ first_name: "Anita", current_stage_id: "s2", assigned_to: INSIDER, lane: "hot", lane_set_by: "u", lane_set_at: NOW }));
    const drawn = resyncRows(before, after, null)[0];
    expect(drawn.lead.first_name).toBe("Anita");
    expect(drawn.lead.current_stage_id).toBe("s2");
    expect(drawn.lead.assigned_to).toBe(INSIDER);
    expect(drawn.temperature.value).toBe("hot");
    expect(drawn.stage?.name).toBe("Held");
  });
  it("keeps the row whose write is still in flight, and takes every other row fresh", () => {
    const optimistic = build(lead({ lane: "cold", lane_set_by: "u", lane_set_at: NOW }));
    const fresh = build(lead({ lane: "hot", lane_set_by: "u", lane_set_at: NOW }));
    expect(resyncRows(optimistic, fresh, LEAD)[0].temperature.value).toBe("cold");
    expect(resyncRows(optimistic, fresh, "someone-else")[0].temperature.value).toBe("hot");
  });
  it("the workspace uses it when its rows prop changes", () => {
    const w = src("src/app/dashboard/intake/_components/IntakeWorkspace.tsx");
    expect(w).toMatch(/if \(seenRows !== initialRows\)[\s\S]*resyncRows\(current, initialRows, pendingId\)/);
  });
});

// 2 and 6 ----------------------------------------------------------------------------------------------------------------
describe("the Intake actions' server checks", () => {
  const moveLeadStage = vi.fn(async () => ({}));
  const assignLead = vi.fn(async () => ({}));
  let tables: Record<string, { data: unknown; error: unknown }> = {};
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tables = {
      crm_lead: { data: { id: LEAD, current_stage_id: OPEN }, error: null },
      crm_stage: { data: { id: WON, category: "won" }, error: null },
    };
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: async () => ({
        from: (t: string) => {
          const q: Record<string, unknown> = {};
          for (const k of ["select", "eq"]) q[k] = () => q;
          q.maybeSingle = async () => tables[t];
          return q;
        },
      }),
    }));
    vi.doMock("@/lib/pipeline", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline")>()), moveLeadStage, assignLead }));
    vi.doMock("@/lib/pipeline/leads", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline/leads")>()), resolveCurrentRole: async () => "owner" }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [{ userId: INSIDER }] }));
  });

  it("refuses a hand-posted won stage and moves nothing", async () => {
    const { moveStageAction } = await import("@/app/dashboard/intake/actions");
    expect(await moveStageAction(LEAD, WON)).toEqual({ ok: false, error: "Open the lead to move it to a won stage." });
    expect(moveLeadStage).not.toHaveBeenCalled();
  });
  it("a lead already in that stage is a no-op with the review's sentence", async () => {
    tables.crm_stage = { data: { id: OPEN, category: "open" }, error: null };
    const { moveStageAction } = await import("@/app/dashboard/intake/actions");
    expect(await moveStageAction(LEAD, OPEN)).toEqual({ ok: false, error: "This lead is already in that stage." });
    expect(moveLeadStage).not.toHaveBeenCalled();
  });
  it("a stage that isn't the firm's reads as missing; an open stage moves", async () => {
    const { moveStageAction } = await import("@/app/dashboard/intake/actions");
    tables.crm_stage = { data: null, error: null };
    expect((await moveStageAction(LEAD, WON)).ok).toBe(false);
    tables.crm_stage = { data: { id: WON, category: "open" }, error: null };
    expect(await moveStageAction(LEAD, WON)).toEqual({ ok: true });
    expect(moveLeadStage).toHaveBeenCalledTimes(1);
  });
  it("owner: a userId outside the firm is refused and nothing is written; a member is assigned; unassign is allowed", async () => {
    const { assignLeadAction } = await import("@/app/dashboard/intake/actions");
    expect(await assignLeadAction(LEAD, OUTSIDER)).toEqual({ ok: false, error: "That person isn't a member of your firm." });
    expect(assignLead).not.toHaveBeenCalled();
    expect(await assignLeadAction(LEAD, INSIDER)).toEqual({ ok: true });
    expect(await assignLeadAction(LEAD, null)).toEqual({ ok: true });
    expect(assignLead).toHaveBeenCalledTimes(2);
  });
  it("an unreadable team list refuses the change", async () => {
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => { throw new Error("down"); } }));
    const { assignLeadAction } = await import("@/app/dashboard/intake/actions");
    const r = await assignLeadAction(LEAD, INSIDER);
    expect(r.ok).toBe(false);
    expect(assignLead).not.toHaveBeenCalled();
  });
});

// 3, 5, 8 ----------------------------------------------------------------------------------------------------------------
describe("Mark no-show posts at most once", () => {
  function clock() {
    const timers: Array<() => void> = [];
    return { timers, opts: { setTimer: (fn: () => void) => (timers.push(fn), timers.length), clearTimer: (id: unknown) => void (timers[(id as number) - 1] = () => {}) } };
  }
  it("two begins, then Undo, makes zero posts", () => {
    const post = vi.fn();
    const c = clock();
    const first = beginOnce(null, post, c.opts);
    const second = beginOnce(first, post, c.opts);
    expect(second).toBe(first);
    expect(c.timers).toHaveLength(1);
    first.cancel();
    c.timers.forEach((t) => t());
    expect(post).not.toHaveBeenCalled();
  });
  it("two begins with no Undo makes one post", () => {
    const post = vi.fn();
    const c = clock();
    const first = beginOnce(null, post, c.opts);
    beginOnce(first, post, c.opts);
    c.timers.forEach((t) => t());
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("after a hold has posted or been undone, a new one may begin", () => {
    const post = vi.fn();
    const c = clock();
    const first = beginOnce(null, post, c.opts);
    first.cancel();
    expect(beginOnce(first, post, c.opts)).not.toBe(first);
  });
  it("the hook ignores a begin while held, hides the menu item while held, and says 'logged' only from the action's own Saved", () => {
    const c = src("src/components/record-card/controls.tsx");
    expect(c).toMatch(/if \(holdRef\.current\?\.settled\(\) === "held"\) return;/);
    expect(c).toMatch(/noShow\.held \? null/);
    expect(c).toMatch(/mark\?\.saved \? RECORD_CARD_NO_SHOW_DONE/);
    expect(c).not.toMatch(/setDoneLine/);
    expect(src("src/app/dashboard/intake/_components/RowMenu.tsx")).toMatch(/noShow\.held \? null/);
  });
  it("leaving the page inside the hold cancels it (documented: nothing is written, there is no component left to say so)", () => {
    expect(src("src/components/record-card/controls.tsx")).toMatch(/useEffect\(\(\) => \(\) => void holdRef\.current\?\.cancel\(\), \[\]\)/);
  });
});

// 4 ----------------------------------------------------------------------------------------------------------------------
describe("the open and close addresses follow the page's CURRENT address", () => {
  const current = "/dashboard/intake/?view=table&set=open&q=ana&show=50&group=owner&temp=hot";
  it("opening keeps search, paging, filters, view and grouping", () => {
    const open = openHrefFromHref("/dashboard/intake/", current, { kind: "lead", id: LEAD });
    const p = new URL(open, "http://x").searchParams;
    for (const [k, v] of [["view", "table"], ["set", "open"], ["q", "ana"], ["show", "50"], ["group", "owner"], ["temp", "hot"]]) expect(p.get(k), k).toBe(v);
    expect(p.get("open")).toBe(`lead:${LEAD}`);
  });
  it("closing from that address returns to exactly the view that was open", () => {
    const open = openHrefFromHref("/dashboard/intake/", current, { kind: "lead", id: LEAD });
    const q = new URLSearchParams(open.split("?")[1]);
    expect(closeHref("/dashboard/intake/", q)).toBe(current);
  });
  it("a bare address opens with only ?open=, and an old open is replaced", () => {
    expect(openHrefFromHref("/dashboard/intake/", "/dashboard/intake/", { kind: "lead", id: LEAD })).toBe(`/dashboard/intake/?open=lead%3A${LEAD}`);
    expect(openHrefFromHref("/dashboard/intake/", `/dashboard/intake/?open=lead:other&q=a`, { kind: "lead", id: LEAD })).toBe(`/dashboard/intake/?q=a&open=lead%3A${LEAD}`);
  });
  it("the Intake card, row and ⋯ menu draw the client address", () => {
    for (const f of ["IntakeCard", "IntakeTable"]) expect(src(`src/app/dashboard/intake/_components/${f}.tsx`), f).toMatch(/openHref \?\? /);
    expect(src("src/app/dashboard/intake/_components/IntakeWorkspace.tsx")).toMatch(/openHrefFromHref\("\/dashboard\/intake\/", href,/);
  });
});

// 7 ----------------------------------------------------------------------------------------------------------------------
describe("small things", () => {
  const leadRow = { id: LEAD, first_name: "Ana", last_name: "Ruiz", business_name: null, email: "a@x.test", phone: null, current_stage_id: "s-new", assigned_to: null, referral_source: null, last_activity_at: null, last_inbound_at: null, last_outbound_at: null, lane: null, lane_set_at: null, ai_summary: null };
  const load = (proposal: unknown) =>
    ({ status: "ok", kind: "lead", role: "attorney", now: NOW, timeZone: TZ, lead: leadRow, stages: { status: "ok", value: [{ id: "s-new", name: "New", category: "open" }] }, members: { status: "ok", value: [] }, tags: { status: "ok", value: { on: [], catalog: [] } }, leadStep: { status: "ok", facts: stepFacts({}) }, approvals: { status: "ok", queueIds: [] }, proposal, documents: { status: "unavailable" }, temperature: null, mergeAvailable: false, duplicateOf: null }) as RecordCardLoad;
  const html = async (proposal: unknown) => renderToStaticMarkup(await RecordCardHost({ open: { kind: "lead", id: LEAD }, path: "/dashboard/intake/", params: {}, load: load(proposal) }));

  it("no Proposal heading when the firm has no Proposals feature; one when it has", async () => {
    expect(await html({ status: "not-set-up" })).not.toContain('aria-label="Proposal"');
    expect(await html({ status: "ok", value: null })).toContain('aria-label="Proposal"');
  });
  it("the temperature pill: 44px tap area on coarse pointers and an invisible empty 'Set' until hover or focus", () => {
    const css = src("src/components/record-card/record-card.css");
    expect(css).toMatch(/pointer: coarse[\s\S]*button\.rc-temp::after \{ content: ""; position: absolute; inset: -12px 0; \}/);
    expect(css).toMatch(/\.ix-row \.rc-temp\[data-empty\], \.ix-card \.rc-temp\[data-empty\] \{ color: transparent/);
    expect(css).toMatch(/\.ix-row:hover \.rc-temp\[data-empty\]/);
  });
  it("the 'Open a matter' picker never repeats an email that is already the name", () => {
    expect(src("src/app/dashboard/matters/page.tsx")).toMatch(/l\.email !== leadLabel\(l\)\.name \? l\.email : null/);
  });
  it("the Matters list needs no more width than before (800, narrower columns, owner as an avatar)", () => {
    const m = src("src/app/dashboard/matters/page.tsx");
    expect(m).toMatch(/<SheetTable fixed minWidth=\{800\}>/);
    const widths = [...m.slice(m.indexOf("<colgroup>"), m.indexOf("</colgroup>")).matchAll(/width: "(\d+)%"/g)].map((x) => Number(x[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("Intake and Matters fall back to the same shared time zone, and next steps are read in parallel", () => {
    expect(src("src/app/dashboard/intake/page.tsx")).toMatch(/catch\(\(\) => DEFAULT_TIME_ZONE\)/);
    expect(src("src/app/dashboard/matters/page.tsx")).toMatch(/catch\(\(\) => DEFAULT_TIME_ZONE\)/);
    expect(src("src/lib/record-card/steps-read.ts")).toMatch(/await Promise\.all\(/);
  });
});
