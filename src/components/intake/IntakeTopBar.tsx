/**
 * The status line from lectual's intake top bar ("25 in intake · 6 need a
 * first reply · 3 unassigned"), drawn as the first line of the page.
 *
 * In lectual the intake route group had its own 78px bar with the firm's mark
 * and an eyebrow; here the app shell's top bar already carries both, so only
 * the page's own count remains. Facts only; never guidance. The name and the
 * `eyebrow` prop are kept so ported call sites read the same as lectual's.
 */
export function IntakeTopBar({
  eyebrow,
  children,
}: {
  /** "Intake": which surface this is. Announced to screen readers only. */
  eyebrow: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="intake-statusline" role="status" aria-label={eyebrow}>
      {children ? <span style={{ minWidth: 0 }}>{children}</span> : null}
    </div>
  );
}
