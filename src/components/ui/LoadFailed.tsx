import { RefreshButton } from "./RefreshButton";
import { CANT_SHOW, REFRESH_TO_TRY_AGAIN, cantShowTitle } from "@/lib/ui/words";

/**
 * A FAILED read, never an empty one. `LoadFailedCard` is for a whole list or page; `LoadFailedLine` for one section.
 * Never draw these as "nothing yet", and never draw "nothing yet" for a failed read.
 * `role` is "status" by default; a failed read that was announced as an alert before this look change passes `role="alert"`.
 */
export function LoadFailedCard({ what, body, role = "status" }: { what: string; body?: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <div className="lx-card lx-state-card" role={role}>
      <h2 className="lx-h2">{cantShowTitle(what)}</h2>
      <p className="lx-note">{body ?? REFRESH_TO_TRY_AGAIN}</p>
      <RefreshButton />
    </div>
  );
}

export function LoadFailedLine({ children, refresh = true, role = "status" }: { children?: React.ReactNode; refresh?: boolean; role?: "status" | "alert" }) {
  return (
    <p className="lx-note lx-state-line" role={role}>
      {children ?? CANT_SHOW}
      {refresh ? <RefreshButton /> : null}
    </p>
  );
}
