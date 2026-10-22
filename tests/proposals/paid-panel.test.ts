import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildPaidPanelView, paidLine, paidMarker, reportText, stepText } from "@/lib/proposals/paid-view";
import type { StepEventInput } from "@/lib/proposals/paid";

vi.mock("@/app/dashboard/proposals/[id]/paid-actions", () => ({
  markPaidAction: vi.fn(),
  undoPaidAction: vi.fn(),
  retryUploadAction: vi.fn(),
}));

const { PaidPanel } = await import("@/components/proposal-editor/PaidPanel");

const ID = "44444444-4444-4444-8444-444444444444";
const TZ = "America/New_York";
const NAMES = new Map([["u-dawn", "Dawn"]]);

const ev = (step: string, outcome: string, at: string, extra: Record<string, unknown> = {}, reason?: string, by = "u-dawn"): StepEventInput => ({
  proposal_id: ID,
  actor: "staff",
  actor_user_id: by,
  created_at: at,
  payload: { step, outcome, ...(reason ? { reason } : {}), ...extra },
});
const MARKED = ev("paid_marked", "marked", "2026-10-21T15:00:00Z");

function render(events: StepEventInput[] | null, over: { canAct?: boolean; matterId?: string | null; names?: ReadonlyMap<string, string> } = {}) {
  const view = buildPaidPanelView({ proposalId: ID, matterId: over.matterId === undefined ? "matter-1" : over.matterId, events, names: over.names ?? NAMES, tz: TZ, canAct: over.canAct ?? true });
  return renderToStaticMarkup(createElement("div", null, createElement(PaidPanel, { proposalId: ID, view })));
}
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe("the paid line", () => {
  it("not paid: 'Not paid', Mark paid, and the by-hand note", () => {
    const html = render([]);
    expect(html).toContain("Not paid");
    expect(buttons(html)).toEqual(["Mark paid"]);
    expect(html).toContain("Marked by hand. LawPay isn&#x27;t connected to proposals yet.");
  });

  it("paid: 'Paid · marked by Dawn · Oct 21' with Undo and the same note", () => {
    const html = render([MARKED]);
    expect(html).toContain("Paid · marked by Dawn · Oct 21");
    expect(buttons(html)).toEqual(["Undo"]);
    expect(html).toContain("Marked by hand. LawPay isn&#x27;t connected to proposals yet.");
  });

  it("the date is in the firm's zone", () => {
    // 2026-10-22T02:00Z is still Oct 21 in New York.
    expect(render([ev("paid_marked", "marked", "2026-10-22T02:00:00Z")])).toContain("Oct 21");
  });

  it("when the name can't be resolved the name is dropped, never replaced by an id", () => {
    const html = render([ev("paid_marked", "marked", "2026-10-21T15:00:00Z", {}, undefined, "9f3c1a22-0000-4000-8000-000000000000")], { names: new Map() });
    expect(html).toContain("Paid · Oct 21");
    expect(html).not.toContain("marked by");
    expect(html).not.toContain("9f3c1a22");
  });

  it("paid then undone: back to 'Not paid' with Mark paid offered again", () => {
    const html = render([MARKED, ev("paid_undone", "undone", "2026-10-21T16:00:00Z")]);
    expect(html).toContain("Not paid");
    expect(buttons(html)).toEqual(["Mark paid"]);
  });

  it("undone then marked again: paid again", () => {
    const html = render([MARKED, ev("paid_undone", "undone", "2026-10-21T16:00:00Z"), ev("paid_marked", "marked", "2026-10-21T17:00:00Z")]);
    expect(html).toContain("Paid · marked by Dawn");
    expect(buttons(html)).toEqual(["Undo"]);
  });

  it("an events read that failed: 'Paid status couldn't be read', no buttons, never 'Not paid'", () => {
    const html = render(null);
    expect(html).toContain("Paid status couldn&#x27;t be read");
    expect(html).not.toContain("Not paid");
    expect(html).not.toContain("Paid ·");
    expect(buttons(html)).toEqual([]);
    expect(html).toContain("not a sign that it hasn&#x27;t been paid");
  });

  it("a role that may not act sees the state and no buttons", () => {
    for (const events of [[], [MARKED]]) expect(buttons(render(events, { canAct: false }))).toEqual([]);
    expect(render([MARKED], { canAct: false })).toContain("Paid · marked by Dawn");
  });
});

