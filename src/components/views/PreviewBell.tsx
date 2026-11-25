import { VIEW_AS_PRIVATE_BELL } from "@/lib/ui/words";
import "./view-as.css";

/** The bell while previewing: muted, with the sentence. Neither person's notifications are read (D4). */
export function PreviewBell({ name }: { name: string }) {
  const sentence = VIEW_AS_PRIVATE_BELL(name);
  return (
    <span className="lx-bell lx-viewas-bell" role="img" aria-label={sentence} title={sentence} data-preview-bell="">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </span>
  );
}
