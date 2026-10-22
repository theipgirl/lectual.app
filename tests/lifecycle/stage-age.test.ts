import { describe, expect, it } from "vitest";
import { SINCE_IMPORT_LABEL, stageAgeDisplay } from "@/lib/lifecycle/stage-age";

const now = new Date("2026-10-22T12:00:00Z");

describe("stageAgeDisplay", () => {
  it("reads 'In stage since import' when the stage entry is the created time", () => {
    const r = stageAgeDisplay({ stageEnteredAt: "2026-08-22T10:00:00Z", createdAt: "2026-08-22T10:00:01Z", imported: true, now });
    expect(r).toEqual({ days: null, label: SINCE_IMPORT_LABEL, sinceImport: true });
  });
  it("reads 'since import' when the entry is the Lawmatics sync time", () => {
    const r = stageAgeDisplay({ stageEnteredAt: "2026-08-22T10:00:00Z", createdAt: "2026-01-01T00:00:00Z", importedAt: "2026-08-22T10:02:00Z", imported: true, now });
    expect(r.sinceImport).toBe(true);
  });
  it("uses the newest stage_changed date when the card has one", () => {
    const r = stageAgeDisplay({
      stageEnteredAt: "2026-08-22T10:00:00Z",
      createdAt: "2026-08-22T10:00:00Z",
      imported: true,
      lastStageChangeAt: "2026-10-12T12:00:00Z",
      now,
    });
    expect(r).toEqual({ days: 10, label: "10d in stage", sinceImport: false });
  });
  it("ignores a stage_changed date in the future", () => {
    const r = stageAgeDisplay({ stageEnteredAt: "2026-10-20T12:00:00Z", createdAt: "2026-01-01T00:00:00Z", lastStageChangeAt: "2027-01-01T00:00:00Z", now });
    expect(r.days).toBe(2);
  });
  it("otherwise shows the day count", () => {
    const r = stageAgeDisplay({ stageEnteredAt: "2026-10-01T12:00:00Z", createdAt: "2026-01-01T00:00:00Z", now });
    expect(r).toEqual({ days: 21, label: "21d in stage", sinceImport: false });
  });
  it("has nothing to say with no stage date", () => {
    expect(stageAgeDisplay({ stageEnteredAt: null, createdAt: "2026-01-01T00:00:00Z", now })).toEqual({ days: null, label: null, sinceImport: false });
  });
  it("keeps a stage date set on purpose even when a stage_changed was logged today", () => {
    const r = stageAgeDisplay({
      stageEnteredAt: "2026-10-02T12:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      lastStageChangeAt: "2026-10-22T11:00:00Z",
      now,
    });
    expect(r).toEqual({ days: 20, label: "20d in stage", sinceImport: false });
  });
  it("an imported lead with no stage move still reads 'In stage since import'", () => {
    const r = stageAgeDisplay({ stageEnteredAt: "2026-08-22T10:00:00Z", createdAt: "2026-08-22T10:00:00Z", imported: true, now });
    expect(r).toEqual({ days: null, label: SINCE_IMPORT_LABEL, sinceImport: true });
  });
  it("(a) a form or manual lead created today counts days, not 'since import'", () => {
    const t = "2026-10-22T09:00:00Z";
    const r = stageAgeDisplay({ stageEnteredAt: t, createdAt: t, imported: false, now });
    expect(r).toEqual({ days: 0, label: "0d in stage", sinceImport: false });
    expect(stageAgeDisplay({ stageEnteredAt: t, createdAt: t, now }).label).toBe("0d in stage");
  });
  it("(b) an imported lead with the same stamps reads 'In stage since import'", () => {
    const t = "2026-10-22T09:00:00Z";
    expect(stageAgeDisplay({ stageEnteredAt: t, createdAt: t, imported: true, now })).toEqual({ days: null, label: SINCE_IMPORT_LABEL, sinceImport: true });
  });
  it("(c) an imported lead with a stage_changed row counts from that row", () => {
    const t = "2026-08-22T10:00:00Z";
    const r = stageAgeDisplay({ stageEnteredAt: t, createdAt: t, imported: true, lastStageChangeAt: "2026-10-17T12:00:00Z", now });
    expect(r).toEqual({ days: 5, label: "5d in stage", sinceImport: false });
  });
});
