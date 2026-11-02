/**
 * Spec 9: the form for a general (flat-fee) proposal, as New proposal and the editor post it, read into the
 * `content.general` block. Pure (FormData in, a block or one fixed sentence out), so it is tested without a server.
 *
 * Fields:
 *   matterTitle, summary, fee ($), excludes (one line each), termsNote, and, in the editor, greeting;
 *   item.<n>.id / label / hours / rate ($ an hour) / value ($): one work item per row. A row with every field
 *   blank is skipped (the form always shows a spare one). Money is dollars in the form and cents in the block;
 *   no amount is worked out here (an item's value is `pricing.ts#generalItemValue`). Everything is the staff
 *   member's own words: nothing here writes text for the client.
 */

import { centsToInput } from "@/lib/quotes/money";
import { GENERAL_PRICING_STUB, type GeneralBlock, type GeneralItem, type ProposalContent } from "@/lib/proposals/types";
import { GENERAL_LIMITS, isQuarterHours } from "@/lib/proposals/validate";
import { cleanId, collectRows, defaultGreeting, parseMoney, type Parsed } from "./form";

const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (error: string): Parsed<never> => ({ ok: false, error });

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** "2.5", "1", "0.25" -> hours in quarter steps; anything else is refused with the row's number. */
function parseHours(raw: string, row: number): Parsed<number> {
  const n = /^\d{1,3}(?:\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
  if (!isQuarterHours(n)) return fail(`Work ${row}: hours go in quarter-hour steps (like 0.25, 1 or 2.5), at most ${GENERAL_LIMITS.maxHours}.`);
  return ok(n);
}

/** The work items, in row order. A blank row is skipped; a row with numbers but no label is refused. */
export function parseGeneralItems(form: FormData, rand: () => string): Parsed<GeneralItem[]> {
  const rows = collectRows(form, "item", ["id", "label", "hours", "rate", "value"]);
  const taken = new Set<string>();
  const items: GeneralItem[] = [];
  let shown = 0;
  for (const r of rows) {
    if (!r.label && !r.hours && !r.rate && !r.value) continue;
    shown += 1;
    if (!r.label) return fail(`Work ${shown}: say what this piece of work is.`);
    if (r.label.length > GENERAL_LIMITS.itemLabel) return fail(`Work ${shown}: keep it to ${GENERAL_LIMITS.itemLabel} characters.`);
    const item: GeneralItem = { id: cleanId(r.id, "w", taken, rand), label: r.label };
    if (r.hours) {
      const h = parseHours(r.hours, shown);
      if (!h.ok) return h;
      item.hours = h.value;
    }
    if (r.rate) {
      if (!r.hours) return fail(`Work ${shown}: give the hours with the hourly rate, or a value instead.`);
      const rate = parseMoney(r.rate, `Work ${shown} hourly rate`);
      if (!rate.ok) return rate;
      if (rate.value <= 0) return fail(`Work ${shown} hourly rate: enter an amount above zero.`);
      item.rate_cents = rate.value;
    }
    if (r.value) {
      const value = parseMoney(r.value, `Work ${shown} value`);
      if (!value.ok) return value;
      item.value_cents = value.value;
    }
    items.push(item);
  }
  if (items.length === 0) return fail("Add at least one piece of work.");
  if (items.length > GENERAL_LIMITS.items) return fail(`Use at most ${GENERAL_LIMITS.items} pieces of work.`);
  return ok(items);
}

/** The whole general block from the form. */
export function parseGeneralForm(form: FormData, rand: () => string): Parsed<GeneralBlock> {
  const matterTitle = text(form, "matterTitle");
  if (!matterTitle) return fail("Matter: name the matter.");
  if (matterTitle.length > GENERAL_LIMITS.matterTitle) return fail(`Matter: keep the title to ${GENERAL_LIMITS.matterTitle} characters.`);
  const summary = text(form, "summary");
  if (summary.length > GENERAL_LIMITS.summary) return fail(`Summary: keep it to ${GENERAL_LIMITS.summary.toLocaleString("en-US")} characters.`);

  const items = parseGeneralItems(form, rand);
  if (!items.ok) return items;

  const fee = parseMoney(text(form, "fee"), "Flat fee");
  if (!fee.ok) return fee;
  if (fee.value <= 0) return fail("Flat fee: enter an amount above zero.");

  const excludes = text(form, "excludes")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (excludes.length > GENERAL_LIMITS.excludes) return fail(`Not included: use at most ${GENERAL_LIMITS.excludes} lines.`);
  if (excludes.some((l) => l.length > GENERAL_LIMITS.excludeLine)) return fail(`Not included: keep each line to ${GENERAL_LIMITS.excludeLine} characters.`);

  const termsNote = text(form, "termsNote");
  if (termsNote.length > GENERAL_LIMITS.termsNote) return fail(`Terms note: keep it to ${GENERAL_LIMITS.termsNote} characters.`);

  return ok({
    matter_title: matterTitle,
    ...(summary ? { summary } : {}),
    items: items.value,
    fee_cents: fee.value,
    ...(excludes.length > 0 ? { excludes } : {}),
    ...(termsNote ? { terms_note: termsNote } : {}),
  });
}

/** The title a new general proposal gets when none is typed. */
export const GENERAL_PROPOSAL_TITLE = "Proposal";

/** The greeting a new general proposal starts with. Staff can change it in the editor. */
export function defaultGeneralGreeting(firstName: string): string {
  return defaultGreeting(firstName).replace(" for your strategy call", "");
}

/** The document a new general proposal starts as. No trademark: no brand names, packages or USPTO fee. */
export function buildGeneralContent(input: { firstName: string; fullName: string; company?: string; general: GeneralBlock }): ProposalContent {
  const company = input.company?.trim();
  return {
    kind: "general",
    general: input.general,
    client: { first_name: input.firstName.trim(), full_name: input.fullName.trim(), ...(company ? { company } : {}) },
    greeting: defaultGeneralGreeting(input.firstName),
    pricing: { ...GENERAL_PRICING_STUB },
    names: [],
    adjustments: [],
    includes: [],
  };
}

/** The editor's save: the new block (and greeting, when the form carries it) on the current document. */
export function applyGeneralForm(form: FormData, current: ProposalContent, rand: () => string): Parsed<ProposalContent> {
  if (current.kind !== "general") return fail("This is a trademark proposal. Its matter and flat fee can't be set here.");
  const general = parseGeneralForm(form, rand);
  if (!general.ok) return general;
  const next: ProposalContent = { ...current, general: general.value };
  if (form.has("greeting")) {
    const greeting = text(form, "greeting");
    if (!greeting) return fail("Greeting: write the greeting paragraph.");
    next.greeting = greeting;
  }
  return ok(next);
}

/** A general block as the form's inputs are pre-filled. */
export type GeneralFormValues = {
  matterTitle: string;
  summary: string;
  fee: string;
  excludes: string;
  termsNote: string;
  items: Array<{ id: string; label: string; hours: string; rate: string; value: string }>;
};

export function generalFormValues(g: GeneralBlock | undefined): GeneralFormValues {
  const money = (c: number | undefined) => (typeof c === "number" && Number.isFinite(c) ? centsToInput(c) : "");
  return {
    matterTitle: g?.matter_title ?? "",
    summary: g?.summary ?? "",
    fee: money(g?.fee_cents),
    excludes: (g?.excludes ?? []).join("\n"),
    termsNote: g?.terms_note ?? "",
    items: (g?.items ?? []).map((it) => ({
      id: it.id,
      label: it.label,
      hours: typeof it.hours === "number" ? String(it.hours) : "",
      rate: money(it.rate_cents),
      value: money(it.value_cents),
    })),
  };
}
