/** The one notice banner, in four tones. */
export type NoticeTone = "ok" | "warn" | "risk" | "mute";

export function Notice({
  tone = "mute",
  role,
  title,
  action,
  children,
}: {
  tone?: NoticeTone;
  role?: "status" | "alert";
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`lx-banner lx-banner-${tone}`} role={role}>
      {title ? <strong>{title}</strong> : null}
      {children}
      {action}
    </div>
  );
}
