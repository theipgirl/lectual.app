import { RefreshButton } from "./RefreshButton";
import { CANT_SHOW, REFRESH_TO_TRY_AGAIN, cantShowTitle } from "@/lib/ui/words";

/**
 * A FAILED read, never an empty one. `LoadFailedCard` is for a whole list or page; `LoadFailedLine` for one section.
 * Never draw these as "nothing yet", and never draw "nothing yet" for a failed read.
 */
export function LoadFailedCard({ what, body }: { what: string; body?: React.ReactNode }) {
  return (
    <div className="lx-card lx-state-card" role="status">
      <h2 className="lx-h2">{cantShowTitle(what)}</h2>
      <p className="lx-note">{body ?? REFRESH_TO_TRY_AGAIN}</p>
      <RefreshButton />
    </div>
  );
}

export function LoadFailedLine({ children, refresh = true }: { children?: React.ReactNode; refresh?: boolean }) {
  return (
    <p className="lx-note lx-state-line" role="status">
      {children ?? CANT_SHOW}
      {refresh ? <RefreshButton /> : null}
    </p>
  );
}
