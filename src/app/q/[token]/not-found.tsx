import { FirmHeader } from "@/components/proposal/FirmHeader";

/**
 * The locked page. One answer for every kind of nothing: an unknown token, a
 * token of the wrong shape, another firm's token, a quote still in DRAFT — and,
 * since the design asked for them to look the same, an EXPIRED or WITHDRAWN one
 * (page.tsx sends those here too). A page that told them apart would be an
 * oracle for someone walking token space, so nothing here is read from the
 * database, not even the firm's name.
 */
export default function ProposalNotFound() {
  return (
    <>
      <FirmHeader firmName={null} note="Sent to you by link. No account, no login." />
      <div className="qp-locked">
        <div className="qp-locked-mark" aria-hidden="true" />
        <h1>This link isn&rsquo;t available.</h1>
        <p>If you think it should be, reply to the email it came from and ask for a new one.</p>
      </div>
    </>
  );
}
