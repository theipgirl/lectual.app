import { vi } from "vitest";

/**
 * The page's read of the firm's saved column layout (`loadViewLayout`) for the page harnesses: by default there is no saved layout (the
 * standard columns, no note). `spies.layout` records which view was asked for. A test passes a different answer to see a layout applied or
 * the "couldn't load" note.
 */
export const layoutSpy = vi.fn();

export function mockLayoutRead(read: unknown = { status: "ok", layout: null, rev: null }) {
  layoutSpy.mockReset();
  layoutSpy.mockImplementation(async (view: string) => (typeof read === "function" ? (read as (v: string) => unknown)(view) : read));
  vi.doMock("@/lib/views/layout/load", () => ({ loadViewLayout: layoutSpy }));
}
