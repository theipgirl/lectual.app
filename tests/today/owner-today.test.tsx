import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeckSummary } from "@/lib/queue/deck-summary";
import type { OwnerDeadline, OwnerProposal } from "@/lib/today/owner-rules";
import type { NeedsReviewItem } from "@/lib/today/needs-review";
import type { TodayConsultsResult } from "@/lib/calendar/consult-sources";

process.env.__NEXT_TRAILING_SLASH = "true";

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "");
const NOW = new Date("2026-11-10T15:00:00Z");

type Reads = {
  deck?: DeckSummary;
  consults?: TodayConsultsResult | "fail";
  deadlines?: OwnerDeadline[] | "fail";
  proposals?: OwnerProposal[] | "fail";
  review?: NeedsReviewItem[] | "fail";
  proposalsModule?: boolean;
  ai?: boolean;
};

const dl = (over: Partial<OwnerDeadline> = {}): OwnerDeadline => ({ key: "d1", href: "/dashboard/matters/m1/", name: "Office action response", detail: "TM-1 · The Fold", dueDate: "2026-11-12", overdueDays: 0, ...over });
const okConsults: TodayConsultsResult = { consults: [], outlook: "ok", zoom: "ok" };

async function render(r: Reads = {}) {
  vi.resetModules();
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => r.ai ?? true }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => r.proposalsModule ?? true) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: "u1", displayName: "Rebecca Smith", identified: true }]) }));
  vi.doMock("@/lib/queue/deck-summary", () => ({ loadDeckSummary: vi.fn(async () => r.deck ?? { status: "ok", count: 3, minutes: 6, dealLabel: "7:00 AM", nextDealLabel: "2:00 PM", laterArrivals: 0 }) }));
  vi.doMock("@/lib/calendar/consult-sources", async (orig) => ({
    ...(await orig<typeof import("@/lib/calendar/consult-sources")>()),
    loadTodayConsults: vi.fn(async () => {
      if (r.consults === "fail") throw new Error("boom secret");
      return r.consults ?? okConsults;
    }),
  }));
  vi.doMock("@/lib/calendar/consult-sources-live", () => ({ liveConsultDeps: {} }));
  vi.doMock("@/lib/today/owner-load", () => ({
    loadOwnerDeadlines: vi.fn(async () => {
      if (r.deadlines === "fail") throw new Error("boom secret");
      return r.deadlines ?? [dl()];
    }),
    loadOwnerNeedsReview: vi.fn(async () => {
      if (r.review === "fail") throw new Error("boom secret");
      return r.review ?? [];
    }),
    loadOwnerProposals: vi.fn(async () => {
      if (r.proposals === "fail") throw new Error("boom secret");
      return r.proposals ?? [];
    }),
  }));
  const { OwnerToday } = await import("@/components/today/OwnerToday");
  return text(renderToStaticMarkup(await OwnerToday({ userId: "u1", role: "owner", email: "r@firm.test", metadata: {}, now: NOW })));
}

beforeEach(() => vi.resetModules());

