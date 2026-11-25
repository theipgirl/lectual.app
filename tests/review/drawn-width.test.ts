import { describe, expect, it } from "vitest";
import { NO_SIZES, colWidth, drawnWidth } from "@/lib/review/sheet-edit";

describe("drawnWidth: where an arrow-key resize starts", () => {
  it("the viewer's own size, else the firm's layout width, else the default, null when flexible", () => {
    expect(drawnWidth({ cols: { status: 210 } }, "status", 300)).toBe(210);
    expect(drawnWidth(NO_SIZES, "status", 300)).toBe(300);
    expect(drawnWidth(NO_SIZES, "status", null)).toBe(colWidth(NO_SIZES, "status"));
    expect(drawnWidth(NO_SIZES, "status")).toBe(colWidth(NO_SIZES, "status"));
    expect(drawnWidth(NO_SIZES, "next", null)).toBeNull();
    expect(drawnWidth(NO_SIZES, "next", 400)).toBe(400);
  });
});
