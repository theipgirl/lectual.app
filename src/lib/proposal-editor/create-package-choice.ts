/**
 * New proposal (Spec 6 / Spec 7 at create): "Let the client choose a package", "Discount on this brand name (%)" and
 * "Let the client choose a package for this mark", applied to the FIRST brand name the action builds.
 *
 * Pure: the action passes the posted form, the content it built and the firm's package setting it read through the
 * scoped client (`null` when that read failed). The fields are read by the SAME parsers as the editor's brand-name
 * save (`parsePackageChoiceFields`, `parseNameDiscountField` in `form.ts`), so the rules are one implementation.
 *
 * The server stays authoritative: only package NAMES on the firm's CURRENT list are accepted (an unreadable list
 * accepts none), the discount is a whole 0..50, a brand name chooses per name OR per mark, never both, and the
 * snapshot (`withPackageSnapshot`) is taken here, so the stored content passes `validateContent`'s package rules.
 * Any refusal is a fixed sentence and the action creates nothing.
 */

import { normalisePackages } from "@/lib/proposals/package-list";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { validateContent } from "@/lib/proposals/validate";
import { MARK_KIND_LABEL, MARK_KINDS, type MarkKind, type ProposalContent, type ProposalMark, type ProposalName } from "@/lib/proposals/types";
import { parseNameDiscountField, parsePackageChoiceFields, type Parsed } from "./form";

/** The prefix of a mark's package-choice fields on New proposal: by KIND, since the marks are built on the server. */
export function newMarkPackagePrefix(kind: MarkKind): string {
  return `newMark.${kind}.`;
}

export const CREATE_PACKAGES_UNREADABLE = "Couldn't read your packages, so nothing was created. Try again shortly.";
export const CREATE_PACKAGE_NOT_FIRMS = "That package isn't one of your firm's packages. Pick one from the list.";
export const CREATE_NEEDS_BRAND_NAME = "Enter a first brand name to let the client choose its package or to give it a discount.";
export const CREATE_NAME_AND_MARK_CHOICE = "Let the client choose a package for this brand name or for each mark, not both. Untick one.";

const PACKAGE_ISSUE = /(^|\.)packages(\[|$)|package_choice|discount_pct/;

export function applyNewProposalPackageFields(form: FormData, content: ProposalContent, settingPricing: unknown | null): Parsed<ProposalContent> {
  if (form.get("pkgFields") !== "1") return { ok: true, value: content };

  const nameChoice = parsePackageChoiceFields(form, "");
  if (!nameChoice.ok) return nameChoice;
  const discount = parseNameDiscountField(form);
  if (!discount.ok) return discount;
  const markChoices: Partial<Record<MarkKind, { options: string[]; default: string }>> = {};
  for (const kind of MARK_KINDS) {
    const parsed = parsePackageChoiceFields(form, newMarkPackagePrefix(kind), MARK_KIND_LABEL[kind]);
    if (!parsed.ok) return parsed;
    if (parsed.value) markChoices[kind] = parsed.value;
  }
  const markKinds = MARK_KINDS.filter((k) => markChoices[k]);
  if (!nameChoice.value && markKinds.length === 0 && discount.value === undefined) return { ok: true, value: content };

  const first = content.names[0];
  if (!first) return { ok: false, error: CREATE_NEEDS_BRAND_NAME };
  if (nameChoice.value && markKinds.length > 0) return { ok: false, error: CREATE_NAME_AND_MARK_CHOICE };

  const offered = [...(nameChoice.value?.options ?? []), ...markKinds.flatMap((k) => markChoices[k]!.options)];
  if (offered.length > 0) {
    if (settingPricing === null) return { ok: false, error: CREATE_PACKAGES_UNREADABLE };
    const firm = new Set(normalisePackages(settingPricing).map((p) => p.package));
    if (offered.some((o) => !firm.has(o))) return { ok: false, error: CREATE_PACKAGE_NOT_FIRMS };
    if (first.price_override) {
      return { ok: false, error: "A brand name whose package the client chooses can't also have its own price. Clear its own price first." };
    }
  }

  const marks: ProposalMark[] = first.marks.map((m) => ({ ...m }));
  for (const kind of markKinds) {
    const i = marks.findIndex((m) => m.kind === kind);
    if (i < 0) {
      return {
        ok: false,
        error: `The first brand name has no ${MARK_KIND_LABEL[kind].toLowerCase()}, so its package can't be chosen here. Untick it, or set it on the next page.`,
      };
    }
    marks[i] = { ...marks[i], package_choice: markChoices[kind]! };
  }
  const name: ProposalName = {
    ...first,
    marks,
    ...(nameChoice.value ? { package_choice: nameChoice.value } : {}),
    ...(discount.value !== undefined ? { discount_pct: discount.value } : {}),
  };
  const next = withPackageSnapshot({ ...content, names: [name, ...content.names.slice(1)] }, settingPricing ?? {});

  // A new draft may still lack classes, so only the rules these fields touch are checked here.
  const issue = validateContent(next).find((i) => i.level === "error" && PACKAGE_ISSUE.test(i.path));
  if (issue) return { ok: false, error: issue.message };
  return { ok: true, value: next };
}
