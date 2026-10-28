import { COPIED, COPY_VIEW_LINK } from "@/lib/ui/words";

/** How long the button says "Copied" before going back to its own name. */
export const COPIED_MS = 1500;

/** The address "Copy link to this view" puts on the clipboard: the current list's link, made absolute. */
export function viewUrl(currentHref: string, origin: string | null): string {
  return origin ? new URL(currentHref, origin).href : currentHref;
}

/** The button's text: its name, or "Copied" only after the clipboard accepted the link. */
export function copyViewLabel(copied: boolean): string {
  return copied ? COPIED : COPY_VIEW_LINK;
}
