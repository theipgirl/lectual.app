import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueueLoad } from "@/lib/queue/load";
import type { CardState } from "@/lib/queue/deck";
import { followup, MEMBERS, U } from "./routing-fixtures";

/** Sprint 4 review, SHOULD 4: a failed "Ready to draft" read is said to the drafter, never drawn as nothing. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
process.env.__NEXT_TRAILING_SLASH = "true";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ok: QueueLoad = { status: "ok", items: [followup({ id: "f1" })] };

async function renderList(cardState: CardState, viewer: { userId: string; role: string }, drafter: string | null) {
  vi.resetModules();
  vi.doMock("@/lib/queue/card-state", () => ({ loadCardState: vi.fn(async () => cardState) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ok) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/app/dashboard/queue/actions", () => ({ dismissStaleFollowupsAction: vi.fn(), sendBackAction: vi.fn() }));
  vi.doMock("@/lib/queue/view-context", () => ({
    loadQueueViewContext: vi.fn(async () => ({ viewer, routing: {}, members: MEMBERS, routingFailed: false, dropped: 0, drafter, now: NOW })),
  }));
  const { default: Page } = await import("../../src/app/dashboard/queue/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

const caitlyn = { userId: U.caitlyn, role: "paralegal" };

beforeEach(() => vi.setSystemTime(NOW));

describe("SHOULD 4: Ready to draft that couldn't be read", () => {
  it("the drafter sees 'Couldn't check what's ready to draft.' when the events can't be read", async () => {
    const html = await renderList({ status: "unavailable" }, caitlyn, U.caitlyn);
    expect(html).toContain("data-ready-unchecked");
    expect(html).toContain("Couldn&#x27;t check what&#x27;s ready to draft.");
    expect(html).not.toContain("data-ready-to-draft");
  });

  it("someone who isn't the drafter sees nothing; before 0112 (not set up) and an empty read say nothing either", async () => {
    expect(await renderList({ status: "unavailable" }, caitlyn, U.rebecca)).not.toContain("data-ready-unchecked");
    expect(await renderList({ status: "not-set-up" }, caitlyn, U.caitlyn)).not.toContain("data-ready-unchecked");
    expect(await renderList({ status: "ok", events: [] }, caitlyn, U.caitlyn)).not.toContain("data-ready-unchecked");
  });

  it("the deck says the same sentence for the drafter (source check)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/dashboard/queue/deck/deck-view.tsx", "utf8");
    expect(src).toMatch(/routed\.drafter === viewer\.userId && \(approved\.status === "unavailable" \|\| ready\?\.status === "unavailable"\)/);
    expect(src).toContain("{READY_TO_DRAFT_UNCHECKED}");
  });
});

describe("MUST 2: the page never says Drafted for an unconfirmed claim", () => {
  it("check-drafts shows the sentence and the approved body as plain React text (escaped), no Make-the-draft button, no 'Drafted'", async () => {
    vi.resetModules();
    vi.doMock("@/app/dashboard/queue/actions", () => ({ makeDraftAction: vi.fn(), clearClaimAction: vi.fn() }));
    const { createElement } = await import("react");
    const { MakeDraftCard } = await import("@/components/queue/MakeDraftCard");
    const html = renderToStaticMarkup(
      createElement(MakeDraftCard, { id: "q1", intro: "Rebecca approved this email.", view: { kind: "check-drafts", sentence: "Check your Drafts. If it isn't there, copy the approved text below.", text: "Hi <b>Ana</b>,\nPublished." } }),
    );
    expect(html).toContain("Check your Drafts. If it isn&#x27;t there, copy the approved text below.");
    expect(html).toContain("Hi &lt;b&gt;Ana&lt;/b&gt;,\nPublished.");
    expect(html).not.toContain("<b>Ana</b>");
    expect(html).not.toContain("Drafted in your Outlook");
    // Changed on purpose (final review 2): the only button is "It isn't in my Drafts, try again", never "Make the draft".
    expect(html).not.toContain("Make the draft in my Outlook");
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).toContain("It isn&#x27;t in my Drafts, try again");
    expect(html).toContain("data-clear-claim");
    const drafted = renderToStaticMarkup(createElement(MakeDraftCard, { id: "q1", intro: "x", view: { kind: "drafted" } }));
    expect(drafted).toContain("Drafted in your Outlook.");
  });

  it("the item page draws 'Drafted' only for a confirmed drafted, and the retry only with a pass_failed marker (source check)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/dashboard/queue/[id]/page.tsx", "utf8");
    expect(src).toMatch(/a\.progress\.kind === "drafted"\) makeDraft = \{ intro, view: \{ kind: "drafted" \} \}/);
    expect(src).toMatch(/a\.progress\.kind === "drafting"\) makeDraft = \{ intro, view: \{ kind: "check-drafts"/);
    expect(src).toMatch(/!a && passFailedRecorded\(events\.events, item\.id\)/);
  });
});
