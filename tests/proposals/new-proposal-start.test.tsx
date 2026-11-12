import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { consultDoorState, copilotHref, isStartScreen, startDoors, type DoorProposal } from "@/lib/proposals/start-screen";
import { copilotRequest, START_DOORS } from "@/lib/proposal-editor/vocabulary";

/**
 * Sprint 3 F5, D3, D4, Q4, Q5: the start screen at /dashboard/proposals/new/ with its three doors, each shown only
 * when its own feature is on, and every read three-state.
 */

type Row = { id: string; provider: "zoom" | "fathom"; title: string; whenLabel: string; linkedTo: string | null; clientName: string; company: string | null; line: string; state: "ready" | "drafted" | "transcribing" | "unlinked"; proposalId: string | null; leadId: string | null };
const ROW: Row = { id: "33333333-3333-4333-8333-333333333333", provider: "zoom", title: "Strategy session: Ana Ruiz", whenLabel: "Nov 10, 2:00 PM", linkedTo: "Ana Ruiz", clientName: "Ana Ruiz", company: null, line: "x", state: "ready", proposalId: null, leadId: "l1" };

type Opts = {
  role?: string | null;
  ai?: boolean;
  connections?: "none" | "connected" | "error";
  strip?: "ok" | "empty" | "unavailable" | "throws";
  search?: Record<string, string>;
  /** The lead the scoped client finds, for a page opened with ?lead=. */
  lead?: Record<string, unknown>;
  /** The firm's proposals read: the rows, or a failure (the store throws). */
  proposals?: "fails" | Array<Record<string, unknown>>;
};

const h = vi.hoisted(() => ({ listLeads: vi.fn(), listMatters: vi.fn(), listConnections: vi.fn(), loadStrip: vi.fn(), scoped: vi.fn() }));

async function render(opts: Opts = {}) {
  vi.resetModules();
  Object.values(h).forEach((f) => f.mockReset());
  h.listLeads.mockResolvedValue([]);
  h.listMatters.mockResolvedValue([]);
  h.scoped.mockResolvedValue({ from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: opts.lead ?? null, error: null }) }; return q; } });
  h.listConnections.mockImplementation(async () => {
    if (opts.connections === "error") return { ok: false };
    return { ok: true, connections: opts.connections === "none" ? [] : [{ provider: "zoom", status: "active", last_import_at: "2026-11-10T12:00:00Z" }] };
  });
  h.loadStrip.mockImplementation(async () => {
    if (opts.strip === "throws") throw new Error("boom");
    const header = { title: "Zoom consults", status: { kind: "connected", text: "connected" } };
    if (opts.strip === "unavailable") return { header, meetings: { status: "unavailable" } };
    return { header, meetings: { status: "ok", rows: opts.strip === "empty" ? [] : [ROW], more: 0 } };
  });
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
  vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => (opts.role === undefined ? "intake" : opts.role)) }));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => opts.ai !== false }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: h.scoped }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/proposals/store", () => ({
    listProposals: vi.fn(async () => {
      if (opts.proposals === "fails") throw new Error("Can't show this right now.");
      return opts.proposals ?? [];
    }),
    getProposalSettings: vi.fn(async () => null),
  }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: vi.fn(async () => null) }));
  vi.doMock("@/lib/meetings/connection", () => ({ listMeetingConnections: h.listConnections }));
  vi.doMock("@/lib/proposals/consults-load", () => ({ loadConsultsStrip: h.loadStrip }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: vi.fn(async () => ({ status: "ok", leads: [{ id: "l1", label: "Ana Ruiz" }] })) }));
  vi.doMock("@/lib/proposals/consult-prefill-load", () => ({ loadConsultForPrefill: vi.fn() }));
  vi.doMock("@/lib/pipeline", () => ({ listLeads: h.listLeads }));
  vi.doMock("@/lib/matters", () => ({ listMatters: h.listMatters }));
  vi.doMock("@/app/dashboard/proposals/actions", () => ({ createProposalAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/new/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve(opts.search ?? {}) })));
}

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const doors = (html: string) => [...html.matchAll(/data-door="(\w+)"/g)].map((m) => m[1]);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

beforeEach(() => vi.resetModules());

