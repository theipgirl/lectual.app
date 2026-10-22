import { describe, expect, it } from "vitest";
import { isGeneratedMatterKey, matterDisplayTitle } from "@/lib/matters/display-title";
import { matterLabel } from "@/lib/matters/docket-summary";

const base = { mark_text: null, title: null, owner_name: null, matter_number: "TM-2026-0001" };

describe("matterDisplayTitle", () => {
  it("replaces a generated-key title with the mark", () => {
    const r = matterDisplayTitle({ ...base, matter_number: "TM-enisha-smith", title: "TM-enisha-smith", mark_text: "Glow Co" });
    expect(r).toEqual({ title: "Glow Co", secondary: "TM-enisha-smith" });
  });
  it("uses the client name when there is no mark and the title is a key", () => {
    const r = matterDisplayTitle({ ...base, matter_number: "TM-enisha-smith", title: "TM-enisha-smith", owner_name: "Enisha Smith" });
    expect(r.title).toBe("Enisha Smith");
    expect(r.secondary).toBe("TM-enisha-smith");
  });
  it("leaves normal titles unchanged", () => {
    expect(matterDisplayTitle({ ...base, title: "Aurelia registration" }).title).toBe("Aurelia registration");
    expect(matterDisplayTitle({ ...base, mark_text: "AURELIA", title: "x" }).title).toBe("AURELIA");
  });
  it("keeps the stored title when there is no mark and no client", () => {
    const r = matterDisplayTitle({ ...base, matter_number: "TM-enisha-smith", title: "TM-enisha-smith" });
    expect(r.title).toBe("TM-enisha-smith");
    expect(r.secondary).toBeNull();
  });
  it("falls back to the number when nothing is stored", () => {
    expect(matterDisplayTitle(base)).toEqual({ title: "TM-2026-0001", secondary: null });
  });
  it("detects keys but not real names", () => {
    expect(isGeneratedMatterKey("TM-enisha-smith")).toBe(true);
    expect(isGeneratedMatterKey("TM-97123456")).toBe(true);
    expect(isGeneratedMatterKey("Enisha Smith")).toBe(false);
    expect(isGeneratedMatterKey("NIKE")).toBe(false);
  });
  it("matterLabel uses it", () => {
    const m = { id: "1", status: "open", stage_entered_at: null, stage: null, ...base, matter_number: "TM-a-b", title: "TM-a-b", owner_name: "A B" };
    expect(matterLabel(m)).toBe("A B");
  });
});
