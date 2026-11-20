import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RecordCardLoad } from "@/lib/record-card/model";
import { NOW, TZ, facts as stepFacts } from "../lead-step/fixtures";

/**
 * The Weekly review opens a record in the centred record card (no drawer). The review's own part is optional: Intake and
 * Matters pass none, and their card has no review facts, no assignee picker and the lead page's own note composer.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const ID = "00000000-0000-4000-8000-000000000001";
const members = { status: "ok" as const, value: [{ userId: "u-reb", name: "Rebecca" }, { userId: "u-rayn", name: "Rayn" }] };
const task = (id: string, title: string, assigneeId: string | null) => ({ id, title, type: "custom", dueAt: "2026-11-20T00:00:00Z", assigneeId, createdAt: "2026-10-01T00:00:00Z" });
const leadLoad = (over: object = {}): RecordCardLoad =>
  ({
    status: "ok", kind: "lead", role: "attorney", now: NOW, timeZone: TZ,
    lead: { id: ID, first_name: "Lena", last_name: "Lead", business_name: null, mark_text: null, email: null, phone: null, current_stage_id: "s1", assigned_to: "u-reb", referral_source: null, last_activity_at: null, last_inbound_at: null, last_outbound_at: null, lane: null, lane_set_at: null, ai_summary: null },
    stages: { status: "ok", value: [{ id: "s1", name: "Proposal", category: "open" }] }, members,
    tags: { status: "ok", value: { on: [], catalog: [] } },
    leadStep: { status: "ok", facts: stepFacts({ tasks: { status: "ok", value: [task("t1", "Call back", "u-rayn")] } }) },
    approvals: { status: "ok", queueIds: [] }, proposal: { status: "not-set-up" },
    documents: { status: "ok", value: { files: { status: "ok", files: [], capped: false }, letters: null } },
    temperature: null, mergeAvailable: false, duplicateOf: null, ...over,
  }) as RecordCardLoad;

async function host(review: boolean, load = leadLoad()) {
  const { RecordCardHost } = await import("@/components/record-card/RecordCardHost");
  const el = await RecordCardHost({
    open: { kind: "lead", id: ID },
    path: review ? "/dashboard/review/" : "/dashboard/intake/",
    params: {},
    load,
    ...(review ? { review: { aside: <section data-review-card="">facts</section>, note: <form id="rv-sec-note">note</form> } } : {}),
  });
  return renderToStaticMarkup(el);
}

describe("the record card with and without the review's part", () => {
  it("Intake's card (no review part): no review facts, no step assignee, the lead page's own composer, the plain upload control", async () => {
    const html = await host(false);
    expect(html).not.toContain("data-review-card");
    expect(html).not.toContain("rc-step-who");
    expect(html).not.toContain('id="rv-sec-note"');
    expect(html).toContain('id="lx-note-body"');
    expect(html).not.toContain('id="rv-file-input"');
  });
  it("the review's card: its facts first in the side column, the step's assignee, its own note form, an upload that refreshes the review", async () => {
    const html = await host(true);
    expect(html).toContain("data-review-card");
    expect(html.indexOf("data-review-card")).toBeLessThan(html.indexOf("Contact"));
    expect(html).toMatch(/rc-step-who[^>]*>Rayn</);
    expect(html).toContain('id="rv-sec-note"');
    expect(html).not.toContain('id="lx-note-body"');
    expect(html).toContain('id="rv-file-input"');
  });
  it("a role without the note edit gets no note form even from the review", async () => {
    const html = await host(true, leadLoad({ role: "viewer" }));
    expect(html).toContain("data-review-card");
    expect(html).not.toContain('id="rv-sec-note"');
    expect(html).not.toContain('type="file"');
  });
  it("an unreadable team list draws no assignee picker (a select of nobody would clear an assignee)", async () => {
    const html = await host(true, leadLoad({ members: { status: "unavailable" } }));
    expect(html).not.toContain("rc-step-who");
  });
});

describe("the step form's assignee (review only)", () => {
  it("draws 'Assigned to' with the team, the current one chosen; without assignees it is the old three-part form", async () => {
    const { StepForm } = await import("@/components/record-card/controls");
    const step = { id: "t1", title: "Call back", due: "Nov 20", overdue: false };
    const withWho = renderToStaticMarkup(<StepForm kind="lead" id={ID} step={step} dueIso="2026-11-20" onDone={() => {}} assignees={{ members: members.value, current: "u-rayn" }} />);
    expect(withWho).toContain('aria-label="Assigned to"');
    expect(withWho).toMatch(/<option value="u-rayn" selected="">Rayn<\/option>/);
    expect(withWho).toContain('<option value="">Unassigned</option>');
    expect(withWho).toContain("rc-stepform-who");
    const plain = renderToStaticMarkup(<StepForm kind="lead" id={ID} step={step} dueIso="2026-11-20" onDone={() => {}} />);
    expect(plain).not.toContain("<select");
    expect(plain).toContain('class="rc-stepform"');
  });
  it("posts the assignee through the review's existing actions only (no new write path)", () => {
    const src = readFileSync("src/components/record-card/controls.tsx", "utf8");
    expect(src).toMatch(/viaForm\(updateNextStepAction, \{ taskId: step\.id, title, dueAt: due, \.\.\.\(assignees \? \{ assigneeId: who \} : \{\}\) \}\)/);
    expect(src).toMatch(/viaForm\(setNextStepAction, \{ kind, id, title, dueAt: due, assigneeId: assignees \? who : "" \}\)/);
  });
});

describe("the drawer is gone", () => {
  it("no ReviewPanel, PanelShell or review detail loader is left, and the page draws no side panel", () => {
    for (const f of ["src/components/review/ReviewPanel.tsx", "src/components/review/PanelShell.tsx"]) expect(() => readFileSync(f, "utf8")).toThrow();
    expect(readFileSync("src/lib/review/detail-load.ts", "utf8")).not.toContain("loadReviewDetail");
    const page = readFileSync("src/app/dashboard/review/page.tsx", "utf8");
    expect(page).not.toMatch(/SidePanel|ReviewPanel|PanelShell/);
    expect(page).toContain("loadRecordCard(params.open)");
  });
  it("the review's card part uses the existing review actions and no service role", () => {
    const src = readFileSync("src/components/review/ReviewCardExtras.tsx", "utf8");
    expect(src).toContain("logWhatHappenedAction");
    expect(src).toContain("LostNurture");
    expect(src).not.toMatch(/@\/lib\/db\/admin|getAdminClient/);
  });
});
