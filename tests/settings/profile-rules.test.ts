import { describe, it, expect } from "vitest";
import { checkProfileInput, isTimeZone, timeZoneOptions } from "@/lib/org/profile-rules";
import { followUpSystem } from "@/lib/agents/post-consult";

describe("firm profile rules", () => {
  it("trims, blanks become null, and the default zone fills in", () => {
    expect(checkProfileInput({ displayName: "  Hartwell IP ", timeZone: "", emailSignature: " \r\nDana\r\n " })).toEqual({
      ok: true,
      value: { display_name: "Hartwell IP", time_zone: "America/New_York", email_signature: "Dana" },
    });
    expect(checkProfileInput({ displayName: "", timeZone: "America/Chicago", emailSignature: "" })).toMatchObject({
      ok: true,
      value: { display_name: null, email_signature: null },
    });
  });
  it("refuses an unknown zone and over-long fields before the database sees them", () => {
    expect(checkProfileInput({ displayName: "x", timeZone: "Mars/Olympus", emailSignature: "" }).ok).toBe(false);
    expect(checkProfileInput({ displayName: "x".repeat(121), timeZone: "UTC", emailSignature: "" }).ok).toBe(false);
    expect(checkProfileInput({ displayName: "x", timeZone: "UTC", emailSignature: "y".repeat(2001) }).ok).toBe(false);
    expect(isTimeZone("America/Los_Angeles")).toBe(true);
  });
  it("lists US zones first, once each", () => {
    const zones = timeZoneOptions();
    expect(zones[0]).toBe("America/New_York");
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe("post-consult sign-off", () => {
  it("uses the firm's sign-off verbatim when there is one, and a placeholder otherwise", () => {
    expect(followUpSystem("Dana Ruiz\nHartwell IP")).toContain("<sign_off>\nDana Ruiz\nHartwell IP\n</sign_off>");
    expect(followUpSystem(null)).toContain("[Attorney name]");
    expect(followUpSystem(null)).not.toContain("<sign_off>");
  });
});
