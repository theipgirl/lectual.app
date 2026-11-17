import type { MeetingProposal } from "./types";

/**
 * What a later "accept" would write. Pure: nothing is written here. The shapes follow `CreateTaskInput`
 * (src/lib/matters/tasks.ts) and a plain timeline note; org_id is never part of it (the writers read it
 * off the parent row).
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

export function buildAcceptPayload(p: MeetingProposal, meeting: { date: string }): AcceptPayload | null {
  if (p.record === "unmatched") return null;
  const task: AcceptTask = { title: p.nextStep, type: "custom" };
  if (p.dueDate) task.dueAt = p.dueDate;
  if (p.ownerId) task.assigneeId = p.ownerId;
  if (p.record.kind === "lead") task.leadId = p.record.id;
  else task.matterId = p.record.id;
  const parts = [`From the ${meeting.date} review call: ${p.nextStep}`];
  if (p.note) parts.push(p.note);
  return { task, noteText: parts.join("\n") };
}