describe("Owner Today", () => {
  it("greets by name and shows the cards line with a Start link to the deck", async () => {
    const html = await render();
    expect(html).toContain("Good morning, Rebecca.");
    expect(html).toContain('<span class="ot-big">3</span>');
    expect(html).toContain("cards for you · about 6 min");
    expect(html).toContain("Deal opened 7:00 AM. Next deal 2:00 PM.");
    expect(html).toMatch(/href="\/dashboard\/queue\/deck\/"[^>]*>Start</);
  });

  it("says 'All decided' with the next deal only for an ok read with nothing to decide, and offers no Start", async () => {
    const html = await render({ deck: { status: "ok", count: 0, minutes: 0, dealLabel: "7:00 AM", nextDealLabel: "2:00 PM", laterArrivals: 0 } });
    expect(html).toContain("All decided. Next deal 2:00 PM.");
    expect(html).not.toContain("/dashboard/queue/deck/");
  });

  it("a failed or unconfigured queue read prints its own sentence and never a zero or Start", async () => {
    for (const [deck, sentence] of [
      [{ status: "unavailable" }, "Couldn't load your cards."],
      [{ status: "unconfigured" }, "No approval queue is connected for your firm yet."],
    ] as const) {
      const html = await render({ deck });
      expect(html).toContain(sentence);
      expect(html).not.toContain("All decided");
      expect(html).not.toMatch(/\b0 cards/);
      expect(html).not.toContain("/dashboard/queue/deck/");
    }
  });

  it("each failed read shows its own sentence, and the others still draw", async () => {
    const html = await render({ consults: "fail", deadlines: "fail", proposals: "fail" });
    expect(html).toContain("Couldn't load consults.");
    expect(html).toContain("Couldn't load deadlines.");
    expect(html).toContain("Couldn't load proposals.");
    expect(html).toContain("Couldn't load this week.");
    expect(html).toContain('<span class="ot-big">3</span>');
    expect(html).not.toContain("boom secret");
    expect(html).not.toContain("Nothing due in the next 14 days.");
    expect(html).not.toContain("No proposals are out right now.");
  });

  it("flags an overdue deadline and lists a live proposal; empty is only said for a read that worked", async () => {
    const html = await render({
      deadlines: [dl({ dueDate: "2026-11-07", overdueDays: 3 })],
      proposals: [{ id: "p1", href: "/dashboard/proposals/p1/", client: "Sevetri Wilson", title: "The Fold", expiry: "Last day Nov 12", expired: false, expiresOn: "2026-11-12" }],
    });
    expect(html).toContain("3 days overdue");
    expect(html).toContain("Sevetri Wilson");
    expect(html).toContain("Last day Nov 12");
    const empty = await render({ deadlines: [], proposals: [] });
    expect(empty).toContain("Nothing due in the next 14 days.");
    expect(empty).toContain("No proposals are out right now.");
  });

  it("leaves Proposals out entirely for a firm without the feature", async () => {
    const html = await render({ proposalsModule: false });
    expect(html).not.toContain("Proposals out");
  });

  it("draws a seven-day strip linking to the calendar", async () => {
    const html = await render({ deadlines: [dl({ dueDate: "2026-11-12" })] });
    expect(html.match(/class="ot-day"/g)?.length ?? html.match(/ot-day/g)?.length).toBeGreaterThanOrEqual(7);
    expect(html).toContain("/dashboard/calendar/");
  });

  it("shows the Ask Copilot box only when AI is configured", async () => {
    const on = await render({ ai: true });
    expect(on).toContain("Ask Copilot");
    expect(on).toContain('action="/dashboard/copilot/"');
    const off = await render({ ai: false });
    expect(off).not.toContain("Ask Copilot");
    expect(off).not.toContain("/dashboard/copilot/");
  });

  it("promises nothing is sent by Lectual and never says it sends", async () => {
    const html = await render();
    expect(html).not.toMatch(/we.{0,10}send|will send|sent for you/i);
  });
});

describe("Today page branch", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");

  it("computes the view from the session and returns OwnerToday only for the owner view", () => {
    expect(src).toContain('(session.org.modules ?? []).includes("role-views")');
    expect(src).toContain("actingAsStaff: session.actingAsStaff");
    expect(src).toMatch(/if \(view === "owner"\) \{\s*return <OwnerToday/);
    expect(src).not.toMatch(/view !== "technician"/);
  });

  it("branches before the first technician read runs", () => {
    const branch = src.indexOf('if (view === "owner")');
    for (const read of ["orgHasModule(", "getFirmTimeZone()", "Promise.allSettled", "loadActiveQueue()", "listLeads()", "listMatters()"]) {
      const at = src.indexOf(read, src.indexOf("export default async function TodayPage"));
      expect(at, read).toBeGreaterThan(branch);
    }
  });

  it("keeps the technician path as it was (cards, setup card and needs-you stay in the page)", () => {
    expect(src).toContain("<GetSetUpCard role={session.role} />");
    expect(src).toContain("<NeedsYouSection");
    expect(src).not.toContain("GettingStartedCard");
  });

  it("OwnerToday itself shows neither the get-set-up nor the getting-started card", () => {
    const owner = readFileSync(path.join(process.cwd(), "src/components/today/OwnerToday.tsx"), "utf8");
    expect(owner).not.toMatch(/GetSetUpCard|GettingStartedCard|FinishSetupCard/);
  });
});

describe("Owner Today: Needs review", () => {
  const item = (over: Partial<NeedsReviewItem> = {}): NeedsReviewItem => ({ key: "n1", href: "/dashboard/matters/m9/", name: "Response to office action", matter: "TM-9 \u00b7 Old Mark", dueDate: "2025-01-15", daysPastDue: 299, ...over });

  it("lists each date with its matter, how long past due and a link to the matter", async () => {
    const html = await render({ review: [item(), item({ key: "n2", href: "/dashboard/matters/m8/", name: "Statement of use", daysPastDue: 1 })] });
    expect(html).toContain("Needs review");
    expect(html).toContain("Response to office action");
    expect(html).toContain("TM-9 \u00b7 Old Mark");
    expect(html).toContain("299 days past due");
    expect(html).toContain("1 day past due");
    expect(html).toContain("Entered by hand, never confirmed, and more than 180 days past due.");
    expect(html).toMatch(/href="\/dashboard\/matters\/m9\/"/);
  });

  it("draws nothing for an ok read with no items", async () => {
    const html = await render({ review: [] });
    expect(html).not.toContain("Needs review");
  });

  it("says it couldn't load on a failed read, never 'nothing to review'", async () => {
    const html = await render({ review: "fail" });
    expect(html).toContain("Needs review");
    expect(html).toContain("Couldn't load the dates to review.");
    expect(html).not.toContain("boom");
    expect(html).not.toContain("past due");
  });
});
