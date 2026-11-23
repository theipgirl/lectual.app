import type { Role } from "@/lib/auth/roles";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { SIGNING_WORDS_APPROVED_NOTICE, SIGNING_WORDS_PROBLEM } from "@/lib/ui/words";
import { draftBlockingIssues, WORDS_FIELDS, WORDS_LABELS, wordsIssues, type SigningWords, type WordsIssue } from "./signing-words";
import { WORDS_GENERIC_ERROR, WORDS_NOT_ALLOWED, WORDS_NOT_SET_UP, wordsErrorSentence } from "./signing-words-errors";
import type { WordsVersionRead, WordsWrite } from "./signing-words-store";

/**
 * The signing words settings actions, every dependency injected (like `letter-actions.ts`), so they are tested without a database.
 * Each run re-resolves the feature gate (`notFound()` when proposals are off) and the caller's role BEFORE reading anything. The
 * admin tier edits; Approve is allowed only to a named approver whose role can write proposals. RLS and 0117's trigger are the
 * boundary underneath. Every outcome is a fixed sentence; nothing the database or the words say is passed through or logged.
 */

export type WordsDeps = {
  requireModule(): Promise<void>;
  role(): Promise<Role | null>;
  /** true / false, or null when who may approve could not be read. */
  isApprover(): Promise<boolean | null>;
  orgId(): Promise<string | null>;
  readVersion(id: string): Promise<WordsVersionRead>;
  createDraft(args: { orgId: string; words: SigningWords }): Promise<WordsWrite>;
  saveDraft(id: string, words: SigningWords): Promise<WordsWrite>;
  approve(id: string): Promise<WordsWrite>;
  revalidate(): void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANT_FIND = "Those signing words couldn't be found.";

const text = (formData: FormData, key: string): string => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

function wordsFrom(formData: FormData): SigningWords {
  const out = {} as SigningWords;
  for (const f of WORDS_FIELDS) out[f] = text(formData, f);
  return out;
}

export function issueSentence(i: WordsIssue): string {
  return `${WORDS_LABELS[i.field]} ${SIGNING_WORDS_PROBLEM[i.problem]}.`;
}

const asIssues = (issues: WordsIssue[]) => issues.map((i) => ({ path: i.field, message: issueSentence(i), level: "error" as const }));

async function gateEdit(deps: WordsDeps): Promise<ActionState | null> {
  await deps.requireModule();
  const role = await deps.role();
  return role && PROPOSAL_ADMIN_ROLES.includes(role) ? null : { error: WORDS_NOT_ALLOWED };
}

/** A new draft: typed words, or a copy of an earlier version (re-read here, never taken from the browser). */
export async function runStartWordsDraft(deps: WordsDeps, formData: FormData): Promise<ActionState> {
  const no = await gateEdit(deps);
  if (no) return no;
  const fromId = text(formData, "versionId");
  let words: SigningWords;
  if (fromId) {
    if (!UUID.test(fromId)) return { error: CANT_FIND };
    const read = await deps.readVersion(fromId);
    if (read.status === "not-set-up") return { error: WORDS_NOT_SET_UP };
    if (read.status === "unavailable") return { error: WORDS_GENERIC_ERROR };
    if (read.status === "none") return { error: CANT_FIND };
    words = read.version;
  } else {
    words = wordsFrom(formData);
    const blocking = draftBlockingIssues(words);
    if (blocking.length > 0) return { error: issueSentence(blocking[0]), issues: asIssues(blocking) };
  }
  const orgId = await deps.orgId();
  if (!orgId) return { error: WORDS_GENERIC_ERROR };
  const made = await deps.createDraft({ orgId, words });
  if (!made.ok) return { error: made.error };
  deps.revalidate();
  return { saved: true };
}

/** Saves a draft. A merge-field problem is allowed in a draft; Approve refuses it. */
export async function runSaveWordsDraft(deps: WordsDeps, formData: FormData): Promise<ActionState> {
  const no = await gateEdit(deps);
  if (no) return no;
  const id = text(formData, "id");
  if (!UUID.test(id)) return { error: CANT_FIND };
  const words = wordsFrom(formData);
  const blocking = draftBlockingIssues(words);
  if (blocking.length > 0) return { error: issueSentence(blocking[0]), issues: asIssues(blocking) };
  const saved = await deps.saveDraft(id, words);
  if (!saved.ok) return { error: saved.error };
  deps.revalidate();
  const rest = wordsIssues(words);
  return { saved: true, ...(rest.length > 0 ? { issues: asIssues(rest) } : {}) };
}

/** Approves a saved draft: a named approver only, and only words that pass every rule. */
export async function runApproveWords(deps: WordsDeps, formData: FormData): Promise<ActionState> {
  await deps.requireModule();
  const role = await deps.role();
  if (!role || !PROPOSAL_STAFF_WRITE_ROLES.includes(role)) return { error: WORDS_NOT_ALLOWED };
  const id = text(formData, "id");
  if (!UUID.test(id)) return { error: CANT_FIND };

  const named = await deps.isApprover();
  if (named === null) return { error: "Who can approve the signing words couldn't be loaded. Refresh to try again." };
  if (!named) return { error: wordsErrorSentence({ message: "signing_words_not_approver" }) };

  const read = await deps.readVersion(id);
  if (read.status === "not-set-up") return { error: WORDS_NOT_SET_UP };
  if (read.status === "unavailable") return { error: WORDS_GENERIC_ERROR };
  if (read.status === "none") return { error: CANT_FIND };
  if (read.version.status !== "draft") return { error: wordsErrorSentence({ message: "signing_words_frozen" }) };

  const issues = wordsIssues(read.version);
  if (issues.length > 0) return { error: issueSentence(issues[0]), issues: asIssues(issues) };

  const done = await deps.approve(id);
  if (!done.ok) return { error: done.error };
  deps.revalidate();
  return { saved: true, notice: SIGNING_WORDS_APPROVED_NOTICE };
}
