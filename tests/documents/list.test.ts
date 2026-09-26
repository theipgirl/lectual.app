import { describe, it, expect } from "vitest";
import { docStatus, isDocFilter, DOC_TYPE_LABEL, DOC_KIND } from "@/lib/documents/list";

describe("documents list helpers", () => {
  it("never shows a queued letter as sent or done", () => {
    expect(docStatus("queued").label).toBe("Waiting on approval");
    expect(docStatus("generated").tone).toBe("lx-pill-ok");
    expect(docStatus("failed").tone).toBe("lx-pill-risk");
    expect(docStatus("mystery")).toEqual({ label: "mystery", tone: "lx-pill-mute" });
  });
  it("labels every doc_type 0045 allows", () => {
    for (const t of ["opinion_letter", "loe_trademark_current", "loe_trademark_legacy", "loe_general"]) {
      expect(DOC_TYPE_LABEL[t]).toBeTruthy();
      expect(DOC_KIND[t]).toMatch(/^[A-Z]{3}$/);
    }
  });
  it("accepts only known filters from the URL", () => {
    expect(isDocFilter("queued")).toBe(true);
    expect(isDocFilter("sent")).toBe(false);
  });
});
