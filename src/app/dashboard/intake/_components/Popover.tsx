"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * One popover, used by every menu on this page: the filter chips, the
 * temperature override, the owner assign menu, the card's stage menu.
 *
 * It exists so all of them close the same way. A menu that only closes by
 * choosing something is a trap in a dense table where every row has three of
 * them, so this listens for an outside pointer-down AND Escape, and returns
 * focus to the trigger on close — the keyboard path out of the menu is the
 * same one that got in.
 */
export default function Popover({
  label,
  trigger,
  align = "left",
  width = 190,
  children,
}: {
  /** Announced as the menu's name; also the trigger's accessible label. */
  label: string;
  trigger: (props: {
    open: boolean;
    onClick: () => void;
    ref: React.Ref<HTMLButtonElement>;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string;
    "aria-label": string;
  }) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
  /** `close` lets an item dismiss the menu after it has acted. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  // `close` deliberately touches no ref at all: it is handed to `children`
  // during render, and a closure that reads or writes `.current` there is
  // exactly what React's refs rule refuses. The two places that DO want focus
  // back — Escape, and clicking an item — are real event handlers, and they
  // raise the flag below themselves.
  const close = useCallback(() => setOpen(false), []);
  const restoreFocus = useRef(false);
  const wasOpen = useRef(false);

  // Focus returns to the trigger only when the menu was DISMISSED. An outside
  // click closes it too, but that pointer has already chosen where focus
  // should go and yanking it back would fight the user.
  useEffect(() => {
    if (wasOpen.current && !open && restoreFocus.current) triggerRef.current?.focus();
    restoreFocus.current = false;
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      restoreFocus.current = true;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex", minWidth: 0 }}>
      {trigger({
        open,
        onClick: () => setOpen((value) => !value),
        ref: triggerRef,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": panelId,
        "aria-label": label,
      })}
      {open && (
        <div
          id={panelId}
          role="menu"
          aria-label={label}
          // Any click that lands inside the panel is a deliberate dismissal
          // (the items call `close` on select), so it earns the focus back.
          onClick={() => {
            restoreFocus.current = true;
          }}
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 5px)",
            [align]: 0,
            minWidth: width,
            maxWidth: "min(78vw, 300px)",
            maxHeight: 280,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 5,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            boxShadow: "var(--shadow)",
          }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** A row inside a Popover. Checked items carry a dot rather than a tick glyph. */
export function PopoverItem({
  children,
  checked,
  muted,
  onSelect,
}: {
  children: React.ReactNode;
  checked?: boolean;
  /** For the "clear"/"anyone" rows — present, but not the point of the menu. */
  muted?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked ?? false}
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        textAlign: "left",
        width: "100%",
        fontSize: 12.5,
        fontFamily: "inherit",
        padding: "6px 8px",
        borderRadius: 6,
        border: "none",
        background: checked ? "var(--oxbg)" : "transparent",
        color: muted ? "var(--mute)" : checked ? "var(--ox)" : "var(--ink)",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          flex: "0 0 auto",
          background: checked ? "var(--ox)" : "transparent",
          border: checked ? "none" : "1px solid var(--line)",
        }}
      />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
    </button>
  );
}
