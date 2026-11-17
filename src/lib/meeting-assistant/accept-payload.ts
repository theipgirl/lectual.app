import { realIsoDate } from "./validate";
import { LIMITS, type AssistantMember, type AssistantRow, type MeetingProposal } from "./types";

/**
 * What a later "accept" would write. Pure: nothing is written here. The shapes follow `CreateTaskInput`
 * (src/lib/matters/tasks.ts) and a plain timeline note; org_id is never part of it (the writers read it
 * off the parent row).
 *
 * The proposal is NOT trusted: this re-checks it against the rows and members the page was drawn with
 * (the record is one of the rows with the same kind, the owner is a member, the due date is a real date,
 * the title and note are bounded, the meeting date is real) and returns null on any mismatch.
 *
 * THE FUTURE ACCEPT ACTION MUST ALSO, like `setNextStepAction` in src/lib/review/actions.ts: re-resolve the
 * role and require `canWrite`, follow a lead id to its keeper with `keeperForWrite`, re-read the record through
 * the scoped client and require `recordVisible`, and re-check the owner against the live member directory.
 * This function proves the payload is consistent with the page; it does not authorise anything.
 */
export type AcceptTask = {
  title: string;
  type: "custom";
  dueAt?: string;
  assigneeId?: string;
  leadId?: string;
  matterId?: string;
};
export type AcceptPayload = { task: AcceptTask; noteText: string };

export function buildAcceptPayload(
  p: MeetingProposal,
  meeting: { date: string },
  ctx: { rows: readonly AssistantRow[]; members: readonly AssistantMember[] },
): AcceptPayload | null {
  if (!p || p.record === "unmatched" || typeof p.record !== "object") return null;
  if (!realIsoDate(meeting?.date)) return null;
  const rec = p.record;
  if (!ctx.rows.some((r) => r.id === rec.id && r.kind === rec.kind)) return null;
  if (p.ownerId != null && !ctx.members.some((m) => m.id === p.ownerId)) return null;
  if (p.dueDate != null && !realIsoDate(p.dueDate)) return null;
  if (typeof p.nextStep !== "string" || !p.nextStep.trim() || p.nextStep.length > LIMITS.nextStep) return null;
  const note = typeof p.note === "string" ? p.note : "";
  if (note.length > LIMITS.note) return null;

  const task: AcceptTask = { title: p.nextStep, type: "custom" };
  if (p.dueDate) task.dueAt = p.dueDate;
  if (p.ownerId) task.assigneeId = p.ownerId;
  if (rec.kind === "lead") task.leadId = rec.id;
  else task.matterId = rec.id;
  const parts = [`From the ${meeting.date} review call: ${p.nextStep}`];
  if (note) parts.push(note);
  return { task, noteText: parts.join("\n") };
}
