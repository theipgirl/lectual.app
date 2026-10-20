import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";

vi.mock("@/app/dashboard/proposals/transcript-actions", () => ({ draftProposalFromMeetingAction: vi.fn(), draftProposalFromUploadAction: vi.fn() }));

import { ConsultsStrip } from "@/components/proposal-list/ConsultsStrip";
import type { ConsultRowView, ConsultsStripData } from "@/lib/proposals/consults-load";

/**
 * The consults strip (Sprint 6, B4/B5): each row state's pill and call to action, the header's
 * connection line, and the three states of the list (rows / none in 14 days / couldn't load).
 */

const MEETING = "44444444-4444-4444-8444-444444444444";

const row = (over: Partial<ConsultRowView> = {}): ConsultRowView => ({
  id: MEETING,
  provider: "zoom",
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
    expect(html).toContain(">Transcribing<");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Not ready<\/button>/);
    expect(html).not.toContain("Draft the proposal");
  });

  it("Transcript ready: the primary 'Draft the proposal', a form that posts only the meeting's id", () => {
    const html = render(data([row()]));
    expect(html).toContain(">Transcript ready<");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*class="lx-btn lx-btn-pri"[^>]*>Draft the proposal<\/button>|<button[^>]*class="lx-btn lx-btn-pri"[^>]*type="submit"[^>]*>Draft the proposal<\/button>/);
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    expect(form).toContain(`name="meetingId" value="${MEETING}"`);
    expect([...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).filter((n) => !n.startsWith("$ACTION"))).toEqual(["meetingId"]);
  });

  it("Drafted: 'Open the draft' linking to the proposal", () => {
    const html = render(data([row({ state: "drafted", proposalId: "p-77" })]));
    expect(html).toContain(">Drafted<");
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/proposals\/p-77\/?"[^>]*>Open the draft<\/a>/);
    expect(html).not.toContain("Draft the proposal");
  });

  it("Drafted with no proposal id falls back to the lead page, never a dead link", () => {
    const html = render(data([row({ state: "drafted", proposalId: null })]));
    expect(html).toMatch(/href="\/dashboard\/leads\/lead-1\/?"[^>]*>Open the draft/);
  });

  it("Unlinked: 'Link a lead first' linking to the meeting", () => {
    const html = render(data([row({ state: "unlinked", leadId: null, company: null })]));
    expect(html).toContain(">Not linked<");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/dashboard/meetings/${MEETING}/?"[^>]*>Link a lead first</a>`));
  });

  it("a role that can't draft sees the pill but no Draft button", () => {
    const html = render(data([row()]), { canDraft: false });
    expect(html).toContain(">Transcript ready<");
    expect(html).not.toContain("Draft the proposal");
  });

  it("when drafting is unavailable the button is disabled and says why", () => {
    const html = render(data([row()]), { draftNote: "No approval queue is connected." });
    expect(html).toMatch(/<button[^>]*disabled[^>]*title="No approval queue is connected\."[^>]*>Draft the proposal<\/button>|<button[^>]*title="No approval queue is connected\."[^>]*disabled[^>]*>Draft the proposal<\/button>/);
    expect(html).not.toContain('name="meetingId"');
  });

  it("shows the client, the company and the design's line", () => {
    const html = render(data([row()]));
    expect(html).toContain("Sana Okafor");
    expect(html).toContain("Northbound Supply");
    expect(html).toContain("Zoom consult · yesterday · 28 min · transcript synced");
  });
});

describe("the list's three states", () => {
  it("a failed meetings read says Couldn't load consults, never an empty strip", () => {
    const html = render(data([], { meetings: { status: "unavailable" } }));
    expect(html).toContain("Couldn&#x27;t load consults");
    expect(html).not.toContain("No consults in the last");
    expect(html).not.toContain("pq-rows");
  });

  it("no meetings in 14 days says so", () => {
    const html = render(data([]));
    expect(html).toContain("No consults in the last 14 days");
    expect(html).not.toContain("Couldn&#x27;t load consults");
  });

  it("more than five shows how many more, linking to Meetings", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `m${i}`, clientName: `Client ${i}` }));
    const html = render(data(rows, {}, 3));
    expect(html.match(/class="pq-row"/g)).toHaveLength(5);
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/meetings\/?"[^>]*>3 more<\/a>/);
  });

  it("no 'more' link when there are five or fewer", () => {
    expect(render(data([row()]))).not.toContain(" more<");
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
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("Paste or upload a transcript");
    expect(summary).toContain("Zoom consults");
    expect(html.slice(html.indexOf("</summary>"))).toContain('id="paste-form"');
  });

  it("is absent without the form (a role that can't draft)", () => {
    const html = render(data([row()]), { paste: null });
    expect(html).not.toContain("Paste or upload a transcript");
    expect(html).not.toContain("<details");
  });
});
