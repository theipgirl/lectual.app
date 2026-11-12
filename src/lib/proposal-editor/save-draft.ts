import type { ProposalContent, ProposalName, ProposalRow } from "@/lib/proposals/types";
import { isGeneralContent } from "@/lib/proposals/types";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import type { UpdateProposalInput, UpdateProposalOptions } from "@/lib/proposals/store";
import { PROPOSAL_SAVE_CONFLICT } from "@/lib/proposals/store";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { wantedFromForm } from "@/lib/loe/editor-state";
import type { ApprovedRead } from "@/lib/loe/templates-store";
import { withLoeSnapshot } from "@/lib/proposals/loe-snapshot";
import { withoutLetterCheck } from "@/lib/proposals/attach-letter";
import { hasPendingLetterCheck } from "@/lib/proposals/letter-check";
import { applyGeneralForm } from "./general-form";
import {
  parseAdjustments,
  parseDetails,
  parseIncludes,
  parseMessage,
  parseName,
  parsePricing,
  replaceName,
  type Parsed,
} from "./form";

/**
 * "Save": the whole draft from ONE form post, as ONE `updateProposal` call.
 *
 * The edit page is a single form. Each brand name's fields are posted under `b.<n>.` (so several brands
 * can share one form); everything else keeps the name its section parser always read. This runs the existing
 * section parsers (`parseDetails`, `parseName` per brand, `parsePricing`, `parseMessage`, `parseAdjustments`,
 * `parseIncludes`, and `applyGeneralForm` for a flat-fee draft) on that one post, builds the one document, and
 * makes one write with the `updated_at` fence. A refusal names the section and the field and writes nothing.
 * Dependencies are injected (like create-link.ts) so the order, the single write and every refusal are
 * tested without a database. Nothing here sends anything.
 */

export type SaveDraftDeps = {
  /** The module gate and staff-role check; a refusal is returned as is, before any read. */
  gate: () => Promise<ActionState | null>;
  getRow: (id: string) => Promise<ProposalRow | null>;
  /** The firm's package settings (`client_proposal_setting.pricing`); throws when unreadable. */
  settingPricing: () => Promise<unknown>;
  /** Sprint 6: the firm's approved engagement letter of one kind, through the scoped client. Absent = the letter copy is left as it is. */
  approvedLetter?: (kind: "trademark" | "general") => Promise<ApprovedRead>;
  update: (id: string, input: UpdateProposalInput, options: UpdateProposalOptions) => Promise<ProposalRow>;
  describe: (err: unknown, fallback: string) => ActionState;
  revalidate: (id: string) => void;
  rand: () => string;
};

export const SAVED_BACK_TO_DRAFT = "Saved. Its link wasn't live yet, so it is back to draft; create the link again when it's ready.";
export const LETTER_SWITCH_UNREADABLE = "Engagement letter: couldn't load the firm's letter, so the switch wasn't changed. Try again.";
export const PACKAGES_UNREADABLE = "Couldn't load the firm's packages. Try again.";

const field = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

/** "Brand name The Fold: ..." / "Who: ...". The section always leads, so a person knows where to look. */
const refuse = (section: string, message: string): Parsed<never> => ({ ok: false, error: `${section}: ${message}` });

/** The sub-form one brand name's parser reads: every `b.<n>.<field>` with the prefix removed. */
export function brandForm(form: FormData, n: number): FormData {
  const prefix = `b.${n}.`;
  const out = new FormData();
  for (const [k, v] of form.entries()) if (k.startsWith(prefix)) out.append(k.slice(prefix.length), v);
  return out;
}

