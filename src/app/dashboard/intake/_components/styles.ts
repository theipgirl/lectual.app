import type { CSSProperties } from "react";
import type { Temperature } from "@/lib/intake";

/**
 * The canvas's style vocabulary, transcribed once (Intake_Leads.dc.html's
 * <script> block: TEMP / DOT / OWNER_CHIP / TOUCH / NEXT / STAGE_PILL).
 *
 * Presentation only — nothing here decides anything. Every colour is a token
 * that src/app/(intake)/intake.css defines under `.intake-root`; there is no
 * ad-hoc hex in this folder, so re-skinning the surface means editing that
 * stylesheet and nothing else.
 *
 * These are plain objects rather than CSS classes because they are a closed
 * set of ~15 chips applied per row from data, which is exactly the case inline
 * styles are for — and because the canvas expresses them the same way, so a
 * diff against it stays readable.
 */

const MONO = "var(--font-jetbrains-mono), monospace";

function pill(background: string, color: string, fontSize = 11): CSSProperties {
  return {
    fontFamily: MONO,
    fontSize,
    padding: "3px 7px",
    borderRadius: 5,
    background,
    color,
    whiteSpace: "nowrap",
  };
}

export const STAGE_PILL = pill("var(--surface2)", "var(--ink2)", 10.5);
/** Used when a lead's stage can't be resolved — the canvas's "Unresolved" column. */
export const STAGE_WARN = pill("var(--warnbg)", "var(--warn)", 10.5);

export const TEMP_PILL: Record<Temperature, CSSProperties> = {
  hot: pill("var(--critbg)", "var(--crit)", 10.5),
  warm: pill("var(--warnbg)", "var(--warn)", 10.5),
  cold: pill("var(--oxbg)", "var(--ox)", 10.5),
};

/** No derivation was possible — an em-dash, never a guessed level. */
export const TEMP_NONE: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11.5,
  color: "var(--mute)",
};

function dot(background: string, extra?: CSSProperties): CSSProperties {
  return { width: 7, height: 7, borderRadius: 999, background, flex: "0 0 auto", ...extra };
}

export const TEMP_DOT: Record<Temperature, CSSProperties> = {
  hot: dot("var(--crit)"),
  warm: dot("var(--warn)"),
  cold: dot("var(--ox)", { opacity: 0.4 }),
};

export const TEMP_DOT_NONE: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  border: "1px solid var(--line)",
  flex: "0 0 auto",
};

export const OWNER_TEXT: CSSProperties = { fontFamily: MONO, fontSize: 11.5, color: "var(--ink2)" };
export const OWNER_TEXT_NONE: CSSProperties = { fontFamily: MONO, fontSize: 11.5, color: "var(--mute)" };

export const OWNER_CHIP: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  padding: "2px 5px",
  borderRadius: 4,
  background: "var(--surface2)",
  color: "var(--ink2)",
};

/** Dashed, because "nobody" is an empty slot rather than a person named "—". */
export const OWNER_CHIP_NONE: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  padding: "2px 5px",
  borderRadius: 4,
  border: "1px dashed var(--line)",
  color: "var(--mute)",
};

/** ← waiting on us: burgundy, because it is the only colour on the row that means "you". */
export const TOUCH_IN: CSSProperties = { fontFamily: MONO, fontSize: 11.5, color: "var(--burg)", whiteSpace: "nowrap" };
export const TOUCH_OUT: CSSProperties = { fontFamily: MONO, fontSize: 11.5, color: "var(--mute)", whiteSpace: "nowrap" };
export const TOUCH_IN_SMALL: CSSProperties = { ...TOUCH_IN, fontSize: 10 };
export const TOUCH_OUT_SMALL: CSSProperties = { ...TOUCH_OUT, fontSize: 10 };

export const NEXT: CSSProperties = {
  fontSize: 12.5,
  color: "var(--ink2)",
  lineHeight: 1.35,
  minWidth: 0,
};

export const NEXT_HOT: CSSProperties = {
  fontSize: 12.5,
  color: "var(--ox)",
  fontWeight: 500,
  lineHeight: 1.35,
  minWidth: 0,
};

/** The 26px round initials on a board-by-owner column head. */
export function ownerAvatar(kind: "none" | "primary" | "soft" | "neutral"): CSSProperties {
  const base: CSSProperties = {
    fontFamily: MONO,
    width: 26,
    height: 26,
    borderRadius: 999,
    fontSize: 10.5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
  };
  switch (kind) {
    case "none":
      return { ...base, border: "1px dashed var(--line)", color: "var(--mute)", fontSize: 11 };
    case "primary":
      return { ...base, background: "var(--ox)", color: "var(--cream)" };
    case "soft":
      return { ...base, background: "var(--blush)", color: "var(--ox)" };
    case "neutral":
      return { ...base, background: "var(--surface2)", color: "var(--ink2)" };
  }
}

/**
 * Three avatar tones cycling by column position, exactly as the canvas's PEOPLE
 * list does — it is decoration that makes columns tellable apart at a glance,
 * so it keys on position and not on anything about the person.
 */
const AVATAR_CYCLE = ["primary", "soft", "neutral"] as const;

export function ownerAvatarFor(index: number): CSSProperties {
  return ownerAvatar(AVATAR_CYCLE[index % AVATAR_CYCLE.length]);
}

/** The pill-shaped "Group by" toggle and the segmented Table/Board control. */
export const SEGMENT_WRAP: CSSProperties = {
  display: "flex",
  padding: 3,
  borderRadius: 10,
  background: "var(--surface2)",
  gap: 2,
};

export function segmentButton(active: boolean): CSSProperties {
  return {
    height: 30,
    padding: "0 14px",
    borderRadius: 8,
    border: "none",
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--ink)" : "var(--ink2)",
    fontSize: 12.5,
    fontWeight: active ? 500 : 400,
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    gap: 7,
    cursor: "pointer",
    boxShadow: active ? "0 1px 2px rgba(20,4,8,.08)" : "none",
  };
}

export function groupPill(active: boolean): CSSProperties {
  return {
    height: 30,
    padding: "0 12px",
    borderRadius: 999,
    border: active ? "1px solid var(--ox)" : "1px solid var(--line)",
    background: active ? "var(--ox)" : "var(--surface)",
    color: active ? "var(--cream)" : "var(--ink2)",
    fontSize: 12.5,
    fontWeight: active ? 500 : 400,
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  };
}

/** A filter chip: outlined when idle, oxblood-tinted once it is narrowing the list. */
export function filterChip(active: boolean): CSSProperties {
  return {
    height: 32,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${active ? "var(--ox)" : "var(--line)"}`,
    background: active ? "var(--oxbg)" : "var(--surface)",
    color: active ? "var(--ox)" : "var(--ink2)",
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12.5,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

/** The count that rides inside a filter chip. */
export const CHIP_COUNT: CSSProperties = { fontFamily: MONO, fontSize: 11 };

export const PRIMARY_BUTTON: CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: 9,
  border: "1px solid var(--ox)",
  background: "var(--ox)",
  color: "var(--cream)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12.5,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const OUTLINE_BUTTON: CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink2)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12.5,
  fontFamily: "inherit",
  cursor: "pointer",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

/** The 14px-radius card every table/board sits inside. */
export const PANEL: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  border: "1px solid var(--line)",
  borderRadius: 14,
  background: "var(--surface)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};
