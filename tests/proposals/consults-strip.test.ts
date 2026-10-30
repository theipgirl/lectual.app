import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";

vi.mock("@/app/dashboard/proposals/transcript-actions", () => ({ draftProposalFromMeetingAction: vi.fn(), draftProposalFromUploadAction: vi.fn() }));

import { ConsultsStrip } from "@/components/proposal-list/ConsultsStrip";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isListedMeeting, meetingBackHref, meetingRowHref } from "@/lib/proposals/consult-row";
import type { ConsultRowView, ConsultsStripData } from "@/lib/proposals/consults-load";

/**
 * The consults strip (Sprint 6, B4/B5): each row state's pill and call to action, the header's
 * connection line, and the three states of the list (rows / none in 14 days / couldn't load).
 */

const MEETING = "44444444-4444-4444-8444-444444444444";

const row = (over: Partial<ConsultRowView> = {}): ConsultRowView => ({
  id: MEETING,
  provider: "zoom",
  title: "Sana consult",
  whenLabel: "Oct 20, 10:00 AM",
  linkedTo: "Sana Okafor",
  clientName: "Sana Okafor",
  company: "Northbound Supply",
  line: "Zoom consult · yesterday · 28 min · transcript synced",
  state: "ready",
  proposalId: null,
  leadId: "lead-1",
  ...over,
});
const data = (rows: ConsultRowView[], over: Partial<ConsultsStripData> = {}, more = 0): ConsultsStripData => ({
  header: { title: "Zoom consults", status: { kind: "connected", text: "connected · last sync 6 min ago" } },
  meetings: { status: "ok", rows, more },
  ...over,
});
const render = (d: ConsultsStripData, props: { canDraft?: boolean; draftNote?: string | null; paste?: ReactNode | null } = {}) =>
  renderToStaticMarkup(createElement(ConsultsStrip, { data: d, canDraft: props.canDraft ?? true, draftNote: props.draftNote ?? null, paste: props.paste ?? null }));

describe("each row's pill and call to action", () => {
  it("Transcribing: a disabled 'Not ready'", () => {
    const html = render(data([row({ state: "transcribing", line: "Zoom consult · Monday · 52 min · transcribing" })]));
    expect(html).toContain(">Transcript still processing<");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Not ready<\/button>/);
    expect(html).not.toContain("Draft the proposal");
  });

  it("Transcript ready: the primary 'Draft the proposal', a form that posts only the meeting's id", () => {
    const html = render(data([row()]));
    expect(html).toContain(">Ready to draft<");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*class="lx-btn lx-btn-pri"[^>]*>Draft the proposal<\/button>|<button[^>]*class="lx-btn lx-btn-pri"[^>]*type="submit"[^>]*>Draft the proposal<\/button>/);
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    expect(form).toContain(`name="meetingId" value="${MEETING}"`);
    expect([...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).filter((n) => !n.startsWith("$ACTION"))).toEqual(["meetingId"]);
  });

  it("Drafted: 'Open the draft' linking to the proposal", () => {
    const html = render(data([row({ state: "drafted", proposalId: "p-77" })]));
    expect(html).toContain(">Proposal created<");
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/proposals\/p-77\/?"[^>]*>Open the draft<\/a>/);
    expect(html).not.toContain("Draft the proposal");
  });

  it("Drafted with no proposal id falls back to the lead page, never a dead link", () => {
    const html = render(data([row({ state: "drafted", proposalId: null })]));
    expect(html).toMatch(/href="\/dashboard\/leads\/lead-1\/?"[^>]*>Open the draft/);
  });

  it("Unlinked: 'Link to a lead' linking to the meeting (a role that can't link)", () => {
    const html = render(data([row({ state: "unlinked", leadId: null, company: null })]));
    expect(html).toContain(">Not linked<");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/dashboard/meetings/${MEETING}/?"[^>]*>Link to a lead</a>`));
  });

  it("a role that can't draft sees the pill but no Draft button", () => {
    const html = render(data([row()]), { canDraft: false });
    expect(html).toContain(">Ready to draft<");
    expect(html).not.toContain("Draft the proposal");
  });

  it("when drafting is unavailable the button is disabled and says why", () => {
    const html = render(data([row()]), { draftNote: "No approval queue is connected." });
    expect(html).toMatch(/<button[^>]*disabled[^>]*title="No approval queue is connected\."[^>]*>Draft the proposal<\/button>|<button[^>]*title="No approval queue is connected\."[^>]*disabled[^>]*>Draft the proposal<\/button>/);
    expect(html).not.toContain('name="meetingId"');
  });

  it("shows the title, when, provider and who it is linked to", () => {
    const html = render(data([row()]));
    expect(html).toContain("Sana consult");
    expect(html).toContain("Oct 20, 10:00 AM · Zoom · Linked to Sana Okafor");
  });
});

