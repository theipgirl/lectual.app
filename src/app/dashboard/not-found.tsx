import Link from "next/link";
import { GoBackButton } from "@/components/shell/GoBackButton";

/** A dead link inside the workspace: shown within the rail and top bar, with a way back. */
export default function DashboardNotFound() {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
      <div className="lx-card" style={{ maxWidth: 440, padding: 34, display: "grid", gap: 12 }}>
        <div className="lx-label">Not found</div>
        <h1 className="lx-h2" style={{ fontSize: 31 }}>
          This page doesn&apos;t exist
        </h1>
        <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.6 }}>
          The link may be out of date, or the page may have moved.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/dashboard/" className="lx-btn lx-btn-pri">
            Back to Today
          </Link>
          <GoBackButton fallbackHref="/dashboard/" />
        </div>
      </div>
    </div>
  );
}
