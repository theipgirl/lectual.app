import { describe, it, expect } from "vitest";

import { aliasTable, normalizeStageName, resolveStage } from "@/lib/lawmatics/stage-map";

import {
  DEFAULT_STAGE_NAMES,
  RPB_STAGE_NAMES,
  stageRefs,
} from "../__fixtures__/lawmatics.fixture";

const rpb = stageRefs(RPB_STAGE_NAMES);
const simple = stageRefs(DEFAULT_STAGE_NAMES);

function mapped(name: string, stages = rpb): string | null {
  const r = resolveStage(name, stages);
  return r.ok ? r.stage.name : null;
}

describe("normalizeStageName", () => {
  it("ignores case, punctuation, and ampersand spelling", () => {
    expect(normalizeStageName("Follow-Up")).toBe(normalizeStageName("follow up"));
    expect(normalizeStageName("LOE & Invoice Sent")).toBe(
      normalizeStageName("loe and invoice sent"),
    );
    expect(normalizeStageName("Undecided / Questions")).toBe("undecided questions");
  });

  it("drops a leading list number used to force UI ordering", () => {
    expect(normalizeStageName("3. Preliminary Search")).toBe("preliminary search");
    expect(normalizeStageName("10) Comprehensive Search")).toBe("comprehensive search");
  });
});

describe("resolveStage — exact matching against the firm's own stages", () => {
  it("matches RPB's 21 SOP stages by name, whatever the casing", () => {
    expect(mapped("Application Filed")).toBe("Application Filed");
    expect(mapped("application filed")).toBe("Application Filed");
    expect(mapped("Trademark Registered")).toBe("Trademark Registered");
    expect(mapped("Undecided / Questions")).toBe("Undecided / Questions");
    expect(mapped("LOE and Invoice Sent")).toBe("LOE & Invoice Sent");
  });

  it("reports the match as exact, not aliased", () => {
    const r = resolveStage("Preliminary Search", rpb);
    expect(r.ok && r.via).toBe("exact");
  });
});

describe("resolveStage — aliases resolve against whichever pipeline the firm has", () => {
  it("maps the Lawmatics intake pipeline onto RPB's 21 stages", () => {
    expect(mapped("New PNC")).toBe("Potential New Client");
    expect(mapped("Discovery Call Scheduled")).toBe("Consultation Scheduled");
    expect(mapped("Legal Strategy Session Scheduled")).toBe("Consultation Scheduled");
    expect(mapped("Pending LOE + Payment")).toBe("LOE & Invoice Sent");
    expect(mapped("Undecided")).toBe("Undecided / Questions");
  });

  // This previously asserted the opposite — that "Hired Client" mapped to
  // "Signed LOE / Deposit Received". It was pinning a defect.
  //
  // Lawmatics' RPB pipeline is an 11-stage INTAKE pipeline ending at "Hired
  // Client"; Lectual's is 21 stages covering the full lifecycle. Everything
  // after engagement (Comprehensive Search … Publication for Opposition) has
  // no Lawmatics equivalent and therefore sits upstream as "Hired Client", so
  // the alias collapsed the firm's whole post-engagement book onto stage 8 —
  // importing a matter awaiting registration as one that had just paid its
  // deposit, with its aging clock reset. Unmapped means a human places it.
  it("leaves 'Hired Client' UNMAPPED rather than guessing a lifecycle position", () => {
    const r = resolveStage("Hired Client", rpb);
    expect(r.ok).toBe(false);
    expect(mapped("Hired Client")).toBeNull();
    expect(mapped("Hired")).toBeNull();
  });

  // The bare-identity key is still wanted: it fires only when a firm's
  // Lawmatics pipeline literally carries that stage name, which asserts
  // sameness rather than inferring progress.
  it("still maps a literal 'Signed LOE / Deposit Received' stage name", () => {
    expect(mapped("Signed LOE / Deposit Received")).toBe("Signed LOE / Deposit Received");
  });

  it("maps the same Lawmatics names onto the 7-stage default pipeline instead", () => {
    expect(mapped("New PNC", simple)).toBe("New PNC");
    expect(mapped("Discovery Call Scheduled", simple)).toBe("Discovery Call");
    expect(mapped("Legal Strategy Session Scheduled", simple)).toBe("Strategy Session");
    expect(mapped("Hired Client", simple)).toBe("Hired Client");
    expect(mapped("Lost Lead", simple)).toBe("Lost");
  });

  it("flags an aliased match so the preview can show it was not a literal name match", () => {
    const r = resolveStage("New PNC", rpb);
    expect(r.ok && r.via).toBe("alias");
  });
});

describe("resolveStage — refuses to guess", () => {
  it.each([
    "Discovery Call No Show",
    "Discovery Call Complete",
    "Legal Strategy Session Complete",
    "Some Bespoke Stage Nobody Documented",
  ])("leaves %s unmapped rather than approximating it", (name) => {
    const r = resolveStage(name, rpb);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain(name);
  });

  it("does not fall back to a stage the firm doesn't have", () => {
    // RPB's 21-stage pipeline has no Nurture and no Lost — those must surface
    // as unmapped, not be forced into the nearest-looking stage.
    expect(mapped("Nurture")).toBeNull();
    expect(mapped("Lost Lead")).toBeNull();
  });

  it("reports a missing stage rather than defaulting to the first one", () => {
    const r = resolveStage(null, rpb);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/no stage/i);
  });

  it("returns unmapped when the firm has no stages at all", () => {
    expect(resolveStage("Application Filed", []).ok).toBe(false);
  });
});

describe("aliasTable", () => {
  it("exposes every alias for display, in normalized key form", () => {
    const table = aliasTable();
    expect(table.length).toBeGreaterThan(10);
    for (const row of table) {
      expect(row.lawmatics).toBe(normalizeStageName(row.lawmatics));
      expect(row.candidates.length).toBeGreaterThan(0);
    }
  });
});
