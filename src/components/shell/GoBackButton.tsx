"use client";

/**
 * "Go back" for the 404 pages. It calls the browser's history directly rather
 * than a router hook, so it renders anywhere. A tab opened straight onto a dead
 * link has nothing to go back to, so it falls through to `fallbackHref`.
 */
export function GoBackButton({ fallbackHref }: { fallbackHref: string }) {
  return (
    <button
      type="button"
      className="lx-btn lx-btn-sec"
      onClick={() => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign(fallbackHref);
      }}
    >
      Go back
    </button>
  );
}
