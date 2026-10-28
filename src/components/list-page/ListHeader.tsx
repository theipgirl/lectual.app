import "./list-page.css";

/**
 * The one header Leads and Matters share: a single h1 and one short sub-line. No eyebrow label, because
 * the top bar already names the section and the h1 names the page. `count` is optional and rides
 * beside the h1.
 */
export function ListHeader({
  title,
  sub,
  count,
  tour,
}: {
  title: string;
  sub: React.ReactNode;
  count?: React.ReactNode;
  /** The data-tour token the page's h1 already carries. */
  tour?: string;
}) {
  return (
    <header className="lp-header">
      <h1 className="lx-h1" data-tour={tour}>
        {title}
      </h1>
      {count !== undefined && count !== null ? <span className="lp-count">{count}</span> : null}
      <p className="lx-sub lp-sub">{sub}</p>
    </header>
  );
}
