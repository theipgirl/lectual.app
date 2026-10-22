import { describe, expect, it, vi } from "vitest";
import { FOCUSABLE_SELECTOR } from "@/lib/copilot/launcher";
import {
  GUARD_KEY,
  VIEWPORT_MARGIN,
  canSpotlight,
  clampIndex,
  closeTour,
  focusRestoreTarget,
  hasVisibleModal,
  measureTarget,
  placePopover,
  readGuard,
  shouldOpenOnLoad,
  stepTour,
  tourKeyAction,
  type Rect,
  type Viewport,
} from "@/lib/onboarding/engine";

describe("stepTour", () => {
  it("advances and stops at the last step, where next finishes", () => {
    expect(stepTour({ index: 0, count: 3 }, "next")).toEqual({ index: 1, outcome: null });
    expect(stepTour({ index: 1, count: 3 }, "next")).toEqual({ index: 2, outcome: null });
    expect(stepTour({ index: 2, count: 3 }, "next")).toEqual({ index: 2, outcome: "finished" });
  });
  it("back stops at the first", () => {
    expect(stepTour({ index: 0, count: 3 }, "back")).toEqual({ index: 0, outcome: null });
    expect(stepTour({ index: 2, count: 3 }, "back")).toEqual({ index: 1, outcome: null });
  });
  it("skip is skipped from anywhere", () => {
    expect(stepTour({ index: 1, count: 3 }, "skip").outcome).toBe("skipped");
  });
  it("clamps unknown indexes", () => {
    expect(clampIndex(-4, 3)).toBe(0);
    expect(clampIndex(99, 3)).toBe(2);
    expect(clampIndex(NaN, 3)).toBe(0);
    expect(clampIndex(1.9, 3)).toBe(1);
    expect(clampIndex(2, 0)).toBe(0);
    expect(stepTour({ index: 50, count: 3 }, "next").outcome).toBe("finished");
  });
});

describe("tourKeyAction", () => {
  const focus = { count: 3, current: 1 };
  it("Escape skips, arrows move", () => {
    expect(tourKeyAction({ key: "Escape" }, focus)?.kind).toBe("skip");
    expect(tourKeyAction({ key: "ArrowRight" }, focus)?.kind).toBe("next");
    expect(tourKeyAction({ key: "ArrowLeft" }, focus)?.kind).toBe("back");
  });
  it.each(["ctrlKey", "metaKey", "altKey", "shiftKey", "inField"] as const)("ignores arrows with %s", (mod) => {
    expect(tourKeyAction({ key: "ArrowRight", [mod]: true }, focus)).toBeNull();
    expect(tourKeyAction({ key: "ArrowLeft", [mod]: true }, focus)).toBeNull();
  });
  it("wraps Tab at the ends and leaves the middle to the browser", () => {
    expect(tourKeyAction({ key: "Tab" }, { count: 3, current: 2 })).toEqual({ kind: "focus", index: 0, preventDefault: true });
    expect(tourKeyAction({ key: "Tab", shiftKey: true }, { count: 3, current: 0 })).toEqual({ kind: "focus", index: 2, preventDefault: true });
    expect(tourKeyAction({ key: "Tab" }, { count: 3, current: 1 })).toBeNull();
  });
  it("does nothing for other keys", () => {
    expect(tourKeyAction({ key: "a" }, focus)).toBeNull();
    expect(tourKeyAction({ key: "Enter" }, focus)).toBeNull();
  });
  it("uses the repo's FOCUSABLE_SELECTOR rather than a copy", () => {
    expect(FOCUSABLE_SELECTOR).toContain("button");
  });
});

