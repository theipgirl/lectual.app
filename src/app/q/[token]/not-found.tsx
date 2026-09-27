/**
 * One answer for every kind of nothing: an unknown token, a token of the wrong
 * shape, another firm's token, and a quote still in draft all land here and
 * read identically. A page that told them apart would be an oracle for someone
 * walking token space — so nothing here is read from the database, not even
 * the firm's name.
 */
export default function ProposalNotFound() {
  return (
    <div className="lx-card" style={{ padding: "40px 32px", textAlign: "center", display: "grid", gap: 10 }}>
      <h1 className="lx-h2">This link isn&rsquo;t available</h1>
      <p className="lx-note" style={{ margin: 0, fontSize: 15 }}>
        If you were expecting a proposal, contact the firm that sent it to you and ask them to re-send the link.
      </p>
    </div>
  );
}
