import { SHOW_MORE, showingOf } from "@/lib/ui/words";

/** "Showing 40 of 112", with a Show more control when the page can offer one. Draws nothing when everything is shown. */
export function ShowingCount({ shown, total, moreHref, onMore }: { shown: number; total: number; moreHref?: string; onMore?: () => void }) {
  if (shown >= total) return null;
  return (
    <p className="lx-note lx-showing">
      {showingOf(shown, total)}
      {moreHref ? (
        <>
          {" "}
          <a className="lx-btn lx-btn-sec lx-btn-sm" href={moreHref}>
            {SHOW_MORE}
          </a>
        </>
      ) : onMore ? (
        <>
          {" "}
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={onMore}>
            {SHOW_MORE}
          </button>
        </>
      ) : null}
    </p>
  );
}
