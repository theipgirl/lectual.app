import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReviewRows, type ReviewInput } from "@/lib/review/build";
import { noteEntry } from "@/lib/pipeline/lead-input";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stepAssigneeOptions, stepEditFields } from "@/lib/record-card/rules";
import { BLANK, LEAD_PAGE_STEP_OWNER, LEAD_STEP_COULDNT_LOAD, STEP_ASSIGNEE_NOT_ON_TEAM, UNASSIGNED } from "@/lib/ui/words";

/**
 * Review of da2828d: the card keeps its own note composers from the review (call / email / meeting), and every card action
 * that changes what a review row shows refreshes the review; a step edit never posts an assignee nobody chose.
 */

const src = (f: string) => readFileSync(f, "utf8");
/** The body of one exported function, to the next top-level declaration. */
function body(file: string, name: string): string {
  const s = src(file);
  const i = s.indexOf(name);
  expect(i, `${file}: ${name}`).toBeGreaterThan(-1);
  const rest = s.slice(i);
  const end = rest.slice(1).search(/\n(export )?(async )?function /);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

const NOW = new Date("2026-11-17T15:00:00Z");
const input = (activity: ReviewInput["activity"]): ReviewInput => ({
  matters: [],
  leads: [{ id: "l1", first_name: "Jordan", last_name: "Pike", business_name: null, email: "a@x.example", mark_text: null, current_stage_id: "s2", assigned_to: null, stage_entered_at: "2026-10-25T00:00:00Z", created_at: "2026-10-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null, sheet_key: null }] as never,
  leadStages: [{ id: "s1", name: "Potential New Client", category: "open", order_index: 1 }, { id: "s2", name: "Consultation Scheduled", category: "open", order_index: 2 }] as never,
  tasks: [{ id: "t1", lead_id: "l1", matter_id: null, title: "Follow up", due_at: "2026-12-01T00:00:00Z", assignee_id: null, created_at: "2026-10-01T00:00:00Z" }] as never,
  activity,
  deadlines: [],
  lastStageChange: new Map(),
  pendingMatterIds: new Set(),
  pendingLeadIds: new Set(),
  sources: { activity: "ok", deadlines: "ok" },
  timeZone: "America/New_York",
  now: NOW,
});

describe("a call logged from the review's card", () => {
  beforeEach(() => vi.resetModules());

  it("goes through the lead page's own composer action, which now refreshes the review", async () => {
    const revalidatePath = vi.fn();
    const addLeadNote = vi.fn(async () => {});
    vi.doMock("next/cache", () => ({ revalidatePath }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ rpc: async () => ({ data: "attorney", error: null }) }) }));
    vi.doMock("@/lib/pipeline", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline")>()), addLeadNote }));
    const { addNoteAction } = await import("@/app/dashboard/leads/[id]/actions");
    const fd = new FormData();
    fd.set("leadId", "l1");
    fd.set("kind", "call_logged");
    fd.set("subject", "Left a voicemail");
    fd.set("body", "Called about the proposal.");
    expect(await addNoteAction({}, fd)).toEqual({});
    expect(addLeadNote).toHaveBeenCalledWith("l1", expect.objectContaining({ kind: "call_logged" }));
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/review/");
  });

  it("moves the row to Waiting on client and is its last follow-up", () => {
    const before = buildReviewRows(input([{ lead_id: "l1", matter_id: null, type: "email_received", created_at: "2026-11-10T15:00:00Z" }]));
    expect(before[0].waiting).toBe("us");
    // The row the composer writes for a Call (`noteEntry`), as the review's activity read returns it.
    const call = noteEntry("call_logged", "Called about the proposal.", "Left a voicemail");
    const after = buildReviewRows(input([
      { lead_id: "l1", matter_id: null, type: "email_received", created_at: "2026-11-10T15:00:00Z" },
      { lead_id: "l1", matter_id: null, type: call.type, created_at: "2026-11-16T15:00:00Z" },
    ]));
    expect(after[0].waiting).toBe("client");
    expect(after[0].lastOutbound).toBe("2026-11-16");
    expect(after[0].lastOutboundType).toBe("call_logged");
  });

  it("a matter's call goes through addMatterNoteAction, which now refreshes the review", async () => {
    const revalidatePath = vi.fn();
    const addMatterNote = vi.fn(async () => {});
    vi.doMock("next/cache", () => ({ revalidatePath }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ rpc: async () => ({ data: "attorney", error: null }) }) }));
    vi.doMock("@/lib/matters/notes", () => ({ addMatterNote }));
    const { addMatterNoteAction } = await import("@/app/dashboard/matters/[id]/actions");
    const fd = new FormData();
    fd.set("matterId", "m1");
    fd.set("kind", "call_logged");
    fd.set("body", "Called the client.");
    expect(await addMatterNoteAction({}, fd)).toEqual({ saved: true });
    expect(addMatterNote).toHaveBeenCalledWith("m1", expect.objectContaining({ kind: "call_logged" }));
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/review/");
  });
});

