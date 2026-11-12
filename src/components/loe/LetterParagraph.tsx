import type { LetterBlock } from "@/lib/loe/render";
import { hasStyle, letterStyleClasses, splitFirstLine } from "@/lib/loe/letter-styles";
import "./letter-styles.css";

/**
 * ONE paragraph of the engagement letter, drawn the same way everywhere a letter is shown (the client page and "Read it again",
 * the editor's Preview, Settings' preview). Every part is React text: a name or address a client typed is the characters it is
 * made of, and never markup or a style.
 *
 * The paragraph's style (`block.style`, from the TEMPLATE's marker, `letter-styles.ts`) becomes `loe-s-<name>` classes; a block with
 * no style renders exactly as before (no class added, same children). `bold-underline-first-line` wraps the text's first line in a
 * span. `variant` keeps each surface's own markup for the lead-in: the client page puts the space inside `<b>`, the staff
 * previews use `<strong>` and a separate space.
 */
export function LetterParagraph({ block, variant, className }: { block: LetterBlock; variant: "client" | "staff"; className?: string }) {
  const styleClasses = letterStyleClasses(block);
  const cls = [className, styleClasses].filter(Boolean).join(" ") || undefined;
  const text = hasStyle(block, "bold-underline-first-line") ? <FirstLine text={block.text} /> : block.text;
  if (variant === "client") {
    return (
      <p className={cls}>
        {block.lead ? <b>{block.lead} </b> : null}
        {text}
      </p>
    );
  }
  return (
    <p className={cls}>
      {block.lead ? <strong>{block.lead}</strong> : null}
      {block.lead && block.text ? " " : null}
      {text}
    </p>
  );
}

function FirstLine({ text }: { text: string }) {
  const { first, rest } = splitFirstLine(text);
  return (
    <>
      <span className="loe-s-first-line">{first}</span>
      {rest}
    </>
  );
}
