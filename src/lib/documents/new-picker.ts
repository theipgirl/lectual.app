import { buildPicker, type ListRead, type PickerDestination, type PickerView } from "@/lib/proposals/new-picker";
import { normalizeTerm } from "@/lib/skills/pick";
import type { RecordKind } from "@/lib/skills/catalog";

/**
 * New document's "Who is this for?". The picker, its search, the 8-row cap and "Showing N of M" are New
 * proposal's own (src/lib/proposals/new-picker.ts, which reuses src/lib/skills/pick.ts); this file only says
 * where a choice goes and how a lead finds its matter. PURE.
 *
 * A letter is drafted on a matter. Choosing a matter goes to its template choice. Choosing a lead goes to this
 * page with `?lead=<id>`, which finds the lead's open matters: one goes straight to its template choice, several
 * are listed, none says to open a matter first. There is no "Start blank".
 */

export const NEW_LETTER_PATH = "/dashboard/documents/new/";

export const matterTemplateHref = (matterId: string): string => `${NEW_LETTER_PATH}${encodeURIComponent(matterId)}/`;

const withTerm = (base: string, term: string): string => (term ? `${base}&q=${encodeURIComponent(term)}` : base);

export const LETTER_DESTINATION: PickerDestination = {
  basePath: NEW_LETTER_PATH,
  chooseHref: (kind, id, term) =>
    kind === "matter" ? matterTemplateHref(id) : withTerm(`${NEW_LETTER_PATH}?lead=${encodeURIComponent(id)}`, normalizeTerm(term)),
  blankHref: null,
};

/** Letters are drafted on matters, so the list opens on Matters unless the person switched to Leads. */
export function letterKind(raw: string | string[] | undefined | null): RecordKind {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first === "lead" ? "lead" : "matter";
}

export function buildLetterPicker(input: { kind: RecordKind; term: string; leads: ListRead; matters: ListRead }): PickerView {
  return buildPicker({ ...input, dest: LETTER_DESTINATION });
}

export type LeadMatter = { id: string; label: string; detail: string | null };

export type LeadRoute =
  | { kind: "redirect"; href: string }
  | { kind: "choose"; matters: Array<LeadMatter & { href: string }> }
  | { kind: "none"; message: string; leadHref: string }
  | { kind: "failed"; message: string };

export const LETTER_NEEDS_MATTER = (leadLabel: string): string => `Letters are drafted on a matter. Open a matter for ${leadLabel} first.`;
export const LEAD_MATTERS_FAILED = "We couldn't load this lead's matters. Try again shortly.";

/** What choosing a lead does, from the lead's open matters. A failed read is never the 'none' message. */
export function routeLead(input: {
  leadId: string;
  leadLabel: string;
  matters: { status: "ok"; open: LeadMatter[] } | { status: "failed" };
}): LeadRoute {
  if (input.matters.status === "failed") return { kind: "failed", message: LEAD_MATTERS_FAILED };
  const open = input.matters.open;
  if (open.length === 0) {
    return { kind: "none", message: LETTER_NEEDS_MATTER(input.leadLabel), leadHref: `/dashboard/leads/${encodeURIComponent(input.leadId)}/` };
  }
  if (open.length === 1) return { kind: "redirect", href: matterTemplateHref(open[0].id) };
  return { kind: "choose", matters: open.map((m) => ({ ...m, href: matterTemplateHref(m.id) })) };
}
