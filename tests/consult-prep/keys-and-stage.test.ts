import { describe, expect, it } from "vitest";
import { eventPrepKey, markerEventId, normalizedStart, parsePrepKey, rerunKey, stagePrepKey } from "@/lib/consult-prep/keys";
import { consultScheduledStage, isConsultScheduledStage } from "@/lib/consult-prep/stage";
import type { StageOpt } from "@/lib/reconcile/types";

const LEAD = "11111111-1111-1111-1111-111111111111";
const EVENT = "22222222-2222-2222-2222-222222222222";

describe("prep keys", () => {
  it("an event key carries the lead, the event and the normalised start", () => {
    const key = eventPrepKey(LEAD, EVENT, "2026-11-25T14:00:00+00:00");
    expect(key).toBe(`${LEAD}:${EVENT}:2026-11-25T14:00:00.000Z`);
    expect(parsePrepKey(key)).toEqual({ leadId: LEAD, kind: "event", eventId: EVENT, startsAt: "2026-11-25T14:00:00.000Z", rerun: false });
  });
  it("the same instant written two ways is one key; a new start time is a new key", () => {
    expect(eventPrepKey(LEAD, EVENT, "2026-11-25T14:00:00+00:00")).toBe(eventPrepKey(LEAD, EVENT, "2026-11-25T09:00:00-05:00"));
    expect(eventPrepKey(LEAD, EVENT, "2026-11-25T14:00:00Z")).not.toBe(eventPrepKey(LEAD, EVENT, "2026-11-26T14:00:00Z"));
  });
  it("a stage key carries the newest stage row id", () => {
    const key = stagePrepKey(LEAD, "row-9");
    expect(key).toBe(`${LEAD}:stage:row-9`);
    expect(parsePrepKey(key)).toEqual({ leadId: LEAD, kind: "stage", stageRowId: "row-9", rerun: false });
    expect(markerEventId(key)).toBe("stage:row-9");
  });
  it("a re-run suffix is read back and does not change what the key is for", () => {
    const base = eventPrepKey(LEAD, EVENT, "2026-11-25T14:00:00Z");
    const key = rerunKey(base, 1_700_000_000_000);
    expect(key).toBe(`${base}:rerun:1700000000000`);
    expect(parsePrepKey(key)).toMatchObject({ kind: "event", eventId: EVENT, rerun: true });
    expect(markerEventId(key)).toBe(EVENT);
  });
  it("junk is not a key", () => {
    for (const bad of ["", "x", "a:b", `${LEAD}::z`]) expect(parsePrepKey(bad)).toBeNull();
    expect(normalizedStart("not a date")).toBeNull();
    expect(normalizedStart(null)).toBeNull();
  });
});

const stage = (id: string, name: string, orderIndex = 1): StageOpt => ({ id, name, category: "open", orderIndex });

describe("the consult stage is the Stage Keeper's rule", () => {
  const stages = [stage("s-new", "Potential New Client"), stage("s-consult", "Consultation Scheduled", 2), stage("s-held", "Consult Held", 3)];
  it("the default name is the consult stage; no other stage is", () => {
    expect(isConsultScheduledStage("s-consult", stages, {})).toBe(true);
    expect(isConsultScheduledStage("s-new", stages, {})).toBe(false);
    expect(isConsultScheduledStage("s-held", stages, {})).toBe(false);
  });
  it("a firm note's mapping wins, and a mapping naming a stage the firm lacks gives none (no fallback)", () => {
    expect(isConsultScheduledStage("s-held", stages, { "consult-scheduled": "Consult Held" })).toBe(true);
    expect(isConsultScheduledStage("s-consult", stages, { "consult-scheduled": "Consult Held" })).toBe(false);
    expect(consultScheduledStage(stages, { "consult-scheduled": "No such stage" })).toBeNull();
  });
  it("a firm with no such stage has none, and a missing id is never the stage", () => {
    expect(consultScheduledStage([stage("s-new", "Potential New Client")], {})).toBeNull();
    expect(isConsultScheduledStage(null, stages, {})).toBe(false);
    expect(isConsultScheduledStage("s-consult", [], {})).toBe(false);
  });
});
