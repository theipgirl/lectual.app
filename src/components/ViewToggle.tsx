import Link from "next/link";
import { VIEW_BOARD, VIEW_LIST } from "@/lib/ui/words";

/**
 * THE view-style switch of the app (and, through the same `.vs-switch` look, every other pick-one switch) (D1, Taylor's choice, the Approvals deck's look): one cream pill holding the options, the chosen one
 * filled with the standard burgundy (`--ox`) with light text, the others plain dark text. Every page that switches how the SAME records are
 * drawn (Approvals and the deck, Weekly review, Intake, Matters, Calendar) uses this and nothing else; a test fails on a second one.
 *
 * Two modes, picked by which prop is passed:
 *  - link mode (`hrefFor`): anchors, for a page whose view is part of its URL and rendered on the server. The current one carries
 *    `aria-current="page"`.
 *  - controlled mode (`onChange`): buttons, for a page that swaps views in the browser and mirrors the choice into the URL itself. The
 *    current one carries `aria-current="true"`.
 *
 * Deliberately hook-free, so it renders on the server and can be called directly in a test. It is NOT for chips, filter pills, tabs,
 * period or date-range controls: those stay as they are.
 */
export type ViewOption<V extends string = string> = { value: V; label: string; /** Link mode only: where this option goes, when it needs more than `hrefFor(value)`. */ href?: string };

export const TABLE_BOARD_VIEWS: ReadonlyArray<ViewOption<ViewToggleValue>> = [
  { value: "board", label: VIEW_BOARD },
  { value: "table", label: VIEW_LIST },
];

export type ViewToggleValue = "table" | "board";

type Common<V extends string> = {
  value: V;
  /** The options, in order. Defaults to Board | List. */
  views?: ReadonlyArray<ViewOption<V>>;
  /** The group's accessible name. */
  label?: string;
  /** Extra layout class from the page (placement only, never colours). */
  className?: string;
};

export type ViewToggleProps<V extends string = ViewToggleValue> = Common<V> &
  ({ hrefFor: (view: V) => string; onChange?: never; prefetch?: boolean } | { onChange: (view: V) => void; hrefFor?: never; prefetch?: never });

export function ViewToggle<V extends string = ViewToggleValue>(props: ViewToggleProps<V>) {
  const { value, hrefFor, onChange, label = "View", className } = props;
  const views = (props.views ?? (TABLE_BOARD_VIEWS as unknown as ReadonlyArray<ViewOption<V>>)) as ReadonlyArray<ViewOption<V>>;
  const cls = `vs-switch${className ? ` ${className}` : ""}`;

  if (hrefFor) {
    return (
      <nav className={cls} aria-label={label} data-view-switch>
        {views.map((view) => (
          <Link key={view.value} href={view.href ?? hrefFor(view.value)} prefetch={props.prefetch} aria-current={view.value === value ? "page" : undefined}>
            {view.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <div className={cls} role="group" aria-label={label} data-view-switch>
      {views.map((view) => (
        <button key={view.value} type="button" aria-current={view.value === value ? "true" : undefined} onClick={() => onChange?.(view.value)}>
          {view.label}
        </button>
      ))}
    </div>
  );
}

export default ViewToggle;
