import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calendarReadState } from "@/lib/calendar/read-state";

describe("calendarReadState", () => {
  it("ok when every read landed, including empty ones", () => {
    expect(calendarReadState({ deadlines: [], tasks: [], events: [] })).toEqual({ kind: "ok" });
  });
  it("partial names what failed", () => {
    expect(calendarReadState({ deadlines: [], tasks: null, events: [] })).toEqual({ kind: "partial", failed: ["tasks"] });
  });
  it("unavailable when every read failed, never an empty week", () => {
    expect(calendarReadState({ deadlines: null, tasks: null, events: null })).toEqual({ kind: "unavailable" });
  });
  it("agenda does not count events", () => {
    expect(calendarReadState({ deadlines: null, tasks: null, events: undefined })).toEqual({ kind: "unavailable" });
    expect(calendarReadState({ deadlines: [], tasks: [], events: undefined })).toEqual({ kind: "ok" });
  });
});

describe("calendar page links", () => {
  const src = readFileSync("src/app/dashboard/calendar/page.tsx", "utf8");
  it("no Link prefetches a dynamic payload", () => {
    const links = src.match(/<Link\b/g) ?? [];
    const noPrefetch = src.match(/<Link\b[^>]*prefetch=\{false\}/g) ?? [];
    expect(links.length).toBeGreaterThan(5);
    expect(noPrefetch.length).toBe(links.length);
  });
});
