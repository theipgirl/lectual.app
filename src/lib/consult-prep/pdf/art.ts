// Per-firm artwork and copy for the packages PDF, in ONE place (the same idea as `src/lib/loe/letter-logo.ts`).
//
// PURE: no fs, no server-only. A firm with no entry gets the PLAIN packages PDF: its own name as the wordmark and in the
// footer, and a table of only what its package list holds (classes included, the price, the additional-class fee).
//
// An entry carries what a package list cannot: the benefit rows (the firm's marketing copy, per package NAME), the
// wordmark's tagline and the footer line. It never carries a price. Every price and class count on the page comes from the
// firm's own package list; the entry's template cells for those rows are only COMPARED with the list (a stale template can
// never ship a wrong price: `template_config_mismatch`).

import { brandForSlug } from "@/components/client-proposal/format";
import rpbTemplate from "./rpb-package-template.json";

export type TemplateRow = {
  label: string;
  value?: string;
  note?: string;
  cells: string[];
  cls?: string;
};

export type PackageTemplate = {
  packages: {
    tiers: { name: string; price: string }[];
    rows: TemplateRow[];
  };
};

export type PackagesArt = {
  /** The wordmark in the top band, e.g. "RPB LAW FIRM". */
  wordmark: string;
  /** The small line under the wordmark, or null for none. */
  established: string | null;
  /** The footer's first line: a bold part and the rest. */
  footerBold: string;
  footerRest: string;
  /** The firm's name as it reads in the page-2 title ("<Client> – <titleFirm> Trademark Proposal"). */
  titleFirm: string;
  /** The PDF's Author field. */
  author: string;
  /** The benefit rows and the tiers they were written for. */
  template: PackageTemplate;
};

/** RPB Law's packages PDF: the benefit copy of the firm's `package-proposal.example.json` (lectual-plugin). */
export const RPB_PACKAGES_ART: PackagesArt = {
  wordmark: "RPB LAW FIRM",
  established: "EST 2024",
  footerBold: "RPB Law Firm, PLLC",
  footerRest: " · Miami & New York · www.rpblawfirm.com",
  titleFirm: "RPB Law",
  author: "RPB Law Firm, PLLC",
  template: rpbTemplate as unknown as PackageTemplate,
};

/** The art for a firm's slug (the signal the client page already brands from), or null for the plain version. */
export function packagesArtForSlug(slug: string | null | undefined): PackagesArt | null {
  return brandForSlug(slug) === "rpb" ? RPB_PACKAGES_ART : null;
}
