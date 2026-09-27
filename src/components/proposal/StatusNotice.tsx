import { formatQuoteExpiry } from "@/lib/quotes/status";
import type { PublicQuoteView } from "@/lib/quotes/public";
import { FirmHeader } from "./FirmHeader";

/**
 * A terminal quote renders its state and nothing else (spec §6.4): no lines, no
 * amounts, no accept control — not even a disabled one, which invites a client
 * to keep clicking and then email the firm about a bug. The TITLE is shown, so
 * the reader knows which proposal this is before contacting the firm.
 *
 * `withdrawn` (the firm walked away) and `declined` (the client did) are kept
 * apart in the copy, as status.ts keeps them apart: telling a client who
 * declined that the firm pulled the offer is wrong in a way someone will pick
 * up the phone about.
 */
export function StatusNotice({ view }: { view: PublicQuoteView }) {
  const { heading, body } = copyFor(view.status, view.firm.name, formatQuoteExpiry(view.expiresAt));
  return (
    <>
      <FirmHeader firm={view.firm} />
      <section className="lx-card" style={{ padding: "28px 26px", display: "grid", gap: 8 }}>
        <span className="lx-label">{view.title}</span>
        <h1 className="lx-h2">{heading}</h1>
        <p style={{ margin: 0, color: "var(--body)", fontSize: 15, lineHeight: 1.6 }}>{body}</p>
      </section>
    </>
  );
}

function copyFor(status: string, firmName: string, expiry: string | null): { heading: string; body: string } {
  switch (status) {
    case "expired":
      return {
        heading: "This proposal has expired",
        body: expiry
          ? `It was open for acceptance until ${expiry}. Contact ${firmName} if you would still like to go ahead — they can send you a new one.`
          : `Contact ${firmName} if you would still like to go ahead — they can send you a new one.`,
      };
    case "withdrawn":
      return {
        heading: "This proposal has been withdrawn",
        body: `${firmName} has withdrawn this proposal. Contact them directly if you think that is a mistake.`,
      };
    case "declined":
      return {
        heading: "You declined this proposal",
        body: `Nothing was signed and nothing is owed. Contact ${firmName} if you would like them to send a new one.`,
      };
    default:
      // A status this build does not recognise: say the honest thing, and above
      // all do not fall through to rendering the quote.
      return { heading: "This proposal is no longer open", body: `Contact ${firmName} for an up-to-date proposal.` };
  }
}