describe("placement", () => {
  const size = { width: 340, height: 220 };
  const rect: Rect = { top: 100, left: 300, width: 100, height: 40 };

  it("cuts out the rect with padding and sits on the preferred side", () => {
    const p = placePopover({ rect, viewport: { width: 1280, height: 800 }, size, side: "bottom" });
    expect(p.mode).toBe("spot");
    if (p.mode !== "spot") return;
    expect(p.cutout).toEqual({ top: 94, left: 294, width: 112, height: 52 });
    expect(p.popover.side).toBe("bottom");
    expect(p.popover.top).toBeGreaterThan(p.cutout.top + p.cutout.height);
  });

  it("flips to the opposite side when there is no room", () => {
    const low: Rect = { top: 700, left: 300, width: 100, height: 40 };
    const p = placePopover({ rect: low, viewport: { width: 1280, height: 800 }, size, side: "bottom" });
    expect(p.mode === "spot" && p.popover.side).toBe("top");
  });

  it("clamps inside the viewport with an 8px margin when neither side fits", () => {
    const tall: Rect = { top: 0, left: 0, width: 62, height: 800 };
    const p = placePopover({ rect: tall, viewport: { width: 768, height: 800 }, size: { width: 760, height: 220 }, side: "right" });
    expect(p.mode).toBe("spot");
    if (p.mode !== "spot") return;
    expect(p.popover.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it.each([768, 1024, 1440, 1920, 2560])("never places the popover off-screen at %ipx wide", (width) => {
    const viewport: Viewport = { width, height: 700 };
    const targets: Rect[] = [
      { top: 0, left: 0, width: 62, height: 700 },
      { top: 8, left: width - 100, width: 40, height: 40 },
      { top: 640, left: width - 70, width: 48, height: 48 },
      { top: 300, left: 200, width: 300, height: 30 },
    ];
    for (const r of targets) {
      for (const side of ["top", "bottom", "left", "right"] as const) {
        const p = placePopover({ rect: r, viewport, size: { width: 340, height: 260 }, side });
        if (p.mode !== "spot") continue;
        expect(p.popover.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        expect(p.popover.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        expect(p.popover.left + 340).toBeLessThanOrEqual(width - VIEWPORT_MARGIN);
        expect(p.popover.top + 260).toBeLessThanOrEqual(700 - VIEWPORT_MARGIN);
      }
    }
  });

  it.each([
    ["no rect", null, 1280],
    ["zero width", { top: 10, left: 10, width: 0, height: 20 }, 1280],
    ["zero height", { top: 10, left: 10, width: 20, height: 0 }, 1280],
    ["off to the left", { top: 10, left: -200, width: 100, height: 20 }, 1280],
    ["off below", { top: 900, left: 10, width: 100, height: 20 }, 1280],
    ["NaN", { top: NaN, left: 10, width: 100, height: 20 }, 1280],
    ["narrow viewport", { top: 10, left: 10, width: 100, height: 20 }, 767],
  ] as [string, Rect | null, number][])("centers for %s", (_n, r, width) => {
    expect(placePopover({ rect: r, viewport: { width, height: 800 }, size }).mode).toBe("center");
    expect(canSpotlight(r, { width, height: 800 })).toBe(false);
  });

  it("measureTarget never throws", () => {
    expect(measureTarget(null)).toBeNull();
    expect(measureTarget(undefined)).toBeNull();
    expect(measureTarget({})).toBeNull();
    expect(measureTarget({ getBoundingClientRect: () => { throw new Error("x"); } })).toBeNull();
    expect(measureTarget({ getBoundingClientRect: () => ({ top: 1, left: 2, width: 3, height: 4 }) })).toEqual({ top: 1, left: 2, width: 3, height: 4 });
  });
});

describe("shouldOpenOnLoad", () => {
  it("opens only when open, unguarded and no modal", () => {
    expect(shouldOpenOnLoad({ open: true, guard: false, modalOpen: false })).toBe(true);
    expect(shouldOpenOnLoad({ open: false, guard: false, modalOpen: false })).toBe(false);
    expect(shouldOpenOnLoad({ open: true, guard: true, modalOpen: false })).toBe(false);
    expect(shouldOpenOnLoad({ open: true, guard: false, modalOpen: true })).toBe(false);
  });
});

describe("hasVisibleModal", () => {
  const root = (els: object[]) => ({ querySelectorAll: () => els as never });
  it("counts a visible modal", () => {
    expect(hasVisibleModal(root([{ hidden: false, closest: () => null }]))).toBe(true);
  });
  it("does not count the hidden Copilot drawer, hidden itself or by an ancestor", () => {
    expect(hasVisibleModal(root([{ hidden: true }]))).toBe(false);
    expect(hasVisibleModal(root([{ hidden: false, closest: () => ({}) }]))).toBe(false);
  });
  it("is false for no root or a throwing root", () => {
    expect(hasVisibleModal(null)).toBe(false);
    expect(hasVisibleModal({ querySelectorAll: () => { throw new Error("x"); } })).toBe(false);
  });
});

describe("focusRestoreTarget", () => {
  it("returns the element when it is still in the page", () => {
    const el = { focus: () => {}, isConnected: true };
    expect(focusRestoreTarget(el)).toBe(el);
  });
  it("is null for null, a removed element, or one that cannot focus", () => {
    expect(focusRestoreTarget(null)).toBeNull();
    expect(focusRestoreTarget({ focus: () => {}, isConnected: false })).toBeNull();
    expect(focusRestoreTarget({})).toBeNull();
  });
});

describe("closeTour", () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it("closes, calls the action once with the outcome and sets the guard", async () => {
    const storage = store();
    const onClosed = vi.fn();
    const action = vi.fn().mockResolvedValue({ ok: true });
    await closeTour({ outcome: "finished", action, storage, onClosed });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("finished");
    expect(readGuard(storage)).toBe(true);
    expect(storage.data.has(GUARD_KEY)).toBe(true);
  });

  it("still closes and guards when the action rejects, fails, or throws at once", async () => {
    for (const action of [
      vi.fn().mockRejectedValue(new Error("secret db text")),
      vi.fn().mockResolvedValue({ ok: false, error: "secret db text" }),
      vi.fn(() => { throw new Error("secret db text"); }),
    ]) {
      const storage = store();
      const onClosed = vi.fn();
      const result = await closeTour({ outcome: "skipped", action, storage, onClosed });
      expect(result).toBeUndefined();
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(readGuard(storage)).toBe(true);
    }
  });

  it("survives storage that throws, or no storage", async () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    const onClosed = vi.fn();
    await expect(closeTour({ outcome: "skipped", action: async () => ({}), storage: bad, onClosed })).resolves.toBeUndefined();
    expect(onClosed).toHaveBeenCalled();
    expect(readGuard(bad)).toBe(false);
    await expect(closeTour({ outcome: "skipped", action: async () => ({}), storage: null, onClosed })).resolves.toBeUndefined();
  });

  it("is optimistic: reports closed before the action has resolved", async () => {
    let release: (v: unknown) => void = () => {};
    const pending = new Promise((r) => (release = r));
    const onClosed = vi.fn();
    const storage = store();
    const done = closeTour({ outcome: "finished", action: () => pending, storage, onClosed });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(readGuard(storage)).toBe(true);
    release({ ok: true });
    await done;
  });
});
