import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb } from "./helpers/fake-db";
import { standardSeed } from "./helpers/seed";

const root = path.resolve(__dirname, "../..");
const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown }, role: "attorney", docCenter: true, quotes: true }));
const stub = () => null;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "");

async function render() {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: h.role })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => m === "document-center" && h.docCenter) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/voice/notes", async (orig) => ({ ...(await orig<typeof import("@/lib/voice/notes")>()), voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/documents/loe-prefill-load", () => ({
    loadSignedQuotesForMatter: vi.fn(async () => ({ status: "ok", quotes: h.quotes ? [{ id: "q1" }] : [] })),
  }));
  vi.doMock("@/lib/intake-forms/requests", () => ({
    canSendIntakeRequest: () => false,
    listMatterIntakeRequests: vi.fn(async () => ({ status: "ok", requests: [], formReady: false })),
  }));
  vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
  vi.doMock("@/components/meetings/LinkedMeetings", () => ({ LinkedMeetings: stub }));
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/components/matters/IntakeRequestCard", () => ({ IntakeRequestCard: stub }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  const page = await import("../../src/app/dashboard/matters/[id]/page");
  return text(renderToStaticMarkup(await page.default({ params: Promise.resolve({ id: "matter-1" }) })));
}

beforeEach(() => {
  h.db = createFakeDb({ tables: standardSeed() });
  h.role = "attorney";
  h.docCenter = true;
  h.quotes = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("F7: matter page", () => {
  it("puts the letter buttons in the header and not in About", async () => {
    const html = await render();
    const head = html.slice(0, html.indexOf('class="lx-split lx-split-matter"'));
    expect(head).toContain(">Draft engagement letter<");
    expect(head).toContain(">Draft a letter<");
    const about = html.slice(html.indexOf(">About<"));
    expect(about).not.toContain("Draft a letter");
    expect(about).not.toContain("Draft engagement letter");
    expect(html.match(/Draft a letter/g)).toHaveLength(1);
  });

  it("offers the engagement letter only when the matter qualifies, and no letters without Document Center", async () => {
    h.quotes = false;
    expect(await render()).not.toContain("Draft engagement letter");
    h.docCenter = false;
    expect(await render()).not.toContain("Draft a letter");
  });

  it("shows each fact once: owner, package, came from, days in stage", async () => {
    const html = await render();
    const about = html.slice(html.indexOf(">About<"));
    expect(about).not.toContain(">Owner<");
    expect(about).not.toContain(">Package<");
    expect(about).not.toContain(">Came from<");
    expect(html.match(/Came from Booth/g)).toHaveLength(1);
    expect(html).not.toContain("(from the tracker)");
    expect((html.match(/\d+d in stage/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(html.match(/Package: Basic/g)).toHaveLength(1);
  });

  it("splits the sub-line in two lines", async () => {
    const html = await render();
    expect(html).toMatch(/<p class="lx-note" style="margin:6px 0 0">[^<]*<\/p><p class="lx-note" style="margin:2px 0 0">/);
  });

  it("says No deadlines yet with a visible Add a deadline button, and renames the headings", async () => {
    h.db = createFakeDb({ tables: { ...standardSeed(), crm_matter_deadline: [] } });
    const html = await render();
    expect(html).toContain("No deadlines yet.");
    expect(html).toMatch(/<summary class="lx-btn lx-btn-sec lx-btn-sm">Add a deadline<\/summary>/);
    expect(html).toContain("Filing details");
    expect(html).not.toContain(">The filing<");
    expect(html).not.toContain(">The case<");
  });

  it("puts the read-only note in the head, not at the bottom", async () => {
    h.role = "viewer";
    const html = await render();
    const note = html.indexOf("Your role can view this matter but not change it.");
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(html.indexOf('class="lx-split lx-split-matter"'));
    expect(html.match(/Your role can view this matter/g)).toHaveLength(1);
  });

  it("the source has Case details for litigation", () => {
    const src = readFileSync(path.join(root, "src/app/dashboard/matters/[id]/page.tsx"), "utf8");
    expect(src).toContain("Case details");
  });
});

describe("F7: phone order and Saved", () => {
  it("the CSS lets the contact, tasks, notes and files read before the timeline at 640px", () => {
    const css = readFileSync(path.join(root, "src/components/matters/matter-page.css"), "utf8");
    expect(css).toMatch(/max-width: 640px/);
    expect(css).toMatch(/\.lx-split-matter > \.lx-col-aside \{ display: contents; \}|\.lx-split-matter > \.lx-col-aside \{ display: contents/);
    expect(css).toMatch(/\.lx-matter-timeline \{ order: 5; \}/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the auto-saving selects report Saved only from the action result", () => {
    const src = readFileSync(path.join(root, "src/components/matters/MatterForms.tsx"), "utf8");
    expect(src).toContain("saved: true");
    expect(src).toMatch(/state\.saved && !pending && !state\.error/);
    expect(createElement).toBeTruthy();
  });
});
