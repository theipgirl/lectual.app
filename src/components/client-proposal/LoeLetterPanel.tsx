import type { LetterLogo } from "@/lib/loe/letter-logo";
import type { Agreement } from "@/lib/loe/signing";
import { LoeExhibitTable } from "./LoeExhibitTable";

/** `exhibit` is null for the stored signed text: its exhibit lines are part of the text itself, so no table is drawn. */
export type LetterView = { blocks: Agreement["blocks"]; exhibit: Agreement["exhibit"] | null };

/**
 * The FULL engagement letter, every paragraph in order (a bold lead-in first where the firm wrote one), followed by Exhibit A.
 * Nothing is shortened, summarised or collapsed. The panel may scroll when it is tall; the text is all there.
 * `logo` (the firm's, RPB only today) is drawn centred above the title. Every block is React text: a name or address a client typed is shown as the characters it is made of.
 */
export function LoeLetterPanel({ agreement, title, id, logo }: { agreement: LetterView; title: string; id?: string; logo?: LetterLogo | null }) {
  return (
    <div className="cp-letter" id={id} tabIndex={0} role="region" aria-label={title}>
      {logo ? (
        // The firm's own logo, centred above the letter. A plain <img>: the page may only use /brand/ and /_next/static/ assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cp-letter-logo" src={logo.src} alt={logo.alt} width={984} height={168} />
      ) : null}
      <h3 className="cp-letter-title">{title}</h3>
      {agreement.blocks.map((b, i) => (
        <p key={i} className="cp-letter-p">
          {b.lead ? <b>{b.lead} </b> : null}
          {b.text}
        </p>
      ))}
      {agreement.exhibit ? <LoeExhibitTable exhibit={agreement.exhibit} /> : null}
    </div>
  );
}