describe("one line per follow-up step", () => {
  const paid = (...more: StepEventInput[]) => [MARKED, ...more];

  it("LOE queued: links to the queue item and says it waits for approval", () => {
    const html = render(paid(ev("loe_draft", "queued", "2026-10-21T15:01:00Z", { queue_item_id: "q_abc-1" })));
    expect(html).toContain("Engagement letter draft queued for approval.");
    expect(html).toContain('href="/dashboard/queue/q_abc-1/"');
    expect(html).toContain("Open the queued engagement letter");
    expect(html).toContain("Waiting for approval in the queue. The file is uploaded to Lawmatics after it is approved.");
  });

  it("LOE approved and uploaded: 'LOE file uploaded to Lawmatics.'", () => {
    const html = render(paid(ev("loe_draft", "queued", "2026-10-21T15:01:00Z", { queue_item_id: "q1" }), ev("loe_file_upload", "uploaded", "2026-10-21T18:00:00Z")));
    expect(html).toContain("LOE file uploaded to Lawmatics.");
    expect(html).not.toContain("Waiting for approval");
  });

  it("no matter: 'Open the matter to draft the LOE.' with a Retry for the staff roles", () => {
    const html = render(paid(ev("loe_draft", "blocked", "2026-10-21T15:01:00Z", { code: "no_matter" }, "Open the matter to draft the LOE.")), { matterId: null });
    expect(html).toContain("Open the matter to draft the LOE.");
    expect(buttons(html)).toContain("Retry");
    expect(html).not.toContain("Choose the LOE template");
  });

  it("unknown package: 'Choose the LOE template' links to the LOE form when a matter exists", () => {
    const events = paid(ev("loe_draft", "blocked", "2026-10-21T15:01:00Z", { code: "unknown_package" }, "This package isn't on the firm's current package list, so no engagement letter was drafted."));
    const withMatter = render(events, { matterId: "matter-1" });
    expect(withMatter).toContain("Choose the LOE template");
    expect(withMatter).toContain('href="/dashboard/documents/new/matter-1/loe/"');
    const without = render(events, { matterId: null });
    expect(without).toContain("Choose the LOE template");
    expect(without).not.toContain("/dashboard/documents/new/");
  });

  it("a failed upload: the short reason, the unverified-shape caution and a Retry", () => {
    const html = render(paid(ev("accepted_file_upload", "failed", "2026-10-21T15:02:00Z", {}, "HTTP 422")));
    expect(html).toContain("Not uploaded to Lawmatics: HTTP 422. The shape of this request hasn&#x27;t been checked against a live account.");
    expect(buttons(html)).toEqual(["Undo", "Retry"]);
    expect(html).toContain('name="step" value="accepted_file_upload"');
  });

  it("not connected is not an 'unverified shape' failure, and still has a Retry", () => {
    const html = render(paid(ev("accepted_file_upload", "blocked", "2026-10-21T15:02:00Z", {}, "Lawmatics isn't connected, so nothing was uploaded.")));
    expect(html).toContain("Lawmatics isn&#x27;t connected, so nothing was uploaded.");
    expect(html).not.toContain("hasn&#x27;t been checked");
    expect(buttons(html)).toContain("Retry");
  });

  it("a note that did not go through is a retryable line, and the one that did is plain", () => {
    const failed = render(paid(ev("lawmatics_note", "blocked", "2026-10-21T15:02:00Z", {}, "no Lawmatics record found")));
    expect(failed).toContain("Lawmatics note not added: no Lawmatics record found.");
    expect(buttons(failed)).toContain("Retry");
    const added = render(paid(ev("lawmatics_note", "added", "2026-10-21T15:02:00Z")));
    expect(added).toContain("Note added to Lawmatics.");
    expect(buttons(added)).toEqual(["Undo"]);
  });

  it("the LOE fields line only exists when the step ran", () => {
    expect(render(paid())).not.toContain("LOE fields");
    expect(render(paid(ev("custom_fields", "written", "2026-10-21T15:03:00Z")))).toContain("LOE fields written to Lawmatics.");
    expect(render(paid(ev("custom_fields", "skipped", "2026-10-21T15:03:00Z", {}, "The LOE fields are switched on, but none of the six names is matched to a Lawmatics field yet."))).toLowerCase()).toContain("none of the six names");
  });

  it("a role that may not act sees every line and no Retry", () => {
    const html = render(paid(ev("accepted_file_upload", "failed", "2026-10-21T15:02:00Z", {}, "HTTP 500")), { canAct: false });
    expect(html).toContain("Not uploaded to Lawmatics: HTTP 500");
    expect(buttons(html)).toEqual([]);
  });

  it("no Retry while the version is not paid (after an undo)", () => {
    const html = render([MARKED, ev("accepted_file_upload", "failed", "2026-10-21T15:02:00Z", {}, "HTTP 500"), ev("paid_undone", "undone", "2026-10-21T16:00:00Z")]);
    expect(buttons(html)).toEqual(["Mark paid"]);
  });

  it("only this version's lines show (the history is family-wide)", () => {
    const other: StepEventInput = { ...ev("loe_draft", "queued", "2026-10-21T15:01:00Z", { queue_item_id: "q-other" }), proposal_id: "some-other-version" };
    expect(render(paid(other))).not.toContain("q-other");
  });
});

describe("the pure view helpers", () => {
  it("paidLine / paidMarker / stepText / reportText", () => {
    expect(paidLine({ state: "paid", by: "u-dawn", at: "2026-10-21T15:00:00Z" }, NAMES, TZ)).toBe("Paid · marked by Dawn · Oct 21");
    expect(paidMarker("unreadable", NAMES, TZ)).toEqual({ state: "unreadable", label: "Paid status couldn't be read", tone: "risk" });
    expect(paidMarker({ state: "not_paid", undoneAt: null }, NAMES, TZ)).toEqual({ state: "not_paid", label: "Not paid", tone: "mute" });
    expect(stepText({ step: "loe_draft", outcome: "queued", reason: null })).toBe("Engagement letter draft queued for approval.");
    expect(reportText({ step: "loe_draft", outcome: "queued", reason: null, recorded: false })).toContain("couldn't be saved");
  });

  it("uses only existing classes and tones: no inline colours", () => {
    const html = render([MARKED, ev("accepted_file_upload", "failed", "2026-10-21T15:02:00Z", {}, "HTTP 500")]);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toContain("style=");
    for (const cls of html.match(/lx-pill-[a-z]+/g) ?? []) expect(["lx-pill-ok", "lx-pill-warn", "lx-pill-risk", "lx-pill-mute"]).toContain(cls);
  });
});
