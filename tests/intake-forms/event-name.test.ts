import { describe, expect, it } from "vitest";
import { eventDisplayName } from "@/lib/intake-forms/event-name";

describe("eventDisplayName", () => {
  it.each([
    ["legal-assessment", "Legal Assessment"],
    ["urban-golf-2026", "Urban Golf 2026"],
    ["story2profit-2026", "Story2profit 2026"],
    ["ugw_2026 booth", "Ugw 2026 Booth"],
    ["--a--", "A"],
  ])("%s -> %s", (code, name) => expect(eventDisplayName(code)).toBe(name));
  it("an empty or separator-only code reads as itself", () => {
    expect(eventDisplayName("")).toBe("");
    expect(eventDisplayName("---")).toBe("---");
  });
});
