/**
 * The firm's band at the top of every state the proposal page renders — the
 * proposal is FROM the firm; Lectual is only the software it is shown in.
 *
 * `firmName` is null on the locked page, which answers identically for an
 * unknown, draft, expired or withdrawn link: naming the firm there would tell
 * whoever holds a link that it is real, and whose it is.
 */
export function FirmHeader({ firmName, note }: { firmName: string | null; note: string }) {
  return (
    <header className="qp-band">
      <div className="qp-band-firm">{firmName ?? "Proposal"}</div>
      <div className="qp-band-note">{note}</div>
    </header>
  );
}