/** The brand indexes the form posted, in page order. */
export function brandIndexes(form: FormData): number[] {
  const seen = new Set<number>();
  for (const k of form.keys()) {
    const m = /^b\.(\d+)\.nameId$/.exec(k);
    if (m) seen.add(Number(m[1]));
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * "Use these package options for every brand": copies the ticked brand's package choice (one package for the whole
 * proposal, the client chooses among named packages, or a different package for each mark) onto every other brand.
 * Their own price (a brand cannot have both a price and a package choice) is refused by name, not silently cleared.
 */
export function applyPackagesToAll(names: ProposalName[], sourceIndex: number): Parsed<ProposalName[]> {
  const source = names[sourceIndex];
  if (!source) return { ok: true, value: names };
  const next: ProposalName[] = [];
  for (const [i, n] of names.entries()) {
    if (i === sourceIndex) {
      next.push(n);
      continue;
    }
    const copy: ProposalName = { ...n };
    delete copy.package_choice;
    copy.marks = n.marks.map((m, mi) => {
      const { package_choice: _drop, ...rest } = m;
      void _drop;
      const from = source.marks[mi]?.package_choice;
      return from ? { ...rest, package_choice: { options: [...from.options], default: from.default } } : rest;
    });
    if (source.package_choice) copy.package_choice = { options: [...source.package_choice.options], default: source.package_choice.default };
    const hasChoice = !!copy.package_choice || copy.marks.some((m) => m.package_choice);
    if (hasChoice && copy.price_override && Object.keys(copy.price_override).length > 0) {
      return refuse(`Brand name ${n.name || i + 1}`, "it has its own price, so it can't take the package options. Clear its own price under Advanced for this brand first.");
    }
    next.push(copy);
  }
  return { ok: true, value: next };
}

/**
 * A save of a draft that still carries the unresolved "engagement letter couldn't be attached" check (`letter-check.ts`): made
 * while the firm's letter couldn't be read, no letter on it, and nobody having chosen to send without one. The DEFAULT for such
 * a draft is the default every door applies: attach the firm's approved letter. So:
 *
 *  - the firm's letter reads, and the form's switch is on (the editor draws it ON for such a draft) or the form carries no
 *    switch at all (the page could not read the letter when it was drawn): the letter is ATTACHED, and only then is the check
 *    cleared;
 *  - the form's switch is OFF: that is a person's explicit choice to send without the letter; the check is cleared with no letter;
 *  - a successful read shows the firm has NO approved letter (or no letter table): there is nothing to attach, so the check is
 *    cleared (it could otherwise never be);
 *  - the read FAILS again: the save still succeeds, nothing is attached, and the check STAYS. It keeps blocking the link.
 *
 * The check is never cleared by an ordinary Save that did not attach the letter.
 */
export function settlePendingLetter(content: ProposalContent, form: FormData, read: ApprovedRead): ProposalContent {
  if (read.status === "unavailable") return content;
  if (read.status === "not-set-up" || read.letter === null) return withoutLetterCheck(content);
  const switchPosted = form.get("loeFields") === "1";
  const wanted = switchPosted ? form.get("loeOn") === "on" : true;
  if (!wanted) return withoutLetterCheck(withLoeSnapshot(content, read.letter, false));
  const attached = withLoeSnapshot(content, read.letter, true);
  // A letter of the other kind is not attached by `withLoeSnapshot`: there is then nothing of this kind to attach.
  return withoutLetterCheck(attached);
}

function usesPackageChoice(names: readonly ProposalName[]): boolean {
  return names.some((n) => !!n.package_choice || n.marks.some((m) => !!m.package_choice));
}

/** Builds the one update from the form and the current row. Pure apart from `settingPricing`. */
export async function buildDraftUpdate(
  form: FormData,
  current: ProposalRow,
  deps: Pick<SaveDraftDeps, "settingPricing" | "rand" | "approvedLetter">,
): Promise<Parsed<UpdateProposalInput>> {
  // Who (client name, email, first name, company, title) and, when the form carries them, the pay link and expiry date.
  const details = parseDetails(form, current.content);
  if (!details.ok) return refuse("Who", details.error);
  let content: ProposalContent = details.value.content;

  // Message: greeting, recommendation, office action note.
  const message = parseMessage(form, content);
  if (!message.ok) return refuse("Message", message.error);
  content = message.value;

  if (isGeneralContent(current.content)) {
    const general = applyGeneralForm(form, content, deps.rand);
    if (!general.ok) return refuse("Matter and flat fee", general.error);
    content = general.value;
  } else {
    // What we're protecting: each brand, through the brand parser, replaced in place.
    let applyFrom = -1;
    for (const n of brandIndexes(form)) {
      const sub = brandForm(form, n);
      const parsed = parseName(sub, content, deps.rand);
      if (!parsed.ok) return refuse(`Brand name ${field(sub, "name") || n + 1}`, parsed.error);
      const replaced = replaceName(content, parsed.value);
      if (!replaced.ok) return refuse("What we're protecting", replaced.error);
      content = replaced.value;
      if (sub.get("applyAll") === "on") applyFrom = content.names.findIndex((x) => x.id === parsed.value.id);
    }
    if (applyFrom >= 0) {
      const all = applyPackagesToAll(content.names, applyFrom);
      if (!all.ok) return all;
      content = { ...content, names: all.value };
    }

    // Fees and payment: the package and its numbers (Advanced pricing), credits and included items.
    const pricing = parsePricing(form);
    if (!pricing.ok) return refuse("Fees and payment", pricing.error);
    content = { ...content, pricing: pricing.value };
    if (form.has("incFields")) {
      const includes = parseIncludes(form);
      if (!includes.ok) return refuse("Fees and payment", includes.error);
      content = { ...content, includes: includes.value };
    }

    // A package choice reads the firm's CURRENT list into the proposal. An unreadable list saves nothing.
    if (usesPackageChoice(content.names)) {
      try {
        content = withPackageSnapshot(content, (await deps.settingPricing()) ?? {});
      } catch {
        return { ok: false, error: PACKAGES_UNREADABLE };
      }
    }
  }

  // Credits and discounts on the whole proposal (both kinds). `adjFields` says the section was on the page, so removing the last row clears it.
  if (form.has("adjFields")) {
    const credits = parseAdjustments(form, deps.rand);
    if (!credits.ok) return refuse("Fees and payment", credits.error);
    content = { ...content, adjustments: credits.value };
  }

  // The engagement letter: the switch decides, and a save refreshes the copy from the firm's CURRENT approved version (or removes it).
  if (deps.approvedLetter) {
    const read = await deps.approvedLetter(isGeneralContent(current.content) ? "general" : "trademark");
    if (hasPendingLetterCheck(current.content)) {
      content = settlePendingLetter(content, form, read);
    } else {
      const currentlyOn = !!current.content.loe;
      const wanted = wantedFromForm(form, currentlyOn);
      if (read.status === "ok") content = withLoeSnapshot(content, read.letter, wanted);
      else if (read.status === "unavailable" && wanted !== currentlyOn) return { ok: false, error: LETTER_SWITCH_UNREADABLE };
      // not-set-up, or unreadable with the switch unchanged: the copy stays exactly as it was (create-link re-checks it).
    }
  }

  const { clientName, clientEmail, title, expiresOn, payUrl } = details.value;
  return {
    ok: true,
    value: {
      content,
      clientName,
      clientEmail,
      title,
      ...(expiresOn !== undefined ? { expiresOn } : {}),
      ...(payUrl !== undefined ? { payUrl } : {}),
    },
  };
}

export async function runSaveDraft(deps: SaveDraftDeps, form: FormData): Promise<ActionState> {
  const refused = await deps.gate();
  if (refused) return refused;
  const id = field(form, "proposalId");
  // A form that did not send the `updated_at` it was rendered with is told to reload, never saved unfenced.
  const expectedUpdatedAt = field(form, "updatedAt");
  if (!expectedUpdatedAt) return { error: PROPOSAL_SAVE_CONFLICT };
  try {
    const row = await deps.getRow(id);
    if (!row) return { error: "Proposal not found." };
    const built = await buildDraftUpdate(form, row, deps);
    if (!built.ok) return { error: built.error };
    const updated = await deps.update(id, built.value, { expectedUpdatedAt });
    deps.revalidate(id);
    return { saved: true, ...(row.status === "approved" && updated.status === "draft" ? { notice: SAVED_BACK_TO_DRAFT } : {}) };
  } catch (err) {
    return deps.describe(err, "Couldn't save your changes.");
  }
}
