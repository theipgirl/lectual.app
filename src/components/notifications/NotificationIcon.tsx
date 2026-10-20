import type { NotificationIcon as IconKind } from "@/lib/notifications/describe";

const PATHS: Record<IconKind, string> = {
  assigned: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  mention: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  reply: "M4 5h16v11H9l-5 4V5Z",
  timer: "M12 8v5l3 2M9 3h6M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z",
  outcome: "M5 4v16M5 5h12l-2 4 2 4H5",
  approval: "M5 12l4.5 4.5L19 7",
  generic: "M12 8v5m0 3.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
};

/** A small outlined glyph per kind. Decorative: the label beside it carries the meaning. */
export function NotificationIcon({ icon }: { icon: IconKind }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[icon]} />
    </svg>
  );
}
