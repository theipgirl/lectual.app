import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FOCUSABLE_SELECTOR, focusFirstInput, launcherKeyAction, nextTabFocus, shouldShowLauncher } from "@/lib/copilot/launcher";
import { LEAD_ID } from "./helpers";

afterEach(() => vi.resetModules());

const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({ key: k, metaKey: false, ctrlKey: false, ...mods });

describe("shouldShowLauncher", () => {
  it.each(["/dashboard/copilot", "/dashboard/copilot/", "/dashboard/copilot/anything"])("is false on %s", (pathname) => {
    expect(shouldShowLauncher({ pathname, configured: true })).toBe(false);
  });

  it.each(["/dashboard", "/dashboard/", "/dashboard/matters/", `/dashboard/leads/${LEAD_ID}`, "/dashboard/queue/"])("is true on %s when AI is configured", (pathname) => {
    expect(shouldShowLauncher({ pathname, configured: true })).toBe(true);
  });

  it("is false on any path when AI is not configured", () => {
    for (const pathname of ["/dashboard", "/dashboard/matters/", "/dashboard/copilot/", `/dashboard/leads/${LEAD_ID}`]) {
      expect(shouldShowLauncher({ pathname, configured: false })).toBe(false);
    }
  });

  it("treats a missing pathname as a dashboard page rather than throwing", () => {
    expect(shouldShowLauncher({ pathname: null, configured: true })).toBe(true);
  });
});

describe("launcherKeyAction", () => {
  const on = { active: true, open: false };

  it("Command-J and Ctrl-J toggle, and ask for preventDefault", () => {
    expect(launcherKeyAction(key("j", { metaKey: true }), on)).toEqual({ open: true, preventDefault: true });
    expect(launcherKeyAction(key("j", { ctrlKey: true }), on)).toEqual({ open: true, preventDefault: true });
    expect(launcherKeyAction(key("J", { metaKey: true }), { active: true, open: true })).toEqual({ open: false, preventDefault: true });
  });

  it("plain j, other letters and Alt-modified chords do nothing", () => {
    expect(launcherKeyAction(key("j"), on)).toBeNull();
    expect(launcherKeyAction(key("k", { metaKey: true }), on)).toBeNull();
    expect(launcherKeyAction(key("j", { metaKey: true, altKey: true }), on)).toBeNull();
  });

  it("does nothing when the launcher is inactive (copilot page, AI not configured)", () => {
    expect(launcherKeyAction(key("j", { metaKey: true }), { active: false, open: false })).toBeNull();
    expect(launcherKeyAction(key("Escape"), { active: false, open: true })).toBeNull();
  });

  it("Escape closes an open drawer and does nothing when closed", () => {
    expect(launcherKeyAction(key("Escape"), { active: true, open: true })).toEqual({ open: false, preventDefault: false });
    expect(launcherKeyAction(key("Escape"), on)).toBeNull();
  });
});

