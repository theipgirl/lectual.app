import Link from "next/link";

/** Placeholder for a rail section whose real page lands in a later build step. */
export function NotBuilt({ label, step }: { label: string; step: number }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
      <div className="lx-card" style={{ maxWidth: 440, padding: 34, display: "grid", gap: 12 }}>
        <div className="lx-label">{label}</div>
        <h1 className="lx-h2" style={{ fontSize: 31 }}>
          Not built yet
        </h1>
        <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.6 }}>
          This section arrives in build step {step} of the MVP plan. The design for it is in{" "}
          <code>design/</code>.
        </p>
        <Link href="/dashboard/" className="lx-btn lx-btn-pri" style={{ justifySelf: "start" }}>
          Back to Today
        </Link>
      </div>
    </div>
  );
}
