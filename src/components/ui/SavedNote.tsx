import { SAVED } from "@/lib/ui/words";

/** "Saved." beside the button that saved. A banner is only for a redirect (`?connected=1`). */
export function SavedNote({ show, children = SAVED }: { show: boolean; children?: React.ReactNode }) {
  if (!show) return null;
  return (
    <span className="lx-saved" role="status">
      {children}
    </span>
  );
}
