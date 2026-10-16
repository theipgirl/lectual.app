import type { PublicQuoteView } from "@/lib/quotes/public";
import { FirmHeader } from "./FirmHeader";

/**
 * A closed quote that is NOT locked: the one the client declined themselves,
 * or a status this build does not recognise. It renders the state and nothing
 * else (spec §6.4): no lines, no amounts, no accept control — not even a
 * disabled one.
 *
 * Expired and withdrawn links do not come here. The design asks for them to
 * look exactly like a draft's link, so page.tsx answers them with the locked
 * page (`notFound()`), which names no firm and no quote.
 */
export function StatusNotice({ view }: { view: PublicQuoteView }) {
  const declined = view.status === "declined";
  return (
    <>
      <FirmHeader firmName={view.firm.name} note={declined ? "You declined this proposal" : "This proposal is closed"} />
      <div className="qp-body">
        <span className="qp-kicker">{view.title}</span>
        <h1 className="qp-title">{declined ? "You declined this proposal" : "This proposal is no longer open"}</h1>
        <p className="qp-intro" style={{ marginTop: 0 }}>
          {declined
            ? `Nothing was signed and nothing is owed. Contact ${view.firm.name} if you would like them to send a new one.`
            : `Contact ${view.firm.name} for an up-to-date proposal.`}
        </p>
      </div>
    </>
  );
}
