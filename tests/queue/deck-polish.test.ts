import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { whenLabel } from "@/lib/deal/times";
import { deckEmptyState } from "@/lib/queue/deck";

const css = readFileSync("src/components/deck/deck.css", "utf8");

/** WCAG relative luminance contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("Yes is the clear primary move on the white card", () => {
  it("Yes is the one solid oxblood tile, with hover, focus-visible and disabled states", () => {
    expect(css).toMatch(/\.dk-move--yes,\s*a\.dk-move--yes \{[\s\S]*?background: var\(--st-1\);[\s\S]*?color: var\(--cream\);/);
    expect(css).toMatch(/\.dk-move--yes:hover:not\(:disabled\)/);
    expect(css).toMatch(/\.dk-move:focus-visible/);
    expect(css).toMatch(/\.dk-move--yes:disabled/);
  });
  it("the other moves are outlined white tiles", () => {
    expect(css).toMatch(/\.dk-move \{[^}]*background: var\(--card\);/);
  });
  it("cream on the state fills reads at 4.5:1 or better in light and dark", () => {
    for (const fill of ["#550e1a", "#6a1f2b", "#2a1216", "#4a0c17", "#5a1924", "#1c0b0e"]) expect(contrast("#fdf7eb", fill)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the hold toast's Undo stays readable", () => {
  it("is pink on the dark toast", () => {
    expect(css).toMatch(/\.dk-toast \{[^}]*background: var\(--st-1\);[^}]*color: var\(--cream\)/);
    expect(css).toMatch(/\.dk-toast \.dk-undo \{[^}]*color: var\(--st-pink\)/);
  });
});

describe("a Later that runs past the next deal names its day", () => {
  const tz = "America/New_York";
  const now = new Date("2026-11-10T20:00:00Z"); // 3:00 PM New York
  it("today, tomorrow, later", () => {
    expect(whenLabel(new Date("2026-11-10T22:00:00Z"), now, tz)).toBe("today at 5:00 PM");
    expect(whenLabel(new Date("2026-11-11T12:00:00Z"), now, tz)).toBe("tomorrow at 7:00 AM");
    expect(whenLabel(new Date("2026-11-13T12:00:00Z"), now, tz)).toMatch(/^Fri, Nov 13 at 7:00 AM$/);
  });
  it("the empty state uses it", () => {
    const later = [{ until: "2026-11-11T12:00:00Z" }] as never;
    const r = deckEmptyState({ queueOk: true, role: "owner", deck: { laterArrivals: [], later, handedOff: [] }, nextDealLabel: "7:00 AM", laterBackLabel: "tomorrow at 7:00 AM" });
    expect(r.kind === "waiting" && r.details.join(" ")).toMatch(/1 card is back tomorrow at 7:00 AM\./);
  });
});

describe("the side box states its own emptiness", () => {
  it("DeckSide says Nothing left in this deal rather than drawing an empty list", () => {
    expect(readFileSync("src/components/deck/DeckSide.tsx", "utf8")).toMatch(/DECK_SIDE_NOTHING_LEFT/);
  });
});
