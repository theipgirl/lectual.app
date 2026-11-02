import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROWS, STRIP_OK, item, renderListPage } from "../proposals/list-page-harness";
import type { ConsultsStripData } from "@/lib/proposals/consults-load";
import { consultsCapNote, emptySegmentSentence, OPEN_OFFERS_LABEL, TRANSCRIPT_PROCESSING } from "@/lib/proposals/list-copy";
import { FEE_SENTENCE, PROPOSALS_NAME, PROPOSALS_SUBLINE } from "@/lib/ui/words";

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "src/app/dashboard/proposals/proposals.css"), "utf8");
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

const row = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  provider: "zoom" as const,
  title: "Sana consult",
  whenLabel: "Oct 20, 10:00 AM",
  linkedTo: "Sana Okafor",
  clientName: "Sana Okafor",
  company: null,
  line: "Zoom consult · yesterday",
  state: "ready" as const,
  proposalId: null,
  leadId: "lead-1",
  matterId: null,
  ...over,
});
const strip = (rows: ReturnType<typeof row>[]): ConsultsStripData => ({ ...STRIP_OK, meetings: { status: "ok", rows, more: 0 } });

describe("Proposals list (F11)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T16:00:00Z"));
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
    vi.doMock("@/app/dashboard/meetings/actions", () => ({ linkMeetingAction: vi.fn() }));
  });
  afterEach(() => vi.useRealTimers());

  it("the table comes before the consults section, which is always open (no collapsed details)", async () => {
    const html = text(await renderListPage({}, { strip: strip([row(), row({ id: "m2" }), row({ id: "m3", state: "transcribing" })]) }));
    expect(html.indexOf("<table")).toBeGreaterThan(-1);
    expect(html.indexOf("<table")).toBeLessThan(html.indexOf("Consults and client meetings"));
    expect(html).not.toContain('class="pq-strip"');
    expect(html).not.toContain("Recent consults (");
  });

  it("'Not ready' gives its reason and 'Link a lead first' becomes a 'Link to a lead' picker", async () => {
    const html = text(
      await renderListPage({}, { strip: strip([row({ id: "t1", state: "transcribing" }), row({ id: "u1", state: "unlinked", leadId: null })]) }),
    );
    expect(html).toContain(TRANSCRIPT_PROCESSING);
    expect(html).toContain("Transcript still processing");
    expect(html).toContain(">Link to a lead<");
    expect(html).not.toContain("Link a lead first");
    expect(html).toContain('<option value="lead-1">Ana Ruiz</option>');
  });

  it("the picker's lead list is the scoped read; a failed read is its own alert, never 'no leads'", async () => {
    const html = text(await renderListPage({}, { strip: strip([row({ id: "u1", state: "unlinked", leadId: null })]), leads: { status: "unavailable" } }));
    expect(html).toContain("Can't show your leads right now. Refresh to try again.");
    expect(html).not.toContain("You have no leads yet");
    const src = readFileSync(path.join(root, "src/components/proposal-list/LinkLeadPicker.tsx"), "utf8");
    expect(src).toContain("linkMeetingAction");
    expect(readFileSync(path.join(root, "src/lib/proposals/lead-options.ts"), "utf8")).toContain("getScopedClient");
  });

  it("the left column is headed Show and becomes a chip row under 760px", async () => {
    const html = text(await renderListPage());
    expect(html).toContain('<div class="lx-label pq-segs-label">Show</div>');
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.pq-segs \{ display: flex; flex-wrap: wrap;/);
    expect(css).toMatch(/\.pq-seg \{ border-radius: 999px;/);
  });

  it("says the fee sentence once, and uses the new subtitle", async () => {
    const html = text(await renderListPage());
    expect(html.split(FEE_SENTENCE).length - 1).toBe(1);
    expect(FEE_SENTENCE).toBe("Legal fee is due at signing. USPTO fees are paid at filing.");
    expect(PROPOSALS_SUBLINE).toBe("Every proposal you've sent or started, newest first.");
    expect(html).toContain(PROPOSALS_SUBLINE);
  });

  it("relabels the dollar tile and keeps its explanation", async () => {
    const html = text(await renderListPage({}, { rows: [item("s1", { status: "sent" })] }));
    expect(OPEN_OFFERS_LABEL).toBe("Open offers (lowest package each)");
    expect(html).toContain(">Open offers (lowest package each)<");
    expect(html).toContain("counted at the cheapest package offered");
  });

  it("folds Expires into the status line under 1200px", async () => {
    const html = text(await renderListPage());
    expect(html).toContain("pq-exp-inline");
    expect(css).toMatch(/@media \(max-width: 1199px\) \{[^}]*\.pq-th-expires, \.pq-tbl td\.pq-c-expires \{ display: none; \}/);
    expect(css).toContain(".pq-exp-inline { display: block; }");
  });

  it("a filtered empty segment says so with a Show all link", async () => {
    const html = text(await renderListPage({ segment: "accepted" }, { rows: [item("a1")] }));
    expect(html).toContain("No accepted proposals yet.");
    expect(html).toMatch(/<a href="\/dashboard\/proposals\/?">Show all<\/a>/);
    expect(emptySegmentSentence("accepted")).toBe("No accepted proposals yet.");
    expect(ROWS.length).toBeGreaterThan(0);
  });

  it("the cap note says how many are shown", () => {
    expect(consultsCapNote(30)).toBe("Showing the newest 30.");
  });

  it("h1, title and back links use one name", async () => {
    const html = text(await renderListPage());
    expect(html).toContain(`>${PROPOSALS_NAME}</h1>`);
    const list = readFileSync(path.join(root, "src/app/dashboard/proposals/page.tsx"), "utf8");
    expect(list).toContain("pageTitle(PROPOSALS_NAME)");
    const dirs = ["src/app/dashboard/proposals", "src/components/proposal-list", "src/components/proposal-editor"];
    const walk = (d: string): string[] =>
      readdirSync(path.join(root, d)).flatMap((n) => {
        const p = path.join(d, n);
        return statSync(path.join(root, p)).isDirectory() ? walk(p) : [p];
      });
    for (const f of dirs.flatMap(walk).filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
      expect(src, f).not.toContain("Quotes & proposals");
      expect(src, f).not.toContain("Quotes &amp; proposals");
      expect(src, f).not.toContain("← Client proposals");
    }
    expect(createElement).toBeTruthy();
    expect(renderToStaticMarkup).toBeTruthy();
  });
});
