import Link from "next/link";
import { GoBackButton } from "@/components/shell/GoBackButton";
import "@/components/shell/shell-pages.css";
import { NOT_FOUND_BODY, NOT_FOUND_TITLE } from "@/lib/ui/words";

/** A dead link inside the workspace: shown within the rail and top bar, with a way back. */
export default function DashboardNotFound() {
  return (
    <div className="lx-center">
      <div className="lx-card lx-pad lx-center-card">
        <h1 className="lx-h1">{NOT_FOUND_TITLE}</h1>
        <p className="lx-note">{NOT_FOUND_BODY}</p>
        <div className="lx-center-actions">
          <Link href="/dashboard/" className="lx-btn lx-btn-pri">
            Back to Today
          </Link>
          <GoBackButton fallbackHref="/dashboard/" />
        </div>
      </div>
    </div>
  );
}
