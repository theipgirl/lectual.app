import Link from "next/link";
import "./list-page.css";

/** The class a chip wears. One definition, so a Popover trigger and a plain chip look the same. */
export function chipClass(active: boolean): string {
  return `lp-chip${active ? " lp-chip-on" : ""}`;
}

/** A row of filter chips. `as="nav"` for links (a shareable filtered list), a group for buttons. */
export function FilterChips({ label, as = "div", children, className }: { label: string; as?: "div" | "nav"; children: React.ReactNode; className?: string }) {
  const classes = `lp-chips${className ? ` ${className}` : ""}`;
  return as === "nav" ? (
    <nav aria-label={label} className={classes}>
      {children}
    </nav>
  ) : (
    <div role="group" aria-label={label} className={classes}>
      {children}
    </div>
  );
}

export function ChipCount({ children }: { children: React.ReactNode }) {
  return <span className="lp-chip-count">{children}</span>;
}

type ChipProps = {
  active?: boolean;
  count?: number | null;
  children: React.ReactNode;
} & (
  | { href: string; onClick?: never }
  | { href?: undefined; onClick?: () => void; pressed?: boolean; title?: string; ariaLabel?: string }
);

/** One chip: a link when it has an href, otherwise a button. */
export function Chip(props: ChipProps) {
  const active = Boolean(props.active);
  const body = (
    <>
      {props.children}
      {props.count !== undefined && props.count !== null ? <ChipCount>{props.count}</ChipCount> : null}
    </>
  );
  if (props.href !== undefined) {
    return (
      <Link href={props.href} aria-current={active ? "page" : undefined} className={chipClass(active)}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" aria-pressed={props.pressed ?? active} aria-label={props.ariaLabel} title={props.title} onClick={props.onClick} className={chipClass(active)}>
      {body}
    </button>
  );
}
