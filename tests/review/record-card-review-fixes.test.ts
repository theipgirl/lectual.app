import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReviewRows, type ReviewInput } from "@/lib/review/build";
import { noteEntry } from "@/lib/pipeline/lead-input";
import { stepEditFields } from "@/lib/record-card/rules";

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
  it("posts the assignee only when the person changed it in this form", () => {
    const base = { taskId: "t1", title: "Call back", dueAt: "2026-11-20" };
    // Opened with Rayn, left alone: no assigneeId, so a reassignment saved meanwhile stands.
    expect(stepEditFields({ ...base, assignees: { current: "u-rayn" }, chosen: "u-rayn" })).toEqual(base);
    expect(stepEditFields({ ...base, assignees: { current: null }, chosen: "" })).toEqual(base);
    // Changed: sent. Cleared on purpose: sent as "".
    expect(stepEditFields({ ...base, assignees: { current: "u-rayn" }, chosen: "u-reb" })).toEqual({ ...base, assigneeId: "u-reb" });
    expect(stepEditFields({ ...base, assignees: { current: "u-rayn" }, chosen: "" })).toEqual({ ...base, assigneeId: "" });
    // No picker (Intake, Matters): never.
    expect(stepEditFields({ ...base, assignees: null, chosen: "u-reb" })).toEqual(base);
  });
  it("the step form posts through it", () => {
    expect(src("src/components/record-card/controls.tsx")).toContain("viaForm(updateNextStepAction, stepEditFields({");
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
