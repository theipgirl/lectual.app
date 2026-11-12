import type { Role } from "@/lib/auth/roles";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import type { ValidationIssue } from "@/lib/proposals/validate";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { letterErrorSentence, LETTER_GENERIC_ERROR, LETTER_NOT_ALLOWED } from "./errors";
import { isLoeKindName } from "./kinds";
import type { LetterVersion } from "./page-model";
import type { LetterWrite } from "./templates-store";
import { LOE_MAX_BODY } from "./fields";
import { validateTemplate, type LetterIssue } from "./validate";
import { notReadyYet } from "@/lib/ui/words";

/**
 * The logic of the Engagement letter settings actions, with every dependency injected so it is
 * tested without a database or a request. The `"use server"` file (`actions.ts`) wires the real ones.
 *
 * Each run re-resolves the feature gate (the module check answers `notFound()` when the firm has
 * proposals off) and the caller's role BEFORE reading anything, because a server action is its own
 * POST entry point that never renders the page. RLS and lectual 0106's trigger are the boundary
 * underneath. Every outcome is a fixed sentence mapped from the migration's prefixes; nothing the
 * database or the letter says is passed through, and nothing typed is logged.
 */

export type LetterActionState = ActionState;

const asIssues = (issues: LetterIssue[]): ValidationIssue[] => issues.map((i) => ({ path: i.path, message: i.message, level: "error" }));

export type LetterDeps = {
  /** Runs the `proposals` feature gate; throws `notFound()` when it is off. */
  requireModule(): Promise<void>;
  role(): Promise<Role | null>;
  /** true / false, or null when who may approve could not be read. */
  isApprover(): Promise<boolean | null>;
  orgId(): Promise<string | null>;
  readVersion(id: string): Promise<{ status: "ok"; version: LetterVersion } | { status: "none" } | { status: "not-set-up" } | { status: "unavailable" }>;
  createDraft(args: { orgId: string; kind: "trademark" | "general"; title: string; body: string }): Promise<LetterWrite>;
  saveDraft(id: string, input: { title: string; body: string }): Promise<LetterWrite>;
  approve(id: string): Promise<LetterWrite>;
  revalidate(): void;
};

const text = (formData: FormData, key: string): string => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CANT_FIND = "That letter couldn't be found.";
const NOT_SET_UP = notReadyYet("The engagement letter");

async function gateEdit(deps: LetterDeps): Promise<LetterActionState | null> {
  await deps.requireModule();
  const role = await deps.role();
  return role && PROPOSAL_ADMIN_ROLES.includes(role) ? null : { error: LETTER_NOT_ALLOWED };
}

function refused(w: Extract<LetterWrite, { ok: false }>): LetterActionState {
  return { error: w.error };
}

/** A brand-new draft from a typed title and text. */
export async function runStartDraft(deps: LetterDeps, formData: FormData): Promise<LetterActionState> {
  const no = await gateEdit(deps);
  if (no) return no;
  const kind = text(formData, "kind");
  if (!isLoeKindName(kind)) return { error: CANT_FIND };
  const title = text(formData, "title").trim();
  const body = text(formData, "body");
  const issues = validateTemplate({ title, body });
  // A draft may carry a merge-field problem (the page shows it inline); an empty or oversize one cannot be stored.
  const blocking = issues.filter((i) => i.message.startsWith("Give") || i.message.startsWith("Write") || /too long/.test(i.message));
  if (blocking.length > 0) return { error: blocking[0].message, issues: asIssues(blocking) };
  const orgId = await deps.orgId();
  if (!orgId) return { error: LETTER_GENERIC_ERROR };
  const made = await deps.createDraft({ orgId, kind, title, body });
  if (!made.ok) return refused(made);
  deps.revalidate();
  return { saved: true };
}

/** A new draft that starts as a copy of an approved or retired version. The text is re-read here, never taken from the browser. */
export async function runStartFromVersion(deps: LetterDeps, formData: FormData): Promise<LetterActionState> {
  const no = await gateEdit(deps);
  if (no) return no;
  const id = text(formData, "versionId");
  if (!UUID.test(id)) return { error: CANT_FIND };
  const read = await deps.readVersion(id);
  if (read.status === "not-set-up") return { error: NOT_SET_UP };
  if (read.status === "unavailable") return { error: LETTER_GENERIC_ERROR };
  if (read.status === "none") return { error: CANT_FIND };
  const orgId = await deps.orgId();
  if (!orgId) return { error: LETTER_GENERIC_ERROR };
  const made = await deps.createDraft({ orgId, kind: read.version.kind, title: read.version.title, body: read.version.body });
  if (!made.ok) return refused(made);
  deps.revalidate();
  return { saved: true };
}

/** Saves a draft's title and text. A merge-field problem is allowed in a draft; Approve refuses it. */
export async function runSaveDraft(deps: LetterDeps, formData: FormData): Promise<LetterActionState> {
  const no = await gateEdit(deps);
  if (no) return no;
  const id = text(formData, "id");
  if (!UUID.test(id)) return { error: CANT_FIND };
  const title = text(formData, "title").trim();
  const body = text(formData, "body");
  if (body.length > LOE_MAX_BODY) return { error: "The letter is too long (60,000 characters at most)." };
  const issues = validateTemplate({ title, body });
  const blocking = issues.filter((i) => i.message.startsWith("Give") || i.message.startsWith("Write") || /too long/.test(i.message));
  if (blocking.length > 0) return { error: blocking[0].message, issues: asIssues(blocking) };
  const saved = await deps.saveDraft(id, { title, body });
  if (!saved.ok) return refused(saved);
  deps.revalidate();
  return { saved: true, ...(issues.length > 0 ? { issues: asIssues(issues) } : {}) };
}

/** Approves a saved draft: a named approver only, and only a draft that passes every template rule. */
export async function runApprove(deps: LetterDeps, formData: FormData): Promise<LetterActionState> {
  await deps.requireModule();
  const role = await deps.role();
  if (!role || !PROPOSAL_STAFF_WRITE_ROLES.includes(role)) return { error: LETTER_NOT_ALLOWED };
  const id = text(formData, "id");
  if (!UUID.test(id)) return { error: CANT_FIND };

  const named = await deps.isApprover();
  if (named === null) return { error: "Who can approve the letter couldn't be loaded. Refresh to try again." };
  if (!named) return { error: letterErrorSentence({ message: "loe_template_not_approver" }) };

  const read = await deps.readVersion(id);
  if (read.status === "not-set-up") return { error: NOT_SET_UP };
  if (read.status === "unavailable") return { error: LETTER_GENERIC_ERROR };
  if (read.status === "none") return { error: CANT_FIND };
  if (read.version.status !== "draft") return { error: letterErrorSentence({ message: "loe_template_frozen" }) };

  const issues = validateTemplate({ title: read.version.title, body: read.version.body });
  if (issues.length > 0) return { error: "Fix the problems in the letter before approving.", issues: asIssues(issues) };

  const done = await deps.approve(id);
  if (!done.ok) return refused(done);
  deps.revalidate();
  return { saved: true, notice: "Approved. New proposals will attach this letter." };
}
