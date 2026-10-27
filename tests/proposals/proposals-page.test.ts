import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { item, renderListPage as render, rowOf, segments } from "./list-page-harness";

/**
 * The proposals list's statuses (B5.2), as the Quotes & proposals page (Sprint 6) shows them:
 * the firm's statuses (Draft / Sent / Accepted / Expired / Blocked, Closed under Everything) in
 * the table's pills, the five segments with counts from the unfiltered set, and a failed load
 * that is never an empty list. Sprint 6 replaced the status chips with the segment column, so
 * the chip assertions here are changed deliberately (named in the commit): the same rows and
 * counts now read as segments. The page's own layout is tested in quotes-page.test.ts.
 */

const ALL_SEGMENTS = ["Everything:8", "Out with a client:1", "Drafts and blocked:3", "Accepted:1", "Expired:2"];

describe("proposals list page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T16:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows the five segments with counts from the unfiltered set, Closed under Everything only", async () => {
    const html = await render();
    expect(segments(html)).toEqual(ALL_SEGMENTS);
  });

  it("a segment with no rows is still listed, with a 0", async () => {
    const html = await render({}, { rows: [item("a1"), item("c1", { status: "accepted" })] });
    expect(segments(html)).toEqual(["Everything:2", "Out with a client:0", "Drafts and blocked:1", "Accepted:1", "Expired:0"]);
  });

  it("?segment=expired lists only expired rows and leaves the counts alone", async () => {
    const html = await render({ segment: "expired" });
    expect(html).toContain("Client e1");
    expect(html).toContain("Client e2");
    for (const other of ["a1", "a2", "b1", "s1", "c1", "x1"]) expect(html).not.toContain(`Client ${other}<`);
    expect(segments(html)).toEqual(ALL_SEGMENTS);
    expect(html).toMatch(/aria-current="page"[^>]*><span>Expired/);
  });

  it("a sent row past its expiry shows an Expired pill; one open through today stays Sent", async () => {
    const html = await render();
    expect(rowOf(html, "Client e1<")).toContain("lx-pill-warn");
    expect(rowOf(html, "Client e1<")).toContain(">Expired<");
    expect(rowOf(html, "Client s1<")).toContain("lx-pill-ok");
    expect(rowOf(html, "Client s1<")).toContain(">Link live<");
    expect(rowOf(html, "Client b1<")).toContain("lx-pill-risk");
    expect(rowOf(html, "Client b1<")).toContain("Add the pay link before creating the link.");
    expect(rowOf(html, "Client a2<")).toContain("saved, link not live");
    expect(rowOf(html, "Client a2<")).toContain("lx-pill-mute");
  });

  it("lists Closed rows under Everything, with a mute pill, and under no other segment", async () => {
    const html = await render();
    expect(rowOf(html, "Client x1<")).toContain(">Closed<");
    for (const seg of ["out", "drafts", "accepted", "expired"]) {
      expect(await render({ segment: seg })).not.toContain("Client x1<");
      vi.resetModules();
    }
  });

  it("an old ?status= link maps onto its segment", async () => {
    const draft = await render({ status: "draft" });
    expect(draft).toContain("Client a1");
    expect(draft).toContain("Client b1");
    expect(draft).not.toContain("Client c1<");
    expect(draft).toMatch(/aria-current="page"[^>]*><span>Drafts and blocked/);
    vi.resetModules();
    const approved = await render({ status: "approved" });
    expect(approved).toContain("Client a2");
    expect(approved).toMatch(/aria-current="page"[^>]*><span>Drafts and blocked/);
    vi.resetModules();
    const sent = await render({ status: "sent" });
    expect(sent).toContain("Client s1");
    expect(sent).not.toContain("Client e1<");
    vi.resetModules();
    const closed = await render({ status: "withdrawn" });
    expect(closed).toMatch(/aria-current="page"[^>]*><span>Everything/);
    expect(closed).toContain("Client x1");
  });

  it("a failed load says Proposals couldn't be loaded, with no counts and no empty-state wording", async () => {
    const html = await render({}, { rows: "fail" });
    expect(html).toContain("Proposals couldn&#x27;t be loaded");
    expect(segments(html)).toEqual(["Everything", "Out with a client", "Drafts and blocked", "Accepted", "Expired"]);
    expect(html).not.toContain("No proposals yet");
    expect(html).not.toContain("Nothing matches");
  });

  it("an empty list reads as empty only when the read worked", async () => {
    const html = await render({}, { rows: [] });
    expect(html).toContain("No proposals yet");
    expect(segments(html)[0]).toBe("Everything:0");
  });

  it("a segment with no rows says so, and points back to Everything", async () => {
    const html = await render({ segment: "accepted" }, { rows: [item("a1")] });
    expect(html).toContain("Nothing matches");
    expect(html).toContain("Every proposal is still under Everything");
  });
});