describe("F5: the three doors", () => {
  it("with every feature on there are exactly three doors, in order, each with a title and one sentence", async () => {
    const html = await render();
    expect(doors(html)).toEqual(["consult", "copilot", "scratch"]);
    expect(html.match(/<h2[^>]*class="pe-h"/g)).toHaveLength(3);
    for (const door of ["consult", "copilot", "scratch"] as const) expect(text(html)).toContain(START_DOORS[door].title);
    expect(text(html)).toContain(START_DOORS.copilot.body);
    expect(text(html)).toContain(START_DOORS.scratch.body);
  });

  it("From a consult lists the recent consults with 'Draft the proposal' (the existing consult drafter)", async () => {
    const html = await render();
    expect(text(html)).toContain("Strategy session: Ana Ruiz");
    expect(html).toContain("Draft the proposal");
    expect(html).toContain(`name="meetingId" value="${ROW.id}"`);
  });

  it("with Copilot off there are two doors and no /dashboard/copilot link at all", async () => {
    const html = await render({ ai: false });
    expect(doors(html)).toEqual(["consult", "scratch"]);
    expect(html).not.toContain("/dashboard/copilot");
    expect(html).not.toContain("Ask Copilot");
  });

  it("with no meetings feature the consult door explains what is needed and renders no consult rows", async () => {
    const html = await render({ connections: "none" });
    expect(doors(html)).toEqual(["consult", "copilot", "scratch"]);
    expect(text(html)).toContain(START_DOORS.consult.notReady);
    expect(hrefs(html).some((x) => /^\/dashboard\/settings\/integrations\/meetings\/?$/.test(x))).toBe(true);
    expect(html).not.toContain("Draft the proposal");
    expect(html).not.toContain("pq-row");
    expect(h.loadStrip).not.toHaveBeenCalled();
  });

  it("a failed consults read says it could not be loaded, never 'no consults'", async () => {
    for (const strip of ["unavailable", "throws"] as const) {
      const html = await render({ strip });
      expect(text(html)).toContain(START_DOORS.consult.couldntLoad);
      expect(text(html)).not.toMatch(/No consults/);
      expect(html).not.toContain("pq-row");
    }
    const unreadable = await render({ connections: "error", strip: "unavailable" });
    expect(text(unreadable)).toContain(START_DOORS.consult.couldntLoad);
  });

  it("review item 8: a failed read of the firm's PROPOSALS is the door's couldn't-load state, with no rows and no 'Draft the proposal'", async () => {
    const html = await render({ proposals: "fails" });
    expect(doors(html)).toEqual(["consult", "copilot", "scratch"]);
    expect(text(html)).toContain(START_DOORS.consult.couldntLoad);
    // A consult that already has a proposal must not read as ready to draft, so nothing is listed at all.
    expect(html).not.toContain("Draft the proposal");
    expect(html).not.toContain("pq-row");
    expect(html).not.toContain(`name="meetingId"`);
    expect(text(html)).not.toMatch(/No consults/);
    // The meetings were never read on top of a failed proposals read.
    expect(h.loadStrip).not.toHaveBeenCalled();
  });

  it("review item 8: when the proposals read works, its rows are what the consult rows are judged against", async () => {
    const rows = [{ id: "p1", lead_id: "l1", created_at: "2026-11-10T20:00:00Z", source: "agent" }];
    await render({ proposals: rows });
    expect(h.loadStrip).toHaveBeenCalledTimes(1);
    expect(h.loadStrip.mock.calls[0][0].proposals).toEqual([{ id: "p1", leadId: "l1", createdAt: "2026-11-10T20:00:00Z", source: "agent" }]);
  });

  it("a read that worked and found nothing says so (and only then)", async () => {
    const html = await render({ strip: "empty" });
    expect(text(html)).toContain("No consults or client meetings yet.");
  });

  it("each door is gated on its own, and a role that can't write proposals sees no door at all", async () => {
    expect(startDoors({ canWrite: true, aiOn: true })).toEqual(["consult", "copilot", "scratch"]);
    expect(startDoors({ canWrite: true, aiOn: false })).toEqual(["consult", "scratch"]);
    expect(startDoors({ canWrite: false, aiOn: true })).toEqual([]);
    const html = await render({ role: "viewer" });
    expect(doors(html)).toEqual([]);
    expect(html).not.toContain("/dashboard/copilot");
    expect(html).not.toContain("door=scratch");
    expect(text(html)).toContain("Your role can't start proposals");
  });

  it("Start from scratch leads to 'Who is this for?' (door=scratch), whose picker and Start blank are there", async () => {
    const start = await render();
    expect(hrefs(start).some((x) => /^\/dashboard\/proposals\/new\/?\?door=scratch$/.test(x))).toBe(true);
    h.listLeads.mockResolvedValue([]);
    const picker = await render({ search: { door: "scratch" } });
    expect(picker).toContain("Who is this for?");
    expect(picker).toContain("Start blank");
    expect(doors(picker)).toEqual([]);
  });
});

describe("which URLs are the start screen", () => {
  it("only one with no lead, matter, blank, door, kind, q or type", () => {
    expect(isStartScreen({})).toBe(true);
    expect(isStartScreen({ lead: undefined, matter: "", blank: "", door: "" })).toBe(true);
    for (const k of ["lead", "matter", "blank", "door", "kind", "q", "type"]) expect(isStartScreen({ [k]: "x" })).toBe(false);
    expect(isStartScreen({ lead: ["a"] })).toBe(false);
  });
});