describe("every other card action refreshes the review page too", () => {
  const REVIEW = 'revalidatePath("/dashboard/review/")';
  it.each([
    ["src/app/dashboard/intake/actions.ts", "export async function setLaneAction"],
    ["src/app/dashboard/intake/actions.ts", "export async function setSourceAction("],
    ["src/lib/record-card/actions.ts", "function refresh(leadId"],
    ["src/app/dashboard/leads/[id]/outcome-actions.ts", "export async function logConsultOutcomeAction("],
    ["src/app/dashboard/leads/[id]/actions.ts", "export async function addVoiceNoteAction("],
    ["src/app/dashboard/leads/[id]/actions.ts", "export async function addNoteAction("],
    ["src/app/dashboard/matters/[id]/actions.ts", "export async function addVoiceNoteAction("],
    ["src/app/dashboard/matters/[id]/actions.ts", "export async function addMatterNoteAction("],
    ["src/app/dashboard/matters/[id]/actions.ts", "function revalidateMatter("],
  ])("%s %s", (file, name) => {
    expect(body(file, name)).toContain(REVIEW);
  });
  it("rename and tags both refresh through the shared helper, and the matter title through revalidateMatter", () => {
    expect(body("src/lib/record-card/actions.ts", "export async function renameLeadAction(")).toMatch(/refresh\(/);
    expect(body("src/lib/record-card/actions.ts", "export async function cardTagAction(")).toMatch(/refresh\(/);
    expect(body("src/app/dashboard/matters/[id]/actions.ts", "export async function updateMatterHeaderAction(")).toContain("revalidateMatter(");
  });
});

describe("a step edit never reverts someone else's reassignment", () => {
  const base = { taskId: "t1", title: "Call back", dueAt: "2026-11-20" };
  it("posts the assignee only when the person explicitly picked one in this form", () => {
    // Opened with Rayn, picker untouched: no assigneeId, so a reassignment saved meanwhile stands.
    expect(stepEditFields({ ...base, assignees: { current: "u-rayn" }, chosen: "u-rayn", picked: false })).toEqual(base);
    expect(stepEditFields({ ...base, assignees: { current: null }, chosen: "", picked: false })).toEqual(base);
    // Picked: sent. Cleared on purpose: sent as "".
    expect(stepEditFields({ ...base, assignees: { current: "u-rayn" }, chosen: "u-reb", picked: true })).toEqual({ ...base, assigneeId: "u-reb" });
    expect(stepEditFields({ ...base, assignees: { current: "u-rayn" }, chosen: "", picked: true })).toEqual({ ...base, assigneeId: "" });
    // No picker (Intake, Matters, or an unreadable team list): never, even with a value.
    expect(stepEditFields({ ...base, assignees: null, chosen: "u-reb", picked: true })).toEqual(base);
  });
  it("re-picking the value the form opened with is posted (someone moved X to Y meanwhile; the person chose X again)", () => {
    expect(stepEditFields({ ...base, assignees: { current: "u-x" }, chosen: "u-x", picked: true })).toEqual({ ...base, assigneeId: "u-x" });
  });
  it("the step forms post through it, with the pick tracked from the select's change event", () => {
    const controls = src("src/components/record-card/controls.tsx");
    expect(controls).toContain("viaForm(updateNextStepAction, stepEditFields({");
    expect(controls).toMatch(/chosen: who, picked \}\)/);
    expect(controls).toMatch(/setPicked\(true\)/);
    const lead = src("src/components/leads/StepControls.tsx");
    expect(lead).toContain("stepEditFields({");
    expect(lead).not.toMatch(/name="assigneeId" defaultValue=\{assigneeId/);
  });
});

describe("the picker when the current assignee isn't on the team list", () => {
  const team = [{ userId: "u-reb", name: "Reb Lane" }];
  it("adds an option for them, so the select opens on them and Unassigned really clears", () => {
    expect(stepAssigneeOptions(team, "u-gone")).toEqual([
      { value: "", label: UNASSIGNED },
      { value: "u-gone", label: STEP_ASSIGNEE_NOT_ON_TEAM },
      { value: "u-reb", label: "Reb Lane" },
    ]);
    // On the team, or nobody: no extra option.
    expect(stepAssigneeOptions(team, "u-reb").map((o) => o.value)).toEqual(["", "u-reb"]);
    expect(stepAssigneeOptions(team, null).map((o) => o.value)).toEqual(["", "u-reb"]);
    // Picking Unassigned from there is a real pick, posted as "".
    expect(stepEditFields({ taskId: "t1", title: "x", dueAt: "", assignees: { current: "u-gone" }, chosen: "", picked: true }).assigneeId).toBe("");
  });
});

describe("the lead page's top-card Change form (also on Intake's and the review's card)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
    vi.doMock("@/app/dashboard/review/actions", () => ({ completeNextStepAction: vi.fn(), setNextStepAction: vi.fn(), snoozeNextStepAction: vi.fn(), updateNextStepAction: vi.fn() }));
  });
  const render = async (props: Partial<{ assigneeId: string | null; members: { userId: string; name: string }[] | null }>) => {
    const { YoursActions } = await import("@/components/leads/StepControls");
    return renderToStaticMarkup(createElement(YoursActions, { taskId: "t1", title: "Call back", dueDate: "2026-11-20", assigneeId: "u-rayn", members: [{ userId: "u-rayn", name: "Rayn Cole" }], ...props }));
  };
  const named = (html: string) => [...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);

  it("posts taskId, title and due date only (no assignee until one is picked)", async () => {
    const html = await render({});
    const change = html.slice(html.indexOf('class="ls-change"'));
    expect(named(change).sort()).toEqual(["dueAt", "taskId", "title"]);
    expect(html).not.toContain('name="assigneeId"');
    expect(html).toContain(`aria-label="${LEAD_PAGE_STEP_OWNER}"`);
  });
  it("draws no picker and posts no assignee when the team list couldn't be read", async () => {
    const html = await render({ members: null });
    expect(html).not.toContain(`aria-label="${LEAD_PAGE_STEP_OWNER}"`);
    expect(html).not.toContain('name="assigneeId"');
  });
  it("opens on an assignee who isn't on the team", async () => {
    const html = await render({ assigneeId: "u-gone" });
    expect(html).toMatch(new RegExp(`<option value="u-gone" selected="">${STEP_ASSIGNEE_NOT_ON_TEAM}</option>`));
  });
  it("Set a next step draws no picker when the team list couldn't be read", async () => {
    const { SetNextStep } = await import("@/components/leads/StepControls");
    expect(renderToStaticMarkup(createElement(SetNextStep, { leadId: "l1", members: null }))).not.toContain('name="assigneeId"');
    expect(renderToStaticMarkup(createElement(SetNextStep, { leadId: "l1", members: [] }))).toContain('name="assigneeId"');
  });
  it("the lead page and the record card pass null, never an empty team, when the read failed", () => {
    expect(src("src/app/dashboard/leads/[id]/page.tsx")).toContain("listMemberDirectory().catch(() => null)");
    expect(src("src/components/record-card/RecordCardHost.tsx")).toContain('const members = load.members.status === "ok" ? directory : null;');
  });
});

