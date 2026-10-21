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
        Upload your intake sheet saved as a CSV file. Three sources are compared for each lead: the sheet, your
        Lawmatics stages, and mail already synced onto the lead&apos;s timeline. Where they disagree, the sheet wins.
      </p>
      <ul className="rc-lines">
        <li>Lawmatics is only read. Nothing on this page writes to it.</li>
        <li>Nothing moves until you choose it and press Apply. Every move is logged on the lead&apos;s timeline.</li>
        <li>A person Lawmatics lists as hired is never moved to a stage here. Open a matter for them instead.</li>
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