describe("the list's three states", () => {
  it("a failed meetings read says it can't show meetings, never an empty list", () => {
    const html = render(data([], { meetings: { status: "unavailable" } }));
    expect(html).toContain("Can&#x27;t show meetings right now. Refresh to try again.");
    expect(html).not.toContain("No consults or client meetings yet.");
    expect(html).not.toContain("pq-rows");
  });

  it("a read that worked and found nothing says so", () => {
    const html = render(data([]));
    expect(html).toContain("No consults or client meetings yet.");
    expect(html).not.toContain("Can&#x27;t show meetings");
  });

  it("a capped list says it shows the newest N, linking to Meetings", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `m${i}`, title: `Client ${i}` }));
    const html = render(data(rows, {}, 3));
    expect(html.match(/class="pq-row"/g)).toHaveLength(5);
    expect(html).toContain("Showing the newest 5.");
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/meetings\/?"[^>]*>See all in Meetings<\/a>/);
  });

  it("no cap note when nothing was cut off", () => {
    expect(render(data([row()]))).not.toContain("Showing the newest");
  });
});

describe("the header", () => {
  const head = (header: ConsultsStripData["header"]) => render(data([], { header }));

  it("connected: provider title and the last sync", () => {
    const html = head({ title: "Zoom consults", status: { kind: "connected", text: "connected · last sync 6 min ago" } });
    expect(html).toContain("Zoom consults");
    expect(html).toContain("connected · last sync 6 min ago");
  });

  it("not connected: says so, with a link to Settings -> Integrations -> Meetings", () => {
    const html = head({ title: "Consults", status: { kind: "none", text: "not connected" } });
    expect(html).toContain("not connected");
    expect(html).toMatch(/href="\/dashboard\/settings\/integrations\/meetings\/?"/);
  });

  it("needs reconnecting is distinct, and links to the same place", () => {
    const html = head({ title: "Zoom consults", status: { kind: "reauth", text: "Zoom needs reconnecting" } });
    expect(html).toContain("Zoom needs reconnecting");
    expect(html).toContain('data-status="reauth"');
    expect(html).toMatch(/href="\/dashboard\/settings\/integrations\/meetings\/?"[^>]*>Reconnect</);
  });

  it("a failed connections read says the status couldn't be loaded, not 'not connected'", () => {
    const html = head({ title: "Consults", status: { kind: "unavailable", text: "connection status couldn't be loaded" } });
    expect(html).toContain("connection status couldn&#x27;t be loaded");
    expect(html).not.toContain("not connected");
  });
});

describe("Paste or upload a transcript", () => {
  beforeEach(() => vi.resetModules());

  it("is a disclosure in the header that holds the form, so it opens on the same page", () => {
    const html = render(data([row()]), { paste: createElement("form", { id: "paste-form" }, createElement("textarea", { name: "transcript" })) });
    expect(html).toContain('<details class="pq-paste">');
    expect(html).toContain("Paste or upload a transcript");
    const paste = html.slice(html.indexOf('<details class="pq-paste">'));
    const summary = paste.slice(paste.indexOf("<summary"), paste.indexOf("</summary>"));
    expect(summary).toContain("Paste or upload a transcript");
    expect(summary).toContain("Zoom consults");
    expect(html.slice(html.indexOf("</summary>"))).toContain('id="paste-form"');
  });

  it("is absent without the form (a role that can't draft)", () => {
    const html = render(data([row()]), { paste: null });
    expect(html).not.toContain("Paste or upload a transcript");
    expect(html).not.toContain("pq-paste");
  });
});

