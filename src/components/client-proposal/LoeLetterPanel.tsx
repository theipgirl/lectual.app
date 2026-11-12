import type { LetterLogo } from "@/lib/loe/letter-logo";
import type { Agreement } from "@/lib/loe/signing";
import { LetterParagraph } from "@/components/loe/LetterParagraph";
import { LoeExhibitTable } from "./LoeExhibitTable";

/** `exhibit` is null for the stored signed text: its exhibit lines are part of the text itself, so no table is drawn. */
export type LetterView = { blocks: Agreement["blocks"]; exhibit: Agreement["exhibit"] | null };

/**
 * The FULL engagement letter, every paragraph in order (a bold lead-in first where the firm wrote one), followed by Exhibit A.
 * Nothing is shortened, summarised or collapsed. The panel may scroll when it is tall; the text is all there.
 * `logo` (the firm's, RPB only today) is drawn centred under the panel's title, at the top of the letter itself. A paragraph's style (centred, indented, a rule below...) is
 * the template's own (`letter-styles.ts`), drawn by `LetterParagraph`. Every block is React text: a name or address a client typed is shown as the characters it is made of.
 */
export function LoeLetterPanel({ agreement, title, id, logo }: { agreement: LetterView; title: string; id?: string; logo?: LetterLogo | null }) {
  return (
    <div className="cp-letter" id={id} tabIndex={0} role="region" aria-label={title}>
      <h3 className="cp-letter-title">{title}</h3>
      {logo ? (
        // The firm's own logo, centred at the top of the letter, directly above its letterhead lines (so nothing comes between the
        // logo and the address line under it). A plain <img>: the page may only use /brand/ and /_next/static/ assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cp-letter-logo" src={logo.src} alt={logo.alt} width={984} height={168} />
      ) : null}
      {agreement.blocks.map((b, i) => (
        <LetterParagraph key={i} block={b} variant="client" className="cp-letter-p" />
      ))}
      {agreement.exhibit ? <LoeExhibitTable exhibit={agreement.exhibit} /> : null}
    </div>
  );
}
