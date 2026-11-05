import { TASK_TITLE_MAX } from "@/lib/matters/task-edit";
import { NOTE_MAX_LENGTH } from "@/lib/pipeline/lead-input";
import type { ReviewKind } from "./buckets";

/**
 * What the review's inline forms post, checked on the server. Pure; fixed sentences only. The id in
 * a form is only a pointer: the action re-reads the record through the caller's scoped client.
 */

export type NextStepInput = { kind: ReviewKind; id: string; title: string; dueAt: string | null; assigneeId: string | null };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function parseKind(value: unknown): ReviewKind | null {
  return value === "matter" || value === "lead" ? value : null;
}

function realDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function parseNextStep(form: { get(name: string): unknown }): Parsed<NextStepInput> {
  const kind = parseKind(form.get("kind"));
  const id = String(form.get("id") ?? "").trim();
  if (!kind || !isUuid(id)) return { ok: false, error: "That record couldn't be found. Refresh and try again." };
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Enter what happens next." };
  if (title.length > TASK_TITLE_MAX) return { ok: false, error: `Keep it to ${TASK_TITLE_MAX} characters or fewer.` };
  const dueRaw = String(form.get("dueAt") ?? "").trim();
  if (dueRaw && !realDate(dueRaw)) return { ok: false, error: "Enter a real calendar date." };
  const assignee = String(form.get("assigneeId") ?? "").trim();
  if (assignee && !isUuid(assignee)) return { ok: false, error: "Choose someone from your team." };
  return { ok: true, value: { kind, id, title, dueAt: dueRaw || null, assigneeId: assignee || null } };
}

export type NoteInput = { kind: ReviewKind; id: string; body: string };

export function parseWhatHappened(form: { get(name: string): unknown }): Parsed<NoteInput> {
  const kind = parseKind(form.get("kind"));
  const id = String(form.get("id") ?? "").trim();
  if (!kind || !isUuid(id)) return { ok: false, error: "That record couldn't be found. Refresh and try again." };
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { ok: false, error: "Write what happened." };
  if (body.length > NOTE_MAX_LENGTH) return { ok: false, error: `Keep it to ${NOTE_MAX_LENGTH} characters or fewer.` };
  return { ok: true, value: { kind, id, body } };
}

export const CLOSE_REASON_MAX = 200;
export type CloseLeadInput = { id: string; stageId: string; reason: string | null };

/** Lost / Nurture: a lead id, the chosen stage id and an optional short reason. The ids are only pointers; the action re-reads both. */
export function parseCloseLead(form: { get(name: string): unknown }): Parsed<CloseLeadInput> {
  const id = String(form.get("id") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: "That record couldn't be found. Refresh and try again." };
  const stageId = String(form.get("stageId") ?? "").trim();
  if (!isUuid(stageId)) return { ok: false, error: "Choose a stage to move this lead to." };
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length > CLOSE_REASON_MAX) return { ok: false, error: `Keep the reason to ${CLOSE_REASON_MAX} characters or fewer.` };
  return { ok: true, value: { id, stageId, reason: reason || null } };
}
