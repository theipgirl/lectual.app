import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ProposalListItem } from "@/lib/proposals/store";

/**
 * The proposals list (B5.2): chips and pills use the firm's statuses
 * (Draft / Sent / Accepted / Expired / Blocked, Closed under All), counts come
 * from the unfiltered set, and a failed load is never an empty list.
 */

function item(id: string, over: Partial<ProposalListItem> = {}): ProposalListItem {
  return {
    id,
    family_id: id,
    version: 1,
    client_name: `Client ${id}`,
    title: "Trademark Proposal",
    status: "draft",
    source: "manual",
    expires_on: "2026-11-30",
    lead_id: null,
    matter_id: null,
    approved_at: null,
    sent_at: null,
    accepted_at: null,
    updated_at: "2026-10-19T12:00:00Z",
    legal_total_cents: 495_000,
    gov_total_cents: 70_000,
    blocking_issue: null,
    ...over,
  };
}

const ROWS: ProposalListItem[] = [
  item("a1"),
  item("a2", { status: "approved" }),
  item("b1", { blocking_issue: "Add the pay link before approving." }),
  item("s1", { status: "sent", expires_on: "2026-10-30" }),
  item("e1", { status: "sent", expires_on: "2026-10-10" }),
  item("e2", { status: "sent", expires_on: "2026-10-19" }),
  item("c1", { status: "accepted" }),
  item("x1", { status: "withdrawn" }),
];

type Opts = { rows?: ProposalListItem[] | "fail"; role?: string | null; leads?: unknown; block?: string | null };

async function render(search: { status?: string } = {}, opts: Opts = {}) {
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
  vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => (opts.role === undefined ? "owner" : opts.role)) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/proposals/store", () => ({
    listProposals: vi.fn(async () => {
      if (opts.rows === "fail") throw new Error("db down");
      return opts.rows ?? ROWS;
    }),
  }));
  vi.doMock("@/lib/proposals/lead-options", () => ({
    loadLeadOptions: vi.fn(async () => opts.leads ?? { status: "ok", leads: [{ id: "lead-1", label: "Ana Ruiz" }] }),
  }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: vi.fn(async () => opts.block ?? null) }));
  vi.doMock("@/app/dashboard/proposals/transcript-actions", () => ({ draftProposalFromUploadAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve(search) })));
}

const chips = (html: string) => {
  const nav = html.slice(html.indexOf('aria-label="Filter proposals by status"'));
  const end = nav.indexOf("</nav>");
  return [...nav.slice(0, end).matchAll(/<a [^>]*>([^<]*)<span class="lx-chip-count">(\d+)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`);
};

describe("proposals list page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T16:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows the firm's statuses as chips, with counts from the unfiltered set, and no empty chip", async () => {
    const html = await render();
    expect(chips(html)).toEqual(["All:8", "Draft:2", "Sent:1", "Accepted:1", "Expired:2", "Blocked:1"]);
    expect(html).not.toContain(">Approved<");
    expect(html).not.toContain(">Withdrawn<");
  });

  it("drops a chip with no rows", async () => {
    const html = await render({}, { rows: [item("a1"), item("c1", { status: "accepted" })] });
    expect(chips(html)).toEqual(["All:2", "Draft:1", "Accepted:1"]);
  });

  it("?status=expired lists only expired rows and leaves the counts alone", async () => {
    const html = await render({ status: "expired" });
    expect(html).toContain("Client e1");
    expect(html).toContain("Client e2");
    for (const other of ["a1", "a2", "b1", "s1", "c1", "x1"]) expect(html).not.toContain(`Client ${other}<`);
    expect(chips(html)).toEqual(["All:8", "Draft:2", "Sent:1", "Accepted:1", "Expired:2", "Blocked:1"]);
    expect(html).toMatch(/aria-current="page"[^>]*>Expired/);
  });

  it("a sent row past its expiry shows an Expired pill; one open through today stays Sent", async () => {
    const html = await render();
    const rowOf = (name: string) => html.slice(html.indexOf(`Client ${name}<`), html.indexOf("</tr>", html.indexOf(`Client ${name}<`)));
    expect(rowOf("e1")).toContain("lx-pill-warn");
    expect(rowOf("e1")).toContain("Expired");
    expect(rowOf("s1")).toContain("lx-pill-ok");
    expect(rowOf("s1")).toContain(">Sent<");
    expect(rowOf("b1")).toContain("lx-pill-risk");
    expect(rowOf("b1")).toContain("Add the pay link before approving.");
    expect(rowOf("a2")).toContain("approved, ready to send");
    expect(rowOf("a2")).toContain("lx-pill-mute");
  });

  it("lists Closed rows under All, with a mute pill, but not as a chip", async () => {
    const html = await render();
    const row = html.slice(html.indexOf("Client x1<"));
    expect(row).toContain(">Closed<");
    expect(chips(html).some((c) => c.startsWith("Closed"))).toBe(false);
  });

  it("shows the Closed chip only while on that filter; old stored values map onto display keys", async () => {
    expect(chips(await render({ status: "closed" }))).toContain("Closed:1");
    const legacy = await render({ status: "approved" });
    expect(legacy).toContain("Client a1");
    expect(legacy).toContain("Client a2");
    expect(legacy).not.toContain("Client c1<");
    expect(chips(await render({ status: "withdrawn" }))).toContain("Closed:1");
  });

  it("a failed load says Proposals couldn't be loaded, with no chips and no empty-state wording", async () => {
    const html = await render({}, { rows: "fail" });
    expect(html).toContain("Proposals couldn&#x27;t be loaded");
    expect(html).not.toContain("Filter proposals by status");
    expect(html).not.toContain("No proposals yet");
  });

  it("an empty list reads as empty only when the read worked", async () => {
    const html = await render({}, { rows: [] });
    expect(html).toContain("No proposals yet");
    expect(html).not.toContain("Filter proposals by status");
  });
});

describe("Draft from a transcript on the proposals page", () => {
  beforeEach(() => vi.resetModules());

  it("offers a lead picker, a paste box and a file input to a staff role", async () => {
    const html = await render();
    expect(html).toContain("Draft from a transcript");
    expect(html).toContain('name="leadId"');
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("<textarea");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".txt,.vtt,.srt,.docx"');
  });

  it("says the leads couldn't be loaded, and does not offer the form, when the read fails", async () => {
    const html = await render({}, { leads: { status: "unavailable" } });
    expect(html).toContain("The leads couldn&#x27;t be loaded");
    expect(html).not.toContain('name="leadId"');
    expect(html).not.toContain("No leads");
  });

  it("explains why drafting is unavailable instead of offering a form that would be refused", async () => {
    const html = await render({}, { block: "no-ai" });
    expect(html).toContain("AI key");
    expect(html).not.toContain('name="leadId"');
  });

  it("is not offered to a role that can't write proposals", async () => {
    const html = await render({}, { role: "viewer" });
    expect(html).not.toContain("Draft from a transcript");
  });
});
