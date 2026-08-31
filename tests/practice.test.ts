import { describe, expect, it } from "vitest";
import {
  LITIGATION_STAGE_CODES,
  PRACTICES,
  groupByPractice,
  isCollectionsStageCode,
  isLitigationStageCode,
  practiceLabel,
  practicesInOrder,
  resolvePractice,
  type MatterType,
  type PracticeId,
} from "@/lib/practice/resolve";

const matter = (type: MatterType, stageId: string | null = null) => ({
  type,
  stage_id: stageId,
});

describe("resolvePractice", () => {
  it("routes a LIT matter with no stage to litigation", () => {
    // The 22-matter case. An unplaced litigation matter is still litigation;
    // anything else deletes 65% of her live caseload from the tab.
    expect(resolvePractice(matter("LIT", null), null)).toBe("litigation");
    expect(resolvePractice(matter("LIT", null))).toBe("litigation");
    expect(resolvePractice(matter("LIT", null), undefined)).toBe("litigation");
  });

  it("routes a LIT matter on a PC stage to collections", () => {
    expect(resolvePractice(matter("LIT", "s1"), { code: "PC30" })).toBe("collections");
    for (const code of ["PC10", "PC20", "PC30", "PC40", "PC80", "PC90"]) {
      expect(resolvePractice(matter("LIT", "s1"), { code })).toBe("collections");
    }
  });

  it("routes a LIT matter on the litigation ladder to litigation", () => {
    for (const code of LITIGATION_STAGE_CODES) {
      expect(resolvePractice(matter("LIT", "s1"), { code })).toBe("litigation");
    }
  });

  it("routes a TM matter to trademark whatever its stage", () => {
    expect(resolvePractice(matter("TM", null), null)).toBe("trademark");
    expect(resolvePractice(matter("TM", "s9"), { code: "OFFICE_ACTION" })).toBe("trademark");
    // A TM matter parked on a PC-prefixed stage is still trademark: type wins
    // for TM, and the PC rule only ever applies within LIT.
    expect(resolvePractice(matter("TM", "s9"), { code: "PC30" })).toBe("trademark");
  });

  it("keeps a LIT matter whose stage the caller cannot see on the litigation board", () => {
    // stage_id set, stage row invisible (RLS, or a catalog fetched elsewhere).
    expect(resolvePractice(matter("LIT", "invisible-stage"), null)).toBe("litigation");
  });

  it("never drops a matter: an unrecognised LIT stage code is litigation", () => {
    expect(resolvePractice(matter("LIT", "s1"), { code: "SOMETHING_NEW" })).toBe("litigation");
  });

  it("gives every matter type a real tab", () => {
    const types: MatterType[] = ["TM", "PATENT", "CR", "BL", "EL", "SO", "LIT"];
    const ids = PRACTICES.map((p) => p.id);
    for (const type of types) {
      expect(ids).toContain(resolvePractice(matter(type, null), null));
    }
  });
});

describe("stage code predicates", () => {
  it("keys collections on the PC prefix, not an enumeration", () => {
    expect(isCollectionsStageCode("PC30")).toBe(true);
    // A seventh PC stage added to her docket tomorrow lands correctly.
    expect(isCollectionsStageCode("PC95")).toBe(true);
    expect(isCollectionsStageCode("pc30")).toBe(true);
    expect(isCollectionsStageCode(" PC30 ")).toBe(true);
    expect(isCollectionsStageCode("SERVED")).toBe(false);
    expect(isCollectionsStageCode(null)).toBe(false);
    expect(isCollectionsStageCode(undefined)).toBe(false);
    expect(isCollectionsStageCode("")).toBe(false);
  });

  it("recognises the litigation ladder", () => {
    expect(isLitigationStageCode("MOT_PENDING")).toBe(true);
    expect(isLitigationStageCode("mot_pending")).toBe(true);
    expect(isLitigationStageCode("PC30")).toBe(false);
    expect(isLitigationStageCode(null)).toBe(false);
  });
});

describe("PRACTICES registry", () => {
  it("carries the three practices with distinct ids and orders", () => {
    expect(PRACTICES).toHaveLength(3);
    const ids = PRACTICES.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    const orders = PRACTICES.map((p) => p.order);
    expect(new Set(orders).size).toBe(3);
    expect(ids).toEqual(expect.arrayContaining(["litigation", "collections", "trademark"]));
  });

  it("sorts by order without mutating the registry", () => {
    const before = PRACTICES.map((p) => p.id);
    expect(practicesInOrder().map((p) => p.order)).toEqual([1, 2, 3]);
    expect(PRACTICES.map((p) => p.id)).toEqual(before);
  });

  it("labels every practice", () => {
    for (const p of PRACTICES) expect(practiceLabel(p.id)).toBe(p.label);
  });
});

describe("groupByPractice", () => {
  it("places every matter in exactly one tab", () => {
    const matters = [
      { id: "a", type: "LIT" as const, stage_id: null },
      { id: "b", type: "LIT" as const, stage_id: "pc" },
      { id: "c", type: "TM" as const, stage_id: null },
      { id: "d", type: "LIT" as const, stage_id: "lit" },
    ];
    const stages: Record<string, { code: string }> = {
      pc: { code: "PC30" },
      lit: { code: "SERVED" },
    };
    const grouped = groupByPractice(matters, (m) => (m.stage_id ? stages[m.stage_id] : null));

    expect(grouped.litigation.map((m) => m.id)).toEqual(["a", "d"]);
    expect(grouped.collections.map((m) => m.id)).toEqual(["b"]);
    expect(grouped.trademark.map((m) => m.id)).toEqual(["c"]);

    const total = (Object.keys(grouped) as PracticeId[]).reduce(
      (n, key) => n + grouped[key].length,
      0,
    );
    expect(total).toBe(matters.length);
  });
});
