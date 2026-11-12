import type { LetterLogo } from "@/lib/loe/letter-logo";
import { SAMPLE_VALUES } from "@/lib/loe/fields";
import { renderLetter } from "@/lib/loe/render";
import { LETTER_PREVIEW_HEADING, LETTER_PREVIEW_NOTE } from "@/lib/ui/words";

/**
 * The letter merged with made-up client details, as text. Drawn from `renderLetter`'s plain-text blocks: every
 * value is React text, so nothing in the body or a value can become markup. An unknown field shows as an
 * inline problem instead of a half-filled letter. `logo` is the firm's own (RPB only today), centred above the text.
 */
export function LetterPreview({ body, logo }: { body: string; logo?: LetterLogo | null }) {
  const result = renderLetter(body, SAMPLE_VALUES);
  return (
    <section className="loe-preview" aria-label={LETTER_PREVIEW_HEADING}>
      <h3 className="lx-h2" style={{ fontSize: 19, margin: 0 }}>
        {LETTER_PREVIEW_HEADING}
      </h3>
      <p className="lx-note" style={{ margin: 0 }}>
        {LETTER_PREVIEW_NOTE}
      </p>
      {result.ok ? (
        <div className="loe-preview-paper" data-testid="letter-preview">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="loe-preview-logo" src={logo.src} alt={logo.alt} width={984} height={168} />
          ) : null}
          {result.blocks.map((block, i) => (
            <p key={i}>
              {block.lead ? <strong>{block.lead}</strong> : null}
              {block.lead && block.text ? " " : null}
              {block.text}
            </p>
          ))}
        </div>
      ) : (
        <ul className="loe-problems" role="alert">
          {result.errors.map((e, i) => (
            <li key={i}>{e.sentence}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
