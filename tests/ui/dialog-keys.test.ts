import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dialogClass, dialogKeyAction, popoverClaimsKey } from "@/lib/ui/dialog-keys";

describe("dialogKeyAction", () => {
  it("Esc closes, unless the caller handles it", () => {
    expect(dialogKeyAction({ key: "Escape" }, { count: 3, current: 0 })).toEqual({ kind: "close", preventDefault: true });
    expect(dialogKeyAction({ key: "Escape" }, { count: 3, current: 0 }, { handleEsc: false })).toBeNull();
  });
  it("Tab wraps from the last item to the first", () => {
    expect(dialogKeyAction({ key: "Tab" }, { count: 3, current: 2 })).toEqual({ kind: "focus", index: 0, preventDefault: true });
    expect(dialogKeyAction({ key: "Tab" }, { count: 3, current: 1 })).toBeNull();
  });
  it("Shift+Tab wraps from the first item or the dialog itself to the last", () => {
    expect(dialogKeyAction({ key: "Tab", shiftKey: true }, { count: 3, current: 0 })).toEqual({ kind: "focus", index: 2, preventDefault: true });
    expect(dialogKeyAction({ key: "Tab", shiftKey: true }, { count: 3, current: -1 })).toEqual({ kind: "focus", index: 2, preventDefault: true });
    expect(dialogKeyAction({ key: "Tab", shiftKey: true }, { count: 3, current: 2 })).toBeNull();
  });
  it("pulls focus in when it is outside, and ignores other keys and empty dialogs", () => {
    expect(dialogKeyAction({ key: "Tab" }, { count: 2, current: -1 })).toEqual({ kind: "focus", index: 0, preventDefault: true });
    expect(dialogKeyAction({ key: "Tab" }, { count: 0, current: -1 })).toBeNull();
    expect(dialogKeyAction({ key: "a" }, { count: 2, current: 0 })).toBeNull();
  });
  it("names the size classes", () => {
    expect(dialogClass()).toBe("lx-modal lx-modal-md");
    expect(dialogClass("lg", "x")).toBe("lx-modal lx-modal-lg x");
  });
  it("a key a menu inside already claimed never closes the dialog", () => {
    expect(dialogKeyAction({ key: "Escape", defaultPrevented: true }, { count: 3, current: 0 })).toBeNull();
    expect(dialogKeyAction({ key: "Tab", defaultPrevented: true }, { count: 3, current: 2 })).toBeNull();
  });
});

describe("a menu's Esc closes the menu, not the card around it", () => {
  it("an open menu claims Esc; a closed one, another key or an already claimed key does not", () => {
    expect(popoverClaimsKey({ key: "Escape" }, true)).toBe(true);
    expect(popoverClaimsKey({ key: "Escape" }, false)).toBe(false);
    expect(popoverClaimsKey({ key: "Enter" }, true)).toBe(false);
    expect(popoverClaimsKey({ key: "Escape", defaultPrevented: true }, true)).toBe(false);
  });
  it("the popover claims the key in the capture phase, and the dialog ignores a claimed key", () => {
    const pop = readFileSync("src/components/list-page/Popover.tsx", "utf8");
    expect(pop).toMatch(/event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
    expect(pop).toMatch(/addEventListener\("keydown", onKeyDown, true\)/);
    const dlg = readFileSync("src/components/ui/Dialog.tsx", "utf8");
    expect(dlg).toMatch(/if \(e\.defaultPrevented\) return;/);
  });
});
