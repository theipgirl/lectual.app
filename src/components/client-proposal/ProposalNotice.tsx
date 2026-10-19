import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import "./proposal.css";

/**
 * The page for "nothing to show": a link that is not available (unknown,
 * wrong shape, draft, expired, withdrawn: all one answer, so the page is not an
 * oracle for which tokens are real) and "we could not check" (the database or
 * its key is unreachable, which must never read as "does not exist").
 *
 * Reads nothing, not even the firm's name, and is neutral-branded for the same
 * reason. Server-component safe.
 */
export function ProposalNotice({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="cp-root cp-notice-root" data-brand="neutral">
      <main className="cp-notice">
        <div className="cp-notice-mark" aria-hidden="true" />
        <h1>{heading}</h1>
        <p>{children}</p>
      </main>
      <footer className="cp-footer cp-gut">
        <div className="cp-wrap">
          <p className="cp-d">{NOT_A_LAW_FIRM_DISCLAIMER}</p>
        </div>
      </footer>
    </div>
  );
}