describe("D3: the Ask Copilot door's link", () => {
  it("carries a request typed in (URL-encoded), never sent, with the lead's name when one is chosen", () => {
    expect(copilotHref(null)).toBe(`/dashboard/copilot/?q=${encodeURIComponent("Draft a proposal")}`);
    expect(copilotHref("Ana Ruiz & Co")).toBe(`/dashboard/copilot/?q=${encodeURIComponent("Draft a proposal for Ana Ruiz & Co")}`);
    expect(copilotHref("Ana Ruiz & Co")).toContain("%26");
    expect(copilotRequest("  ")).toBe("Draft a proposal");
  });

  it("the link never contains a price", async () => {
    const urls = [copilotHref(null), copilotHref("Ana Ruiz")];
    for (const url of urls) expect(decodeURIComponent(url)).not.toMatch(/\$|\d|price|cents|fee|discount/i);
    expect(hrefs(await render()).filter((x) => x.includes("/dashboard/copilot/"))).toEqual([copilotHref(null)]);
  });

  it("a chosen lead's page offers Copilot with that lead's name, only when Copilot is on", async () => {
    const lead = { id: "11111111-1111-4111-8111-111111111111", first_name: "Ana", last_name: "Ruiz", business_name: null, email: "a@example.com", mark_text: null };
    const on = await render({ search: { lead: lead.id }, lead });
    expect(hrefs(on)).toContain(copilotHref("Ana Ruiz"));
    const off = await render({ search: { lead: lead.id }, lead, ai: false });
    expect(off).not.toContain("/dashboard/copilot");
  });
});

describe("D4: the doors lead somewhere real", () => {
  it("a picker row creates the draft in one step (a form posting the lead id), and 'Draft the proposal' posts the meeting id to the consult drafter", async () => {
    h.listLeads.mockResolvedValue([]);
    const start = await render();
    expect(start).toContain('name="meetingId"');
    const picker = await render({ search: { door: "scratch" } });
    expect(picker).not.toContain("meetingId");
  });
});

describe("Q4: nothing here sends, queues, approves or reads with the service role", () => {
  it("the page, the doors and the start rules import none of them", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/app/dashboard/proposals/new/page.tsx", "src/components/proposal-editor/StartDoors.tsx", "src/components/proposal-editor/StartDraft.tsx", "src/lib/proposals/start-screen.ts", "src/lib/proposals/start-subject.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/db\/admin|getAdminClient|sendMail|resolveQueueItem|sendProposal|approveProposal|dangerouslySetInnerHTML/);
    }
    const page = readFileSync("src/app/dashboard/proposals/new/page.tsx", "utf8");
    expect(page).toContain("requireProposalsModule()");
    expect(page).toContain("aiConfigured()");
  });
});

describe("review item 8: consultDoorState is three-state on every read", () => {
  const strip = { header: { title: "Zoom consults", status: { kind: "connected", text: "connected" } }, meetings: { status: "ok", rows: [], more: 0 } } as never;
  const reads = (over: Partial<Parameters<typeof consultDoorState>[0]> = {}) => ({
    notConnected: vi.fn(async () => false),
    proposals: vi.fn(async (): Promise<DoorProposal[]> => []),
    strip: vi.fn(async () => strip),
    ...over,
  });

  it("ok: the rows, built on the proposals that were read", async () => {
    const mine: DoorProposal[] = [{ id: "p1", leadId: "l1", createdAt: "2026-11-10T20:00:00Z", source: "agent" }];
    const r = reads({ proposals: vi.fn(async () => mine) });
    expect(await consultDoorState(r)).toEqual({ kind: "ok", data: strip });
    expect(r.strip).toHaveBeenCalledWith(mine);
  });

  it("not connected: says what is needed and reads nothing else", async () => {
    const r = reads({ notConnected: vi.fn(async () => true) });
    expect(await consultDoorState(r)).toEqual({ kind: "not-connected" });
    expect(r.proposals).not.toHaveBeenCalled();
    expect(r.strip).not.toHaveBeenCalled();
  });

  it("a failed proposals read is unavailable, NEVER an empty list handed to the rows", async () => {
    const r = reads({
      proposals: vi.fn(async (): Promise<DoorProposal[]> => {
        throw new Error("db down");
      }),
    });
    expect(await consultDoorState(r)).toEqual({ kind: "unavailable" });
    expect(r.strip).not.toHaveBeenCalled();
  });

  it("a failed meetings read, a throwing strip and a throwing connection check are unavailable too", async () => {
    expect(await consultDoorState(reads({ strip: vi.fn(async () => ({ header: {}, meetings: { status: "unavailable" } }) as never) }))).toEqual({ kind: "unavailable" });
    expect(
      await consultDoorState(
        reads({
          strip: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
      ),
    ).toEqual({ kind: "unavailable" });
    expect(
      await consultDoorState(
        reads({
          notConnected: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
      ),
    ).toEqual({ kind: "unavailable" });
  });

  it("the page no longer turns a failed proposals read into an empty list", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/dashboard/proposals/new/page.tsx", "utf8");
    const fn = src.slice(src.indexOf("function readConsultDoor"), src.indexOf("function Back()"));
    expect(fn).toContain("consultDoorState({");
    expect(fn).not.toMatch(/\(\) => \[\]/);
    expect(fn).not.toMatch(/\.then\(/);
    expect(fn).not.toMatch(/catch/);
  });
});
