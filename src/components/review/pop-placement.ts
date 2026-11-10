import { useLayoutEffect, type RefObject } from "react";
import { placePop } from "@/lib/review/pop-place";

/** Puts one popover where `placePop` says, from its parent cell's box. Safe to call again (scroll, resize). */
export function placePopover(pop: HTMLElement, align: "left" | "right"): void {
  const cell = pop.parentElement;
  if (!cell) return;
  const a = cell.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  const p = placePop(a, { width: r.width, height: r.height }, { width: document.documentElement.clientWidth, height: window.innerHeight }, align);
  pop.style.position = "fixed";
  pop.style.top = `${p.top}px`;
  pop.style.left = `${p.left}px`;
  pop.style.right = "auto";
  pop.dataset.above = p.above ? "true" : "false";
}

/** Keeps an open popover in view: measured when it opens, and again when the page or the table scrolls or the window resizes. */
export function usePopPlacement(ref: RefObject<HTMLElement | null>, align: "left" | "right" = "left"): void {
  useLayoutEffect(() => {
    const pop = ref.current;
    if (!pop) return;
    const run = () => placePopover(pop, align);
    run();
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    return () => {
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
    };
  }, [ref, align]);
}
