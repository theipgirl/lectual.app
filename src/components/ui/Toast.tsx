/** The one toast look. Showing, hiding and timers stay with the caller. */
export function Toast({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="lx-toast" role="status">
      {children}
      {action}
    </div>
  );
}
