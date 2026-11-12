import { LOE_MAX_BODY, LOE_MAX_TITLE, findMergeFields } from "./fields";

/**
 * Template and content rules for the engagement letter. Pure; every problem is
 * returned, never only the first. The same rules guard a draft before Approve
 * and (for `loeIssues`) the `loe` block a proposal carries.
 */

export type LetterIssue = { path: "title" | "body"; message: string };

export function validateTemplate(input: { title: unknown; body: unknown }): LetterIssue[] {
  const out: LetterIssue[] = [];
  const title = typeof input.title === "string" ? input.title : "";
  const body = typeof input.body === "string" ? input.body : "";

  if (typeof input.title !== "string" || title.trim().length === 0) out.push({ path: "title", message: "Give the letter a title." });
  else if (title.length > LOE_MAX_TITLE) out.push({ path: "title", message: `The title is too long (${LOE_MAX_TITLE} characters at most).` });

  if (typeof input.body !== "string" || body.trim().length === 0) out.push({ path: "body", message: "Write the letter text." });
  else if (body.length > LOE_MAX_BODY) out.push({ path: "body", message: "The letter is too long (60,000 characters at most)." });

  if (body.length > 0) {
    const { fields, unclosed } = findMergeFields(body);
    const unknown = Array.from(new Set(fields.filter((f) => !f.allowed).map((f) => f.name)));
    for (const name of unknown) {
      out.push({ path: "body", message: `{{${name}}} is not a merge field. Use only the ones listed below the letter.` });
    }
    if (unclosed) out.push({ path: "body", message: "The letter has a {{ or }} that does not close." });
  }
  return out;
}

export type LoeContentIssue = { path: string; message: string };

/** The `loe` block of a proposal's content, against the proposal's own kind. */
export function loeIssues(loe: unknown, proposalKind: "trademark" | "general"): LoeContentIssue[] {
  const out: LoeContentIssue[] = [];
  if (!loe || typeof loe !== "object" || Array.isArray(loe)) {
    return [{ path: "loe", message: "The engagement letter on this proposal is malformed." }];
  }
  const l = loe as Record<string, unknown>;
  if (l.kind !== "trademark" && l.kind !== "general") {
    out.push({ path: "loe.kind", message: "The engagement letter must be a trademark or a flat-fee letter." });
  } else if (l.kind !== proposalKind) {
    out.push({ path: "loe.kind", message: "This engagement letter is for a different kind of proposal." });
  }
  if (typeof l.title !== "string" || l.title.trim().length === 0 || l.title.length > LOE_MAX_TITLE) {
    out.push({ path: "loe.title", message: "The engagement letter needs a title (200 characters at most)." });
  }
  if (typeof l.body !== "string" || l.body.length === 0 || l.body.length > LOE_MAX_BODY) {
    out.push({ path: "loe.body", message: "The engagement letter text must be between 1 and 60,000 characters." });
  } else {
    const { fields, unclosed } = findMergeFields(l.body);
    if (fields.some((f) => !f.allowed) || unclosed) {
      out.push({ path: "loe.body", message: "The engagement letter has a merge field that does not exist." });
    }
  }
  if (l.template_id != null && typeof l.template_id !== "string") {
    out.push({ path: "loe.template_id", message: "The engagement letter's version is malformed." });
  }
  if (l.template_version != null && (typeof l.template_version !== "number" || !Number.isInteger(l.template_version) || l.template_version < 1)) {
    out.push({ path: "loe.template_version", message: "The engagement letter's version number is malformed." });
  }
  return out;
}
