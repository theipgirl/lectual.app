import type { Availability } from "@/lib/reconcile/availability";

/** What the screen does, in plain words, plus each source's availability when it can be known before an upload. */
export function Explanation({ availability }: { availability: Availability }) {
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-label="How this works">
      <div>
        <div className="lx-label">Before you start</div>
        <h2 className="lx-h2" style={{ fontSize: 23 }}>
          Compare the sheet with the app
        </h2>
      </div>
      <p>
        Upload your intake sheet saved as a CSV file (the whole workbook saved as one CSV is fine). Three sources are
        read for each lead: the sheet&apos;s status and notes, your Lawmatics stage and notes, and mail (what is already
        synced onto the lead, plus a read-only search of your connected Outlook mailboxes). The furthest point with a
        dated record is proposed, and the latest dated touch becomes the proposed last touch.
      </p>
      <ul className="rc-lines">
        <li>Lawmatics is only read. Nothing on this page writes to it, and no email is sent or opened for its body.</li>
        <li>Nothing moves until you choose it and press Apply. Every move is logged on the lead&apos;s timeline.</li>
        <li>A person who has accepted, paid or is hired is never moved to a stage here. Open a matter for them instead.</li>
        <li>People in the sheet or Lawmatics with no lead here are listed. A lead is created only when you press Create lead.</li>
      </ul>
      <ul className="rc-lines" aria-label="Sources">
        {availability.map((line) => (
          <li key={line.source} data-source={line.source} data-tone={line.tone}>
            <b>{line.label}</b>
            {": "}
            {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