describe("Paste or upload a transcript on the proposals page", () => {
  beforeEach(() => vi.resetModules());

  it("offers a lead picker, a paste box and a file input to a staff role, in the strip's disclosure", async () => {
    const html = await render();
    expect(html).toContain("Paste or upload a transcript");
    expect(html).toContain('name="leadId"');
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("<textarea");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".txt,.vtt,.srt,.docx"');
    // one entry only: the old standalone disclosure is gone
    expect(html).not.toContain("Draft from a transcript");
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
    expect(html).not.toContain("Paste or upload a transcript");
    expect(html).not.toContain('name="leadId"');
  });
});



describe("proposals list page: paid marker and Mark paid on accepted rows (Sprint 19)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T16:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const PAID = { paid: { state: "paid", by: "u-dawn", at: "2026-10-21T16:00:00Z" }, newest: { payload: { step: "paid_marked", outcome: "marked" }, created_at: "2026-10-21T16:00:00Z", actor: "staff", actor_user_id: "u-dawn" } };
  const DAWN = [{ userId: "u-dawn", displayName: "Dawn Reyes", email: "dawn@example.com", role: "intake" }];
  const rows = [item("c1", { status: "accepted", accepted_at: "2026-10-21T15:00:00Z" }), item("s1", { status: "sent", expires_on: "2026-10-30" }), item("a1")];
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

  it("an accepted row not yet paid shows 'Not paid' and a Mark paid button; no other row has either", async () => {
    const html = await render({}, { rows });
    expect(rowOf(html, "Client c1")).toContain("Not paid");
    expect(buttons(rowOf(html, "Client c1"))).toEqual(["Mark paid"]);
    for (const other of ["Client s1", "Client a1"]) {
      expect(rowOf(html, other)).not.toMatch(/Not paid|Mark paid|Paid ·|Undo/);
    }
  });

  it("a paid row shows 'Paid Oct 21' with Undo (who marked it is the tooltip) and no Mark paid; Last activity reads 'Marked paid', not 'Edited'", async () => {
    const html = await render({}, { rows, steps: { c1: PAID }, directory: DAWN, events: new Map([["c1", { type: "accepted", actor: "client", actor_user_id: null, created_at: "2026-10-21T15:00:00Z" }]]) });
    const row = rowOf(html, "Client c1");
    expect(row).toContain("Paid Oct 21");
    expect(row).toContain('title="Paid · marked by Dawn · Oct 21"');
    expect(buttons(row)).toEqual(["Undo"]);
    expect(row).toMatch(/Marked paid [^<]*· Dawn/);
    expect(row).not.toContain("Edited");
  });

  it("an unreadable step history is 'Paid status couldn't be read' with no button, never 'Not paid'", async () => {
    const html = await render({}, { rows, steps: "fail" });
    const row = rowOf(html, "Client c1");
    expect(row).toContain("Paid status couldn&#x27;t be read");
    expect(row).not.toContain("Not paid");
    expect(buttons(row)).toEqual([]);
    // The rest of the page is fine.
    expect(rowOf(html, "Client s1")).toContain("Client s1");
  });

  it.each(["paralegal", "attorney", "viewer", "social_media", null])("a %s sees the marker and no Mark paid button (and no Undo on a paid row)", async (role) => {
    const html = await render({}, { rows, role });
    expect(rowOf(html, "Client c1")).toContain("Not paid");
    expect(buttons(rowOf(html, "Client c1"))).toEqual([]);
    vi.resetModules();
    const paid = await render({}, { rows, role, steps: { c1: PAID }, directory: DAWN });
    expect(rowOf(paid, "Client c1")).toContain("Paid Oct 21");
    expect(buttons(rowOf(paid, "Client c1"))).toEqual([]);
  });

  it.each(["owner", "admin", "senior_admin", "intake"])("a %s gets the Mark paid button", async (role) => {
    expect(buttons(rowOf(await render({}, { rows, role }), "Client c1"))).toEqual(["Mark paid"]);
  });

  it("a page with no accepted rows makes no step read", async () => {
    const html = await render({}, { rows: [item("a1")], steps: "fail" });
    expect(html).toContain("Client a1");
    expect(html).not.toContain("couldn&#x27;t be read");
  });

  it("the paid marker and the proposal page agree for the same events (both read paidStateFromEvents)", async () => {
    const { paidStateFromEvents } = await import("@/lib/proposals/paid");
    const { paidMarker } = await import("@/lib/proposals/paid-view");
    const events = [
      { created_at: "2026-10-21T16:00:00Z", actor_user_id: "u-dawn", payload: { step: "paid_marked", outcome: "marked" } },
      { created_at: "2026-10-21T17:00:00Z", actor_user_id: "u-dawn", payload: { step: "paid_undone", outcome: "undone" } },
    ];
    const state = paidStateFromEvents(events);
    const marker = paidMarker(state, new Map(), "America/New_York");
    const html = await render({}, { rows, steps: { c1: { paid: state, newest: null } } });
    // The same words the proposal page prints sit on the cell as its tooltip.
    expect(rowOf(html, "Client c1")).toContain(marker.label);
  });
});
