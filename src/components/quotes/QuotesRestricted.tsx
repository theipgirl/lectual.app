/**
 * The in-firm refusal for the quotes pages. An explanatory card rather than
 * `notFound()`, on purpose: this gate is a decision INSIDE one firm about who
 * quotes, so naming the roles discloses nothing a colleague couldn't ask. The
 * per-firm module gates are the opposite case and must never explain.
 */
export function QuotesRestricted({ title, detail }: { title: string; detail?: string }) {
  return (
    <>
      <div>
        <div className="lx-label">Intake</div>
        <h1 className="lx-h1">{title}</h1>
      </div>
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>
          Restricted to the firm&apos;s principals
        </h2>
        <p className="lx-note" style={{ margin: 0 }}>
          {detail ?? "Quotes are built by owners, admins, senior admins and attorneys. Ask one of them for access."}
        </p>
      </div>
    </>
  );
}
