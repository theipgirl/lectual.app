export type IconName = "close" | "chevron-down" | "chevron-right" | "chevron-left" | "chevron-up" | "plus" | "external" | "more" | "check" | "pencil";

/** The small icon set: one stroke weight, `currentColor`. Replaces typed glyphs (×, ⋯, ▾, ›, ✓). */
export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      {name === "close" && <path d="M6 6l12 12M18 6L6 18" />}
      {name === "chevron-down" && <path d="M6 9l6 6 6-6" />}
      {name === "chevron-right" && <path d="M9 6l6 6-6 6" />}
      {name === "chevron-left" && <path d="M15 6l-6 6 6 6" />}
      {name === "chevron-up" && <path d="M6 15l6-6 6 6" />}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "external" && <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />}
      {name === "check" && <path d="M5 12.5l4.5 4.5L19 7" />}
      {name === "pencil" && <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1zM14 7l3 3" />}
      {name === "more" && (
        <>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}
