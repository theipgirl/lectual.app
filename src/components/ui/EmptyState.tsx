/** The one empty state: a card (a whole list is empty) or a quiet line (one section is). Only for a read that SUCCEEDED. */
export function EmptyState({
  title,
  children,
  action,
  variant = "card",
}: {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  variant?: "card" | "line";
}) {
  if (variant === "line") return <p className="lx-note lx-state-line">{children}</p>;
  return (
    <div className="lx-card lx-state-card">
      {title ? <h2 className="lx-h2">{title}</h2> : null}
      <p className="lx-note">{children}</p>
      {action}
    </div>
  );
}
