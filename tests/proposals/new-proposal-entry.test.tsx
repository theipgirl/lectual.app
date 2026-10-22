import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderListPage } from "./list-page-harness";
import { createFakeDb, type FakeDb } from "../matters/helpers/fake-db";
import { standardSeed } from "../matters/helpers/seed";
import { LeadProposalsCard } from "@/components/leads/LeadProposalsCard";
import { MatterProposalCard } from "@/components/matters/MatterProposalCard";

/**
 * The ways into New proposal: the Quotes & proposals button (lands on the picker), the lead page's
 * link and the matter page's link (both straight to the record).
 */

const LEAD = "11111111-1111-4111-8111-111111111111";

describe("Quotes & proposals: the New proposal button", () => {
  beforeEach(() => vi.resetModules());

  it("is a link to the picker (no query) for someone who can start a proposal", async () => {
    const html = await renderListPage({}, {});
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/proposals\/new\/?"[^>]*>New proposal<\/a>/);
    expect(html).not.toMatch(/href="\/dashboard\/proposals\/new\/?\?/);
  });

  it("is absent for a role that can't write proposals", async () => {
    const html = await renderListPage({}, { role: "viewer" });
    expect(html).not.toContain("New proposal");
  });
});

describe("the lead page's Client proposal card", () => {
  const card = (canWrite: boolean) =>
    renderToStaticMarkup(
      createElement(LeadProposalsCard, {
        leadId: LEAD,
        read: { status: "ok", proposals: [] },
        canWrite,
        draftBlock: "no-ai",
        maxChars: 1000,
      }),
    );

  it("links New proposal straight to ?lead=<id> for someone who can write", () => {
    expect(card(true)).toMatch(new RegExp(`<a[^>]*href="/dashboard/proposals/new/?\\?lead=${LEAD}"[^>]*>New proposal</a>`));
  });

  it("has no New proposal link without write access", () => {
    expect(card(false)).not.toContain("New proposal");
  });
});

describe("the matter page's Client proposal card", () => {
  const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown }, role: "attorney", modules: [] as string[], modulesFail: false }));
  let db: FakeDb;

  async function render() {
    vi.resetModules();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: h.role })) }));
    vi.doMock("@/lib/org/modules", () => ({
      orgHasModule: vi.fn(async (mod: string) => {
        if (h.modulesFail && mod === "proposals") throw new Error("modules unreadable");
        return h.modules.includes(mod);
      }),
    }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
    vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
    vi.doMock("@/lib/voice/notes", async (orig) => ({ ...(await orig<typeof import("@/lib/voice/notes")>()), voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
    vi.doMock("@/lib/intake-forms/requests", () => ({
      canSendIntakeRequest: () => false,
      listMatterIntakeRequests: vi.fn(async () => ({ status: "ok", requests: [], formReady: false })),
    }));
    vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
    vi.doMock("@/components/meetings/LinkedMeetings", () => ({ LinkedMeetings: () => null }));
    vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: () => null }));
    vi.doMock("@/components/matters/IntakeRequestCard", () => ({ IntakeRequestCard: () => null }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: vi.fn() }));
    const page = await import("../../src/app/dashboard/matters/[id]/page");
    return renderToStaticMarkup(await page.default({ params: Promise.resolve({ id: "matter-1" }) }));
  }

  const link = /<a[^>]*href="\/dashboard\/proposals\/new\/?\?matter=matter-1"[^>]*>New proposal<\/a>/;

  beforeEach(() => {
    db = createFakeDb({ tables: standardSeed() });
    h.db = db;
    h.role = "attorney";
    h.modules = ["proposals"];
    h.modulesFail = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("module on and a role that may write proposals: a New proposal link to ?matter=<id>", async () => {
    const html = await render();
    expect(html).toMatch(link);
    expect(html).toContain("Client proposal");
  });

  it("module off: nothing", async () => {
    h.modules = [];
    expect(await render()).not.toContain("New proposal");
  });

  it("a role that can't write proposals: nothing", async () => {
    h.role = "viewer";
    db.role = "viewer";
    expect(await render()).not.toContain("New proposal");
  });

  it("a module state that can't be read: nothing (fails closed), and the page still renders", async () => {
    h.modulesFail = true;
    const html = await render();
    expect(html).not.toContain("New proposal");
    expect(html).toContain("Deadlines");
  });

  it("the card is only a link: it lists no proposals and draws no form", () => {
    const html = renderToStaticMarkup(createElement(MatterProposalCard, { matterId: "m&1" }));
    // Link may drop the trailing slash before the query (it does in tests); the id is encoded either way.
    expect(html).toMatch(/href="\/dashboard\/proposals\/new\/?\?matter=m%261"/);
    expect(html).not.toContain("<form");
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