describe("nextTabFocus (the focus trap)", () => {
  it("Tab on the last focusable goes to the first", () => {
    expect(nextTabFocus({ count: 4, current: 3, shift: false })).toBe(0);
  });
  it("Shift-Tab on the first goes to the last", () => {
    expect(nextTabFocus({ count: 4, current: 0, shift: true })).toBe(3);
  });
  it("Tab in the middle is left to the browser", () => {
    expect(nextTabFocus({ count: 4, current: 1, shift: false })).toBeNull();
    expect(nextTabFocus({ count: 4, current: 2, shift: true })).toBeNull();
  });
  it("a single focusable wraps onto itself", () => {
    expect(nextTabFocus({ count: 1, current: 0, shift: false })).toBe(0);
    expect(nextTabFocus({ count: 1, current: 0, shift: true })).toBe(0);
  });
  it("focus outside the drawer is pulled in", () => {
    expect(nextTabFocus({ count: 3, current: -1, shift: false })).toBe(0);
    expect(nextTabFocus({ count: 3, current: -1, shift: true })).toBe(2);
  });
  it("an empty list is safe", () => {
    expect(nextTabFocus({ count: 0, current: -1, shift: false })).toBeNull();
    expect(nextTabFocus({ count: 0, current: 0, shift: true })).toBeNull();
  });
  it("the focusable selector skips disabled controls", () => {
    expect(FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
    expect(FOCUSABLE_SELECTOR).toContain("input:not([disabled])");
  });
});

describe("focusFirstInput (focus on open)", () => {
  it("focuses the drawer's input", () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    expect(focusFirstInput({ querySelector })).toBe(true);
    expect(querySelector).toHaveBeenCalledWith("input, textarea");
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it("does nothing, safely, when there is no drawer or no input", () => {
    expect(focusFirstInput(null)).toBe(false);
    expect(focusFirstInput({ querySelector: () => null })).toBe(false);
  });
});

async function renderLauncher(pathname: string, configured: boolean) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({ usePathname: () => pathname }));
  const { CopilotLauncher } = await import("@/components/copilot/CopilotLauncher");
  return renderToStaticMarkup(<CopilotLauncher configured={configured} />);
}

describe("CopilotLauncher markup", () => {
  it("renders nothing when AI is not configured", async () => {
    expect(await renderLauncher("/dashboard/matters/", false)).toBe("");
  });

  it("renders nothing on the copilot page", async () => {
    expect(await renderLauncher("/dashboard/copilot/", true)).toBe("");
    expect(await renderLauncher("/dashboard/copilot", true)).toBe("");
  });

  it("closed, shows the fixed button with its accessible name and no drawer", async () => {
    const html = await renderLauncher("/dashboard/matters/", true);
    expect(html).toContain('class="cpd-launcher"');
    expect(html).toContain('aria-label="Ask Copilot"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("cpl-composer");
  });
});

describe("CopilotDrawer markup", () => {
  async function drawer(open: boolean) {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ usePathname: () => `/dashboard/leads/${LEAD_ID}` }));
    const { CopilotDrawer } = await import("@/components/copilot/CopilotLauncher");
    return renderToStaticMarkup(<CopilotDrawer open={open} pathname={`/dashboard/leads/${LEAD_ID}`} onClose={() => {}} />);
  }

  it("is a labelled dialog with a close button, the same chat composer, and the approval footer", async () => {
    const html = await drawer(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="copilot-drawer-title"/);
    expect(html).toContain('id="copilot-drawer-title"');
    expect(html).toContain(">Close</button>");
    expect(html).toContain('aria-label="Ask Copilot"');
    expect(html).toContain("cpl-composer");
    expect(html).toContain("Nothing sends without your approval.");
    expect(html).not.toMatch(/<aside[^>]*\shidden/);
  });

  it("is hidden, not removed, when closed, so a thread survives closing it", async () => {
    expect(await drawer(false)).toMatch(/<aside[^>]*\shidden/);
  });

  it("offers the three suggestion chips while the thread is empty", async () => {
    const html = (await drawer(true)).replaceAll("&#x27;", "'");
    expect(html.match(/class="cpl-chip"/g)).toHaveLength(3);
    expect(html).toContain("What's due in the next two weeks?");
  });
});

describe("how the launcher wires focus and the keyboard (source)", () => {
  const src = readFileSync("src/components/copilot/CopilotLauncher.tsx", "utf8");

  it("moves focus into the drawer on open and back to the button on close", () => {
    expect(src).toContain("focusFirstInput(drawerRef.current)");
    expect(src).toMatch(/else if \(wasOpen\.current\) buttonRef\.current\?\.focus\(\)/);
  });
  it("listens for keys only while active, through the pure key handler", () => {
    expect(src).toContain("launcherKeyAction(e, { active, open })");
    expect(src).toContain('document.addEventListener("keydown"');
    expect(src).toContain("if (action.preventDefault) e.preventDefault()");
  });
  it("traps Tab with the pure wrap function", () => {
    expect(src).toContain("nextTabFocus(");
  });
});
