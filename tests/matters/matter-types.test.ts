import { describe, it, expect } from "vitest";
import { Constants, type Database } from "@/lib/db/types";
import {
  MATTER_TYPE_LABELS,
  MATTER_TYPE_MODULE,
  MATTER_TYPE_OPTIONS,
  MATTER_TYPE_VALUES,
  isMatterType,
  requiresExplicitMatterNumber,
  type MatterType,
} from "@/lib/matters/matter-types";

/**
 * The matter-type vocabulary (src/lib/matters/matter-types.ts).
 *
 * Pure-logic suite — no DB, never skipped. The guarantee that actually matters
 * here is a COMPILE-time one (an exhaustive Record over the generated
 * `crm_matter_type` enum, so the next `alter type ... add value` fails
 * `pnpm build` until the value is named in the UI). These tests cover the
 * runtime half: that every enum value has a real label, that the guard accepts
 * exactly those values, and that 'LIT' — the value that existed in the
 * database for months while the UI and the create action silently refused it —
 * is present.
 */

// The enum as the database defines it, read from the generated Constants
// rather than re-typed here: a hand-written list in the test would drift the
// same way the action's did.
const ENUM_VALUES: readonly MatterType[] = Constants.public.Enums.crm_matter_type;

describe("MATTER_TYPE_LABELS", () => {
  it("labels every value of the generated crm_matter_type enum", () => {
    for (const value of ENUM_VALUES) {
      const label = MATTER_TYPE_LABELS[value];
      expect(label, `no label for matter type '${value}'`).toBeTypeOf("string");
      expect(label.trim().length, `empty label for matter type '${value}'`).toBeGreaterThan(0);
    }
    // No extra keys either — the Record is the vocabulary, not a superset.
    expect([...MATTER_TYPE_VALUES].sort()).toEqual([...ENUM_VALUES].sort());
  });

  it("includes LIT, the litigation type 0040 added", () => {
    // The regression this whole module exists for: LIT was in the database and
    // in the generated enum, and in neither the form nor the create action.
    expect(MATTER_TYPE_LABELS.LIT).toBe("Litigation");
    expect(MATTER_TYPE_VALUES).toContain("LIT");
  });

  it("derives the dropdown options from the same object, in display order", () => {
    expect(MATTER_TYPE_OPTIONS.map((o) => o.value)).toEqual(MATTER_TYPE_VALUES);
    for (const option of MATTER_TYPE_OPTIONS) {
      expect(option.label).toBe(MATTER_TYPE_LABELS[option.value]);
    }
  });
});

describe("isMatterType", () => {
  it("accepts every key of the label map", () => {
    for (const value of ENUM_VALUES) {
      expect(isMatterType(value), `rejected real matter type '${value}'`).toBe(true);
    }
  });

  it("rejects junk", () => {
    for (const junk of [
      "",
      " TM",
      "tm",
      "LITIGATION",
      "DROP TABLE",
      null,
      undefined,
      42,
      {},
      ["TM"],
      // A label is not a value — the form posts values.
      "Trademark (TM)",
    ]) {
      expect(isMatterType(junk), `accepted junk ${JSON.stringify(junk)}`).toBe(false);
    }
  });
});

describe("module-gated types", () => {
  it("maps LIT to the litigation module and nothing else", () => {
    expect(MATTER_TYPE_MODULE.LIT).toBe("litigation");
    expect(Object.keys(MATTER_TYPE_MODULE)).toEqual(["LIT"]);
  });

  it("leaves the IP types ungated", () => {
    for (const value of ENUM_VALUES.filter((v) => v !== "LIT")) {
      expect(MATTER_TYPE_MODULE[value]).toBeUndefined();
    }
  });
});

describe("requiresExplicitMatterNumber", () => {
  it("is true only for LIT — its matter_number is the court case number", () => {
    expect(requiresExplicitMatterNumber("LIT")).toBe(true);
    for (const value of ENUM_VALUES.filter((v) => v !== "LIT")) {
      expect(requiresExplicitMatterNumber(value)).toBe(false);
    }
  });
});

describe("the compile-time guard", () => {
  it("only type-checks while the labels cover the generated enum", () => {
    // `never` unless every enum member is a key of MATTER_TYPE_LABELS, so a
    // new value added by a future migration breaks `pnpm build` here as well
    // as at the Record itself — the failure this module exists to cause.
    type LabelsCoverEnum = Database["public"]["Enums"]["crm_matter_type"] extends
      keyof typeof MATTER_TYPE_LABELS
      ? true
      : never;
    const covered: LabelsCoverEnum = true;
    expect(covered).toBe(true);
  });
});
