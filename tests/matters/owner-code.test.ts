import { describe, it, expect } from "vitest";
import { ownerChipFor, computeInitials } from "@/lib/matters/owner-code";

describe("ownerChipFor — RPB's TAM/C/RL/DO/AM/RB convention", () => {
  it("returns null for an unassigned matter/lead", () => {
    expect(ownerChipFor(null)).toBeNull();
  });

  it.each([
    ["Taylor McGhee", "TAM"],
    ["Caitlyn Rivera", "C"],
    ["Rain Ortiz", "RL"],
    ["Dawn Alvarez", "DO"],
    ["Amore Santos", "AM"],
    ["Rebecca P. Beliard", "RB"],
  ])("maps %s to the memorized code %s", (displayName, code) => {
    const chip = ownerChipFor({ userId: "u1", displayName, email: null });
    expect(chip?.code).toBe(code);
    expect(chip?.label).toBe(displayName);
  });

  it("resolves the known code off the email local-part when no display name is set", () => {
    const chip = ownerChipFor({ userId: "u2", displayName: null, email: "dawn@rpblawfirm.com" });
    expect(chip?.code).toBe("DO");
    expect(chip?.label).toBe("dawn@rpblawfirm.com");
  });

  it("is case-insensitive on the memorized names", () => {
    expect(ownerChipFor({ userId: "u3", displayName: "taylor mcghee", email: null })?.code).toBe("TAM");
  });

  it("falls through to computed initials for a teammate not in RPB's convention", () => {
    const chip = ownerChipFor({ userId: "u4", displayName: "Jordan Lee", email: null });
    expect(chip?.code).toBe("JL");
    expect(chip?.userId).toBe("u4");
  });

  it("never guesses a name — falls back to email, then the raw id", () => {
    const byEmail = ownerChipFor({ userId: "u5", displayName: null, email: "j@example.com" });
    expect(byEmail?.label).toBe("j@example.com");

    const byId = ownerChipFor({ userId: "u6", displayName: null, email: null });
    expect(byId?.label).toBe("u6");
  });
});

describe("computeInitials", () => {
  it("uses both initials for a two-word name", () => {
    expect(computeInitials("Jordan Lee")).toBe("JL");
  });

  it("caps at three tokens", () => {
    expect(computeInitials("Jordan Q Lee Smith")).toBe("JQL");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(computeInitials("Dawn")).toBe("DA");
  });

  it("never returns empty for non-empty input", () => {
    expect(computeInitials("x")).not.toBe("");
  });
});
