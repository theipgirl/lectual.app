/**
 * Classes the client adds on `/p/<token>` (Sprint 28 B). Pure.
 *
 * The browser sends DESCRIPTIONS only, keyed by brand name id. This module turns
 * them into one more ticked class on that brand name (a server-made id, the
 * description as its label, `client_added: true`) and then prices the result with
 * `quoteProposal`, the same function the page and the staff editor run. There is
 * no second price calculation: an added class costs exactly what a class staff
 * had ticked past the package's included count would cost, including the
 * second-mark percent on its legal fee, and the USPTO fee per class per mark.
 */

import { repairSelection } from "./class-lock";
import { quoteProposal } from "./pricing";
import type { ProposalClass, ProposalContent, ProposalQuote, Selection } from "./types";

export const MAX_ADDED_CLASSES_PER_NAME = 5;
export const MAX_ADDED_CLASS_CHARS = 200;

/** Added-class descriptions by brand name id. */
export type AddedClasses = Record<string, string[]>;

/** The one sentence a refused request gets, whatever the reason. */
export const ADDED_CLASS_REFUSAL = "We couldn’t add that class. Check the descriptions and try again.";

export type AddedClassReason = "shape" | "unknown_name" | "too_many" | "too_long" | "empty" | "markup";

export type CleanedDescription = { ok: true; text: string } | { ok: false; reason: AddedClassReason };

// Angle brackets (markup) and control characters (newlines, NUL, DEL...). Refused, not cleaned.
const MARKUP = /[<>]/;
function hasControlCharacter(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

export function cleanAddedDescription(raw: unknown): CleanedDescription {
  if (typeof raw !== "string") return { ok: false, reason: "shape" };
  const text = raw.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_ADDED_CLASS_CHARS) return { ok: false, reason: "too_long" };
  if (MARKUP.test(text) || hasControlCharacter(text)) return { ok: false, reason: "markup" };
  return { ok: true, text };
}

export type ParsedAddedClasses = { ok: true; added: AddedClasses } | { ok: false; reason: AddedClassReason };

/**
 * Whatever the browser posted, checked against the stored content. Anything
 * outside the limits refuses the whole request (nothing is half-recorded).
 * `undefined`/`null` is "none added". A brand name the client has no ticked mark
 * for is dropped: nothing is bought there, so nothing is added.
 */
export function parseAddedClasses(content: ProposalContent, selection: Selection, raw: unknown): ParsedAddedClasses {
  if (raw == null) return { ok: true, added: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "shape" };
  const names = new Map((content.names ?? []).map((n) => [n.id, n]));
  const added: AddedClasses = {};
  for (const [nameId, list] of Object.entries(raw as Record<string, unknown>)) {
    const nm = names.get(nameId);
    if (!nm) return { ok: false, reason: "unknown_name" };
    if (!Array.isArray(list)) return { ok: false, reason: "shape" };
    if (list.length > MAX_ADDED_CLASSES_PER_NAME) return { ok: false, reason: "too_many" };
    const cleaned: string[] = [];
    for (const item of list) {
      const one = cleanAddedDescription(item);
      if (!one.ok) return one;
      cleaned.push(one.text);
    }
    const bought = (nm.marks ?? []).some((m) => selection[m.id] === true);
    if (cleaned.length > 0 && bought) added[nameId] = cleaned;
  }
  return { ok: true, added };
}

/** The id for the nth added class of a brand name, never one the content already uses. */
export function addedClassId(content: ProposalContent, nameId: string, index: number): string {
  const used = new Set<string>();
  for (const nm of content.names ?? []) {
    for (const m of nm.marks ?? []) used.add(m.id);
    for (const c of nm.classes ?? []) used.add(c.id);
  }
  let id = `add-${nameId}-${index + 1}`;
  while (used.has(id)) id = `${id}x`;
  return id;
}

/** Content with each added description appended to its brand name as a ticked class, plus the selection that ticks them. */
export function withAddedClasses(
  content: ProposalContent,
  selection: Selection,
  added: AddedClasses,
): { content: ProposalContent; selection: Selection } {
  const nextSelection: Selection = { ...selection };
  const names = (content.names ?? []).map((nm) => {
    const list = added[nm.id];
    if (!list || list.length === 0) return nm;
    const extra: ProposalClass[] = [];
    // Ids are made against the content as it grows so two added classes never collide.
    let working: ProposalContent = { ...content, names: (content.names ?? []).map((x) => (x.id === nm.id ? { ...x, classes: [...x.classes] } : x)) };
    list.forEach((label, i) => {
      const id = addedClassId(working, nm.id, i);
      const cls: ProposalClass = { id, label, preselected: true, client_added: true };
      extra.push(cls);
      nextSelection[id] = true;
      working = { ...working, names: working.names.map((x) => (x.id === nm.id ? { ...x, classes: [...x.classes, cls] } : x)) };
    });
    return { ...nm, classes: [...nm.classes, ...extra] };
  });
  return { content: { ...content, names }, selection: nextSelection };
}

export type PricedWithAdded =
  | { ok: true; content: ProposalContent; selection: Selection; quote: ProposalQuote }
  /** `repair` was asked for and a ticked mark has no class to fall back on. */
  | { ok: false; nameId: string };

/**
 * THE shared priced-quote helper: the page's live total and the accept path both
 * call this, and it only ever prices through `quoteProposal` over the augmented
 * content. `repair` (the accept path) first ticks the first class of any brand
 * name whose mark is ticked with no class; the page leaves it off and warns instead.
 */
export function quoteWithAddedClasses(
  content: ProposalContent,
  selection: Selection,
  added: AddedClasses,
  options: { repair?: boolean } = {},
): PricedWithAdded {
  const augmented = withAddedClasses(content, selection, added);
  let picked = augmented.selection;
  if (options.repair) {
    const fixed = repairSelection(augmented.content, picked);
    if (!fixed.ok) return fixed;
    picked = fixed.selection;
  }
  return { ok: true, content: augmented.content, selection: picked, quote: quoteProposal(augmented.content, picked) };
}

/** How many classes the client added, across all brand names (what notes and notices say). */
export function addedClassCount(content: ProposalContent): number {
  return (content.names ?? []).reduce((sum, nm) => sum + (nm.classes ?? []).filter((c) => c.client_added === true).length, 0);
}
