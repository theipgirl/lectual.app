import Link from "next/link";

export type ViewToggleValue = "table" | "board";

const VIEWS: ReadonlyArray<{ value: ViewToggleValue; label: string }> = [
  { value: "table", label: "Table" },
  { value: "board", label: "Board" },
];

/**
 * The Table | Board switch both list pages share (Intake and Matters), drawn
 * with the design's `lx-segs lx-view-toggle` classes so the two pages cannot
 * drift apart.
 *
 * Two modes, picked by which prop is passed:
 *  - link mode (`hrefFor`): two anchors, for a page whose view is part of its
 *    URL and rendered on the server (Matters). The current one carries
 *    `aria-current="page"`.
 *  - controlled mode (`onChange`): two buttons, for a page that swaps views in
 *    the browser and mirrors the choice into the URL itself (Intake). The
 *    current one carries `aria-pressed`.
 *
 * Deliberately hook-free, so it renders on the server and can be called
 * directly in a test.
 */
export type ViewToggleProps = {
  value: ViewToggleValue;
} & ({ hrefFor: (view: ViewToggleValue) => string; onChange?: never } | { onChange: (view: ViewToggleValue) => void; hrefFor?: never });

export function ViewToggle(props: ViewToggleProps) {
  const { value, hrefFor, onChange } = props;

  if (hrefFor) {
    return (
      <nav className="lx-segs lx-view-toggle" aria-label="View">
        {VIEWS.map((view) => {
          const current = view.value === value;
          return (
            <Link key={view.value} href={hrefFor(view.value)} aria-current={current ? "page" : undefined} className={current ? "on" : undefined}>
              {view.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="lx-segs lx-view-toggle" role="group" aria-label="View">
      {VIEWS.map((view) => {
        const current = view.value === value;
        return (
          <button key={view.value} type="button" aria-pressed={current} className={current ? "on" : undefined} onClick={() => onChange?.(view.value)}>
            {view.label}
          </button>
        );
      })}
    </div>
  );
}

export default ViewToggle;
