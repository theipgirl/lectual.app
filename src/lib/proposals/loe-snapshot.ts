/**
 * The engagement letter snapshot on a proposal's content (lectual 0106).
 *
 * Pure (no database): the server actions read the firm's approved template through
 * the scoped client and pass it in. The copy is refreshed on every save of a draft,
 * the same way the package snapshot is, so once the link is live the client signs
 * exactly the letter this version carried. It never mutates its input.
 */

import type { ProposalContent, ProposalKind, ProposalLoe } from "./types";

/** What the snapshot needs from an approved `client_proposal_loe_template` row. */
export type ApprovedLetter = {
  id: string;
  kind: ProposalKind;
  version: number;
  title: string;
  body: string;
};

function contentKind(content: ProposalContent): ProposalKind {
  return content.kind === "general" ? "general" : "trademark";
}

/**
 * - `wanted` false, no approved template, or a template of the other kind: the `loe` key is removed.
 * - Otherwise `loe` is set to a copy of the approved version, replacing a stale copy.
 * A new object is always returned; `content` is left as it was.
 */
export function withLoeSnapshot(
  content: ProposalContent,
  approved: ApprovedLetter | null,
  wanted: boolean,
): ProposalContent {
  const { loe: _previous, ...rest } = content;
  void _previous;
  if (!wanted || !approved || approved.kind !== contentKind(content)) return { ...rest } as ProposalContent;
  const loe: ProposalLoe = {
    kind: approved.kind,
    template_id: approved.id,
    template_version: approved.version,
    title: approved.title,
    body: approved.body,
  };
  return { ...rest, loe } as ProposalContent;
}

/** True when the copy on the proposal is the firm's current approved version. */
export function loeIsCurrent(content: ProposalContent, approved: ApprovedLetter | null): boolean {
  if (!content.loe) return false;
  if (!approved) return false;
  const l = content.loe;
  return l.template_id === approved.id && l.template_version === approved.version && l.title === approved.title && l.body === approved.body && l.kind === approved.kind;
}