describe("deleting a file from the review's card", () => {
  it("refreshes the page after a successful delete, like an upload", () => {
    expect(src("src/components/files/DocumentsCard.tsx")).toContain("refresh ? <DeleteAndRefresh");
    expect(src("src/components/files/DeleteAndRefresh.tsx")).toContain("onDeleted={() => router.refresh()}");
    const btn = body("src/components/files/DeleteFileButton.tsx", "export function DeleteFileButton(");
    expect(btn.indexOf("if (!result.ok) return setError")).toBeLessThan(btn.indexOf("onDeleted?.()"));
  });
  it("draws DeleteAndRefresh only where the card refreshes itself", async () => {
    vi.resetModules();
    vi.doMock("@/app/dashboard/files/actions", () => ({ requestUploadAction: vi.fn(), confirmUploadAction: vi.fn(), deleteFileAction: vi.fn() }));
    vi.doMock("@/components/files/DeleteAndRefresh", () => ({ DeleteAndRefresh: () => createElement("i", { "data-refreshing-delete": "" }) }));
    vi.doMock("@/components/files/UploadAndRefresh", () => ({ UploadAndRefresh: () => null }));
    const { DocumentsCard } = await import("@/components/files/DocumentsCard");
    const read = { files: { status: "ok", files: [{ id: "f1", file_name: "a.pdf", mime: "application/pdf", size_bytes: 10, uploaded_by: null, created_at: "2026-11-10T00:00:00Z" }], capped: false }, letters: null };
    const props = { parent: { kind: "lead" as const, id: "11111111-1111-4111-8111-111111111111" }, read: read as never, directory: [], canUpload: false, canDelete: true };
    expect(renderToStaticMarkup(createElement(DocumentsCard, { ...props, refreshAfterUpload: true }))).toContain("data-refreshing-delete");
    expect(renderToStaticMarkup(createElement(DocumentsCard, props))).not.toContain("data-refreshing-delete");
  });
});

