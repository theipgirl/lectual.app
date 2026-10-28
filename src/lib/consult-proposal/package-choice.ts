import { findPackageSpoken } from "@/lib/proposals/package-list";
import type { ProposalPricing } from "@/lib/proposals/types";

/**
 * Which package a consult proposal is priced with (Sprint 28 D). Pure.
 *
 * Order of authority, and no email or mailbox is ever read to decide it (Taylor, Oct 27):
 *   1. a package named in REVIEWED consult details, when it is on the firm's current list;
 *   2. the package named on the call, when it is on the list AND its name really is in the record;
 *   3. otherwise the firm's default package (the first on the list), with a CHECK FIRST flag;
 *   4. when the list could not be read or is empty: the firm's flat pricing package, and a flag says so.
 * Every choice says which source supplied it, in a flag the approver reads.
 */

export type PackageSource = "reviewed" | "call" | "default" | "flat";

export type PackageChoice = { pricing: ProposalPricing; source: PackageSource; flags: string[] };

export function choosePackage(args: {
  /** The firm's current list (first is the default); null or empty when it could not be read. */
  packages: readonly ProposalPricing[] | null | undefined;
  /** The firm's single flat pricing package (`standardProposalPricing`), used only without a list. */
  flat: ProposalPricing;
  /** From reviewed consult details only. */
  reviewedName: string | null;
  reviewedBy: string | null;
  /** The AI's report of the package named on the call. */
  callName: string | null;
  /** True when that name appears in the record the AI was shown. */
  callNameInRecord: boolean;
}): PackageChoice {
  const flags: string[] = [];
  const list = args.packages && args.packages.length > 0 ? args.packages : null;
  const called = args.callName?.trim() || null;

  if (!list) {
    flags.push(`The firm's package list couldn't be read (or is empty), so the proposal uses the firm's flat ${args.flat.package} pricing.`);
    if (called && called.toLowerCase() !== args.flat.package.toLowerCase()) {
      flags.push(`CHECK FIRST: the AI reported the package "${called}", but the firm's standard package is "${args.flat.package}". The proposal uses ${args.flat.package} pricing. Make sure that is what the attorney recommended.`);
    } else if (!called) {
      flags.push(`No package was named on the call. The proposal uses the firm's standard ${args.flat.package} pricing.`);
    }
    return { pricing: { ...args.flat }, source: "flat", flags };
  }

  const reviewed = findPackageSpoken(list, args.reviewedName);
  if (reviewed) {
    const by = args.reviewedBy ? ` (reviewed by ${args.reviewedBy})` : "";
    flags.push(`Package: ${reviewed.package}, from the reviewed consult details${by}. It is on your current list, so it is priced with ${reviewed.package}'s own price, included classes and extra-class price.`);
    if (called && findPackageSpoken(list, called)?.package !== reviewed.package) {
      flags.push(`The AI's reading of the call named "${called}"; the reviewed details were used instead.`);
    }
    return { pricing: { ...reviewed }, source: "reviewed", flags };
  }
  if (args.reviewedName?.trim()) {
    flags.push(`The reviewed consult details name "${args.reviewedName.trim()}", which isn't on your current list, so they were not used for the package.`);
  }

  const heard = findPackageSpoken(list, called);
  if (heard && args.callNameInRecord) {
    flags.push(`Package: ${heard.package}, from the call. It is on your current list, so it is priced with ${heard.package}'s own price, included classes and extra-class price. Check this is what the attorney recommended.`);
    return { pricing: { ...heard }, source: "call", flags };
  }

  const fallback = list[0];
  if (heard && !args.callNameInRecord) {
    flags.push(`CHECK FIRST: the AI reported "${called}", but that name was not found in the record, so it was not used. The proposal uses your default package (${fallback.package}). Choose the package before saving.`);
  } else if (called) {
    flags.push(`CHECK FIRST: "${called}" isn't on your list. The proposal uses your default package (${fallback.package}). Choose the package before saving.`);
  } else {
    flags.push(`CHECK FIRST: no package was recommended on the call. The proposal uses your default package (${fallback.package}). Choose the package before saving.`);
  }
  return { pricing: { ...fallback }, source: "default", flags };
}
