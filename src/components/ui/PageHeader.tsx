import Link from "next/link";

/** The one back link: `← <Parent name>`. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="lx-back" href={href}>
      ← {label}
    </Link>
  );
}

/**
 * The one page header: title, one sub-line, and ONE slot for the page's buttons. No eyebrow label for section names.
 * A record page (lead, matter, meeting, approval item) may pass `details`: one plain line of record facts.
 */
export function PageHeader({
  title,
  sub,
  details,
  count,
  back,
  actions,
  tour,
  className,
  titleClassName,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  details?: React.ReactNode;
  count?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  tour?: string;
  className?: string;
  /** An extra class on the h1, beside `lx-h1` (a page that styles its own title). */
  titleClassName?: string;
}) {
  return (
    <header className={`lx-page-head lx-head${className ? ` ${className}` : ""}`}>
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div className="lx-head-title">
        <h1 className={titleClassName ? `lx-h1 ${titleClassName}` : "lx-h1"} data-tour={tour}>
          {title}
        </h1>
        {count !== undefined && count !== null ? <span className="lx-head-count">{count}</span> : null}
      </div>
      {details ? <p className="lx-head-details">{details}</p> : null}
      {sub ? <p className="lx-sub">{sub}</p> : null}
      {actions ? <div className="lx-head-actions">{actions}</div> : null}
    </header>
  );
}
