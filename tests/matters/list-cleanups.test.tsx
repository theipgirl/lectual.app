import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";
import { LIST_CHIPS, matterCardId, mattersSubtitle, reviewHref, reviewItemByMatter, stageDisplayName, statusNote } from "@/lib/matters/list-view";

const root = path.resolve(__dirname, "../..");
const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const stage: MatterStage = { id: "s1", code: "3", label: "3. Filed", order_index: 3, is_open: true, waiting_on: "uspto" };
const m = (o: Partial<Matter> = {}) =>
  ({
    id: "m1",
    matter_number: "TM-1",
    mark_text: "ACME",
    title: null,
    owner_name: "Dana",
    status: "open",
    type: "TM",
    assigned_to: null,
    stage,
    stage_id: "s1",
    stage_entered_at: daysAgo(2),
    ...o,
  }) as unknown as Matter;

describe("pure helpers", () => {
  it("strips the code prefix from a stage name", () => {
    expect(stageDisplayName("3. Filed")).toBe("Filed");
    expect(stageDisplayName("12) Preparing")).toBe("Preparing");
    expect(stageDisplayName("Filed")).toBe("Filed");
  });
  it("has exactly four chips", () => {
    expect(LIST_CHIPS.map((c) => c.label)).toEqual(["Open", "Needs your review", "Unassigned", "Closed"]);
  });
  it("the subtitle differs for table and board", () => {
    expect(mattersSubtitle("table")).not.toBe(mattersSubtitle("board"));
  });
  it("status shows in the sub-line only when not Open", () => {
    expect(statusNote("open")).toBeNull();
    expect(statusNote("on_hold")).toBe("On hold");
  });
  it("review items map a matter to its first queue item", () => {
    const map = reviewItemByMatter([
      { id: "q1", matter_id: "m1" },
      { id: "q2", matter_id: "m1" },
      { id: "q3", matter_id: null },
    ]);
    expect([...map]).toEqual([["m1", "q1"]]);
    expect(reviewHref("q 1")).toBe("/dashboard/queue/q%201/");
    expect(matterCardId("m1")).toBe("matter-card-m1");
  });
});

async function render(opts: { queue: unknown; matters: Matter[]; view?: string; q?: string }) {
  vi.resetModules();
  vi.doMock("@/lib/matters", async (orig) => ({ ...(await orig<typeof import("@/lib/matters")>()), listMatters: vi.fn(async () => opts.matters) }));
  vi.doMock("@/lib/pipeline", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline")>()), listLeads: vi.fn(async () => []) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => opts.queue) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => [stage]) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney" })) }));
  vi.doMock("@/components/matters/MatterForms", () => ({ NewMatterForm: () => null }));
  vi.doMock("@/app/dashboard/matters/[id]/actions", () => ({ updateMatterStageAction: vi.fn() }));
  vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
  const { default: MattersPage } = await import("../../src/app/dashboard/matters/page");
  return renderToStaticMarkup(await MattersPage({ searchParams: Promise.resolve({ view: opts.view, q: opts.q }) }));
}

describe("F5: Matters list", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  const ok = { status: "ok", items: [{ id: "q9", matter_id: "m1" }] };

  it("shows the four chips, a Search button and no Clear without a term", async () => {
    const html = await render({ queue: ok, matters: [m()] });
    const chips = html.slice(html.indexOf('aria-label="Filter matters"'));
    for (const label of ["Open", "Needs your review", "Unassigned", "Closed"]) expect(chips).toContain(`>${label}`);
    expect(chips).not.toContain("Waiting on the client");
    expect(html).toContain(">Search</button>");
    expect(html).not.toContain(">Clear<");
    expect(renderToStaticMarkup(<span />)).toBe("<span></span>");
  });

  it("shows Clear when a search term is set", async () => {
    expect(await render({ queue: ok, matters: [m()], q: "acme" })).toContain(">Clear<");
  });

  it("has an Open a matter header button, stage without a code, no Status column, In stage always, and a Review link", async () => {
    const html = await render({ queue: ok, matters: [m({ status: "on_hold" })] });
    expect(html).toContain(">Open a matter</button>");
    expect(html).toContain('id="open-matter"');
    expect(html).toContain(">Filed<");
    expect(html).not.toContain("3. Filed");
    expect(html).not.toContain("<th>Status</th>");
    expect(html).toContain("<th>In stage</th>");
    expect(html).toContain("On hold");
    expect(html).toMatch(/<a [^>]*href="\/dashboard\/queue\/q9\/?"[^>]*>Review<\/a>/);
    expect(html).toContain("2d");
  });

  it("only a stale matter gets the red pill", async () => {
    const fresh = await render({ queue: ok, matters: [m()] });
    expect(fresh).not.toContain("lp-pill-risk");
    const stale = await render({ queue: ok, matters: [m({ stage_entered_at: daysAgo(400) })] });
    expect(stale).toContain("lp-pill lp-pill-risk");
  });

  it("an unreachable queue uses the standard warning banner", async () => {
    const html = await render({ queue: { status: "unavailable", items: [] }, matters: [m()] });
    expect(html).toMatch(/class="lx-banner lx-banner-warn"[^>]*>The approval queue can&#x27;t be reached/);
    expect(html).not.toContain("Needs your review");
  });

  it("the sub-line follows the view", async () => {
    expect(await render({ queue: ok, matters: [m()] })).toContain(mattersSubtitle("table"));
    expect(await render({ queue: ok, matters: [m()], view: "board" })).toContain(mattersSubtitle("board"));
  });
});

describe("F6/P2: board cards", () => {
  it("uses a Move menu (no select per card), an id per card and None for an empty column", async () => {
    vi.resetModules();
    vi.doMock("@/app/dashboard/matters/[id]/actions", () => ({ updateMatterStageAction: vi.fn() }));
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
    const { MatterBoard } = await import("../../src/components/matters/MatterBoard");
    const stages = [stage, { ...stage, id: "s2", code: "4", label: "4. Registered", order_index: 4 }];
    const html = renderToStaticMarkup(
      <MatterBoard stages={stages} matters={[m()]} canMove reviewIds={new Set(["m1"])} reviewItems={new Map([["m1", "q9"]])} ownerName={() => null} />,
    );
    expect(html).toContain('id="matter-card-m1"');
    expect(html).toContain(">Move</button>");
    expect(html).not.toContain("<select");
    expect(html).toContain(">None<");
    expect(html).toContain(">Filed<");
    expect(html).toMatch(/href="\/dashboard\/queue\/q9\/?"/);
    const noMove = renderToStaticMarkup(
      <MatterBoard stages={stages} matters={[m()]} canMove={false} reviewIds={new Set()} ownerName={() => null} />,
    );
    expect(noMove).not.toContain(">Move<");
  });

  it("the Move menu closes on Esc and outside click (shared Popover) and calls the existing stage action", () => {
    const menu = readFileSync(path.join(root, "src/components/matters/MoveMenu.tsx"), "utf8");
    expect(menu).toContain("updateMatterStageAction");
    expect(menu).toContain("Popover");
    const pop = readFileSync(path.join(root, "src/components/list-page/Popover.tsx"), "utf8");
    expect(pop).toContain('"Escape"');
    expect(pop).toContain("mousedown");
  });
});
