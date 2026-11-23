import { SIGNED_CARD_HEADING, SIGNING_LINK_HEADING } from "@/lib/ui/words";

/**
 * The staff proposal page's one line for a LIVE version's emailed signing link (lectual 0117, Sprint B): sent / opened / consent given /
 * signed / expired / closed, drawn from `requestStatusLine` (the newest request's granted columns, three-state). Read only; nothing here
 * sends or changes a link. The page mounts it only for a role that may read signature records and only when there is a line.
 */
export function SigningLinkCard({ line }: { line: string }) {
  return (
    <section className="lx-card pe-signed" aria-label={SIGNED_CARD_HEADING} data-signing-link>
      <header className="pe-card-head">
        <h2 className="lx-h3">{SIGNED_CARD_HEADING}</h2>
      </header>
      <dl className="pe-signed-dl">
        <dt>{SIGNING_LINK_HEADING}</dt>
        <dd role="status">{line}</dd>
      </dl>
    </section>
  );
}
