import { brandForSlug, type ProposalBrand } from "@/components/client-proposal/format";

/**
 * The firm's logo at the top of its engagement letter, in ONE place. PURE (no fs, no server-only): the client page, the staff
 * previews and the PDF builder all ask here.
 *
 * Per firm, never another firm's: the answer follows the same signal the client page already draws RPB's branding from
 * (`brand === "rpb"`, which `brandForSlug` derives from the firm's slug). Any other firm gets null, so no logo and no
 * broken image. Only `/brand/` files may be used (the client page may reference nothing else; `tests/proposals/public-assets.test.ts`),
 * and a test checks the file exists in `public/brand/`.
 */
export type LetterLogo = { src: string; alt: string };

/** RPB's burgundy (oxblood) logo, 984 x 168. The cream variant is for dark backgrounds and vanishes on a letter. */
export const RPB_LETTER_LOGO: LetterLogo = { src: "/brand/rpb-logo-oxblood.png", alt: "RPB Law Firm" };

export function letterLogoForBrand(brand: ProposalBrand): LetterLogo | null {
  return brand === "rpb" ? RPB_LETTER_LOGO : null;
}

/** For the server paths (PDF, staff preview) that know the firm's slug rather than the page's brand. */
export function letterLogoForSlug(slug: string | null | undefined): LetterLogo | null {
  return letterLogoForBrand(brandForSlug(slug));
}
