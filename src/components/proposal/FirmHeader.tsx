import type { PublicQuoteFirm } from "@/lib/quotes/public";

/** The firm's name at the top of every state the proposal page renders. The
 * proposal is FROM the firm; Lectual is only the software it is shown in. */
export function FirmHeader({ firm }: { firm: PublicQuoteFirm }) {
  return (
    <header style={{ display: "grid", gap: 4 }}>
      <span className="lx-label">Proposal from</span>
      <span style={{ fontFamily: "var(--serif)", fontSize: 26, lineHeight: 1.1, color: "var(--ink)" }}>{firm.name}</span>
    </header>
  );
}
