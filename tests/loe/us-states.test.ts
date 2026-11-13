import { describe, expect, it } from "vitest";
import { US_STATES, isUnitedStates, stateOptionLabel, usStateCode } from "@/lib/loe/us-states";

describe("US_STATES", () => {
  it("holds the 50 states, DC and the eight territories / military codes, once each", () => {
    expect(US_STATES).toHaveLength(59);
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(59);
    expect(new Set(US_STATES.map((s) => s.name)).size).toBe(59);
    for (const code of ["DC", "PR", "GU", "VI", "AS", "MP", "AA", "AE", "AP", "FL", "NY"]) expect(US_STATES.some((s) => s.code === code)).toBe(true);
    for (const s of US_STATES) expect(s.code).toMatch(/^[A-Z]{2}$/);
  });
  it("labels are the full name with the code", () => {
    expect(stateOptionLabel({ code: "FL", name: "Florida" })).toBe("Florida (FL)");
  });
  it("recognises the United States however it is typed, and nothing else", () => {
    for (const c of ["United States", " united  states ", "USA", "U.S.", "us", "United States of America"]) expect(isUnitedStates(c)).toBe(true);
    for (const c of ["", "Canada", "United Kingdom", "Austria"]) expect(isUnitedStates(c)).toBe(false);
  });
  it("maps a stored value (code or full name) to its code", () => {
    expect(usStateCode("fl")).toBe("FL");
    expect(usStateCode("Florida")).toBe("FL");
    expect(usStateCode("Ontario")).toBeNull();
    expect(usStateCode("")).toBeNull();
  });
});
