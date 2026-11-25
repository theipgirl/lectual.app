import { describe, expect, it } from "vitest";
import { panelPlace, PANEL_MIN_ROOM } from "@/lib/views/layout/panel-place";

const vp = { width: 1440, height: 1000 };

describe("panelPlace: a menu panel always fits on screen (a page scroll closes it, so nothing may hang below the edge)", () => {
  it("opens below a button near the top, with the room below as its max height", () => {
    const p = panelPlace({ top: 100, bottom: 130, left: 200 }, vp, 300);
    expect(p).toEqual({ top: 134, left: 200, maxHeight: 1000 - 130 - 4 - 8 });
  });
  it("flips above a button low on the page (the E2E case: header near the bottom)", () => {
    const p = panelPlace({ top: 900, bottom: 930, left: 200 }, vp, 300);
    expect("bottom" in p && p.bottom).toBe(1000 - 900 + 4);
    expect(p.maxHeight).toBe(900 - 4 - 8);
    expect("top" in p).toBe(false);
  });
  it("stays below when there is at least the minimum room, even if above has more", () => {
    const top = 1000 - 8 - 4 - PANEL_MIN_ROOM - 30;
    const p = panelPlace({ top, bottom: top + 30, left: 10 }, vp, 300);
    expect("top" in p).toBe(true);
    expect(p.maxHeight).toBe(PANEL_MIN_ROOM);
  });
  it("keeps the panel inside the window sideways", () => {
    expect(panelPlace({ top: 10, bottom: 40, left: 1400 }, vp, 300).left).toBe(1440 - 300 - 8);
    expect(panelPlace({ top: 10, bottom: 40, left: -50 }, vp, 300).left).toBe(8);
  });
  it("never gives a max height under 120px on a tiny window", () => {
    expect(panelPlace({ top: 50, bottom: 80, left: 0 }, { width: 320, height: 150 }, 300).maxHeight).toBe(120);
  });
});
