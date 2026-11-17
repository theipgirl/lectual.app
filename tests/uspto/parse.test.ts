import { describe, expect, it } from "vitest";
import { parseTsdrStatus } from "@/lib/uspto/parse";
import { abandoned, badShape, officeAction, pending, published, registered, tsdr, unknownStatus } from "./fixtures";

function ok(body: unknown, serial?: string) {
  const r = parseTsdrStatus(body, serial);
  if (!r.ok) throw new Error("expected ok");
  return r.value;
}

describe("parseTsdrStatus", () => {
  it("registered", () => {
    expect(ok(registered, "88123456")).toEqual({
      serial: "88123456",
      statusCode: 700,
      statusText: "Registered",
      statusDate: "2023-05-02",
      dates: { filing: "2021-03-10", publication: null, registration: "2023-05-02", abandonment: null, responseDue: null },
    });
  });
  it("pending", () => {
    const v = ok(pending);
    expect(v.statusCode).toBe(630);
    expect(v.dates.registration).toBeNull();
  });
  it("office action carries the response-due date", () => {
    expect(ok(officeAction).dates.responseDue).toBe("2024-09-01");
  });
  it("published", () => {
    expect(ok(published).dates.publication).toBe("2024-08-20");
  });
  it("abandoned, ISO timestamp cut to a civil date", () => {
    expect(ok(abandoned).dates.abandonment).toBe("2024-12-01");
  });
  it("unknown status still parses", () => {
    expect(ok(unknownStatus).statusCode).toBe(999);
  });
  it("a missing description is null text", () => {
    expect(ok(tsdr({ statusDescription: undefined })).statusText).toBeNull();
  });
  it("owner and personal data are gone", () => {
    const text = JSON.stringify(ok(registered));
    for (const s of ["Jane", "Private Lane", "jane@example.com", "Some Attorney", "SECRET BRAND", "owner", "attorney", "address"]) {
      expect(text.toLowerCase()).not.toContain(s.toLowerCase());
    }
    expect(Object.keys(ok(registered)).sort()).toEqual(["dates", "serial", "statusCode", "statusDate", "statusText"]);
  });
  it.each([
    ["bad shape", badShape],
    ["null", null],
    ["array", []],
    ["two marks", { trademarks: [registered.trademarks[0], registered.trademarks[0]] }],
    ["string code", tsdr({ status: "700" })],
    ["no status date", tsdr({ statusDate: undefined })],
    ["impossible date", tsdr({ statusDate: "2023-02-31" })],
    ["unreadable optional date", tsdr({ filingDate: "last tuesday" })],
    ["bad serial", tsdr({}, "123")],
    ["date with a garbage time part", tsdr({ statusDate: "2024-01-01Tgarbage" })],
  ])("shape failure: %s", (_n, body) => {
    expect(parseTsdrStatus(body)).toEqual({ ok: false, reason: "shape" });
  });
  it("a response for another serial is a shape failure", () => {
    expect(parseTsdrStatus(registered, "11111111")).toEqual({ ok: false, reason: "shape" });
  });
});
