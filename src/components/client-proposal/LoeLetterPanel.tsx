import type { Agreement } from "@/lib/loe/signing";
import { LoeExhibitTable } from "./LoeExhibitTable";

/** `exhibit` is null for the stored signed text: its exhibit lines are part of the text itself, so no table is drawn. */
export type LetterView = { blocks: Agreement["blocks"]; exhibit: Agreement["exhibit"] | null };

/**
 * The FULL engagement letter, every paragraph in order (a bold lead-in first where the firm wrote one), followed by Exhibit A.
 * Nothing is shortened, summarised or collapsed. The panel may scroll when it is tall; the text is all there.
 * Every block is React text: a name or address a client typed is shown as the characters it is made of.
 */
export function LoeLetterPanel({ agreement, title, id }: { agreement: LetterView; title: string; id?: string }) {
  return (
    <div className="cp-letter" id={id} tabIndex={0} role="region" aria-label={title}>
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
