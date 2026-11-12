import type { SignedAddressRead } from "@/lib/loe/signed-address";
import { MAILING_ADDRESS_HEADING, MAILING_ADDRESS_UNAVAILABLE } from "@/lib/ui/words";

/**
 * "Mailing address (from the signed engagement letter)" in the aside of a lead or matter page. Three outcomes of the read:
 * shown, nothing (no signed letter, or a role that may not read it: the page passes null and NOTHING is drawn, not even a heading),
 * and one quiet line when the read failed (never "no address"). The address is React text.
 */
export function MailingAddressCard({ read }: { read: SignedAddressRead | null }) {
  if (read === null || read.status === "none") return null;
  if (read.status === "unavailable") {
    return (
      <div className="lx-meta lx-mailing" data-mailing="unavailable">
        <span className="lx-note">{MAILING_ADDRESS_UNAVAILABLE}</span>
      </div>
    );
  }
  return (
    <div className="lx-mailing" data-mailing="ok">
      <div className="lx-label">{MAILING_ADDRESS_HEADING}</div>
      <address className="lx-mailing-lines" style={{ fontStyle: "normal", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
        {read.address.lines.join("\n")}
      </address>
    </div>
  );
}