describe("Consults and client meetings (Spec 8)", () => {
  it("is an always-open section: a heading and a scroll box, no collapsed details", () => {
    const html = render(data([row()]));
    expect(html).toContain("Consults and client meetings</h2>");
    expect(html).toContain("pq-rows-scroll");
    expect(html).not.toContain("pq-strip");
    expect(html).not.toMatch(/<details class="pq-strip/);
  });

  it("each row's main area links to exactly /dashboard/meetings/<id>/?from=proposals", () => {
    const html = render(data([row()]));
    expect(html).toContain(`href="/dashboard/meetings/${MEETING}/?from=proposals"`);
    expect(meetingRowHref("a b/c")).toBe("/dashboard/meetings/a%20b%2Fc/?from=proposals");
  });

  it("the quick buttons are siblings of the link, never inside the <a>", () => {
    const html = render(data([row(), row({ id: "55555555-5555-4555-8555-555555555555", state: "unlinked", leadId: null, linkedTo: null })]), { paste: null });
    const rowsHtml = html.split('<li class="pq-row"').slice(1);
    expect(rowsHtml).toHaveLength(2);
    for (const li of rowsHtml) {
      const link = li.slice(li.indexOf('<a class="pq-row-link"'), li.indexOf("</a>"));
      expect(link).not.toMatch(/<button|<form|<details|<select/);
      expect(li.slice(li.indexOf("</a>"))).toMatch(/pq-row-actions/);
    }
    expect(rowsHtml[0].slice(rowsHtml[0].indexOf("</a>"))).toContain("Draft the proposal");
  });

  it("an unlinked row reads 'Not linked' and offers the Link to a lead picker next to the link", () => {
    const html = render(data([row({ state: "unlinked", leadId: null, linkedTo: null })]));
    expect(html).toContain("Zoom · Not linked");
    expect(html.slice(html.indexOf("</a>"))).toContain("Link to a lead");
  });
});

describe("which meetings are listed, and the meeting page's back link", () => {
  it("a consult title, or a link to a lead or matter; nothing else", () => {
    expect(isListedMeeting({ title: "Discovery Call - Pat", leadId: null, matterId: null })).toBe(true);
    expect(isListedMeeting({ title: "Initial call", leadId: null, matterId: null })).toBe(true);
    expect(isListedMeeting({ title: "Weekly sync", leadId: "l1", matterId: null })).toBe(true);
    expect(isListedMeeting({ title: "Weekly sync", leadId: null, matterId: "m1" })).toBe(true);
    expect(isListedMeeting({ title: "Team standup", leadId: null, matterId: null })).toBe(false);
    expect(isListedMeeting({ title: null, leadId: null, matterId: null })).toBe(false);
  });

  it("the back link shows only for the exact value 'proposals'", () => {
    expect(meetingBackHref("proposals")).toBe("/dashboard/proposals/");
    for (const v of [undefined, "", "Proposals", "proposals ", "leads", "https://evil.example", "/dashboard/leads/", "proposals/../x"]) expect(meetingBackHref(v)).toBeNull();
    expect(meetingBackHref(["leads", "proposals"])).toBeNull();
    expect(meetingBackHref(["proposals", "leads"])).toBe("/dashboard/proposals/");
  });

  it("the meeting page builds the link from meetingBackHref only", () => {
    const src = readFileSync(path.join(__dirname, "../../src/app/dashboard/meetings/[id]/page.tsx"), "utf8");
    expect(src).toContain("meetingBackHref((await searchParams)?.from)");
    expect(src).toContain("← Back to Proposals");
    expect(src).not.toMatch(/href=\{[^}]*searchParams/);
  });
});
