import Link from "next/link";
import { GoBackButton } from "@/components/shell/GoBackButton";

/** The public 404, for any URL outside the signed-in workspace. */
export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="lx-card" style={{ maxWidth: 440, padding: 34, display: "grid", gap: 12 }}>
        <div className="lx-label">Not found</div>
        <h1 className="lx-h2" style={{ fontSize: 31 }}>
          This page doesn&apos;t exist
        </h1>
        <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.6 }}>
          The link may be out of date, or the page may have moved.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/" className="lx-btn lx-btn-pri">
            Go to Lectual
          </Link>
          <GoBackButton fallbackHref="/" />
        </div>
      </div>
    </main>
  );
}