describe("a lead's USPTO deadline on the review's card", () => {
  const row = { kind: "lead", id: "l1", stageLabel: "Consult", stageDays: null, stageNote: null, deadline: null, waiting: "us", lastContact: null, lastChange: undefined, proposalExpiry: null } as never;
  const props = { open: { kind: "lead" as const, id: "l1" }, row, members: [], today: "2026-11-17", stagesFailed: false, closeStages: [] };
  it("says Couldn't load when the deadline read failed, never a dash", async () => {
    const { ReviewCardAside } = await import("@/components/review/ReviewCardExtras");
    const uspto = (html: string) => html.replaceAll("&#x27;", "'").split("USPTO deadline</dt>")[1].split("</dd>")[0];
    expect(uspto(renderToStaticMarkup(createElement(ReviewCardAside, { ...props, deadlinesFailed: true })))).toContain(LEAD_STEP_COULDNT_LOAD);
    const ok = uspto(renderToStaticMarkup(createElement(ReviewCardAside, props)));
    expect(ok).not.toContain(LEAD_STEP_COULDNT_LOAD);
    expect(ok).toContain(BLANK);
  });
  it("the page passes the review's deadline source", () => {
    expect(src("src/app/dashboard/review/page.tsx")).toContain('deadlinesFailed={load.failed.includes("deadlines")}');
  });
});

describe("Stage Keeper and files actions refresh the review", () => {
  it.each([
    ["src/app/dashboard/leads/[id]/stage-keeper-actions.ts", "function refresh(leadId"],
    ["src/app/dashboard/files/actions.ts", "export async function deleteFileAction("],
    ["src/app/dashboard/files/actions.ts", "export async function confirmUploadAction("],
  ])("%s %s", (file, name) => {
    expect(body(file, name)).toContain('revalidatePath("/dashboard/review/")');
  });
  it("undo, accept and dismiss all go through that refresh", () => {
    for (const name of ["export async function undoAgentMoveAction(", "export async function acceptStageSuggestionAction(", "export async function dismissStageSuggestionAction("]) {
      expect(body("src/app/dashboard/leads/[id]/stage-keeper-actions.ts", name)).toMatch(/refresh\(target\.leadId\)/);
    }
  });
});

describe("the Cards deck's note box", () => {
  it("disables its button while posting and takes its words from words.ts", () => {
    const btn = src("src/components/review/DeckNoteSubmit.tsx");
    expect(btn).toContain("useFormStatus");
    expect(btn).toMatch(/disabled=\{pending\}/);
    const deck = src("src/components/review/CardsDeck.tsx");
    expect(deck).toContain("placeholder={REVIEW_LOG_PLACEHOLDER}");
    expect(deck).toContain("aria-label={REVIEW_LOG_LABEL}");
    expect(deck).not.toContain('"A short note for the timeline"');
    expect(deck).toMatch(/<form key=\{`\$\{row\.kind\}:\$\{row\.id\}`\} action=\{deckNoteAction\}/);
  });
});
