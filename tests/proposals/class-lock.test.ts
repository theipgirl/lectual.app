import { describe, it, expect } from "vitest";
import {
  CLASS_LOCK_LAST_TEXT,
  CLASS_LOCK_ONLY_TEXT,
  classLock,
  classLocks,
  markWithoutClass,
  repairSelection,
} from "@/lib/proposals/class-lock";
import { sevetri } from "./fixture";

const pick = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]));

describe("classLock", () => {
  const oneClass = { marks: [{ id: "m", kind: "word" as const, desc: "", preselected: true }], classes: [{ id: "c1", label: "A", preselected: true }] };
  const twoClasses = { ...oneClass, classes: [...oneClass.classes, { id: "c2", label: "B", preselected: true }] };

  it("a brand name with one class locks it, with the word 'Included'", () => {
    expect(classLock(oneClass, pick("m", "c1"))).toEqual({ classId: "c1", text: CLASS_LOCK_ONLY_TEXT });
    expect(CLASS_LOCK_ONLY_TEXT).toBe("Included");
  });

  it("several classes, several ticked: nothing is locked", () => {
    expect(classLock(twoClasses, pick("m", "c1", "c2"))).toBeNull();
  });

  it("the last one standing is locked, whichever it is", () => {
    expect(classLock(twoClasses, pick("m", "c1"))).toEqual({ classId: "c1", text: CLASS_LOCK_LAST_TEXT });
    expect(classLock(twoClasses, pick("m", "c2"))).toEqual({ classId: "c2", text: "At least one class is included" });
  });

  it("an unselected brand name (no class ticked) locks nothing", () => {
    expect(classLock(twoClasses, {})).toBeNull();
    expect(classLock(oneClass, { m: false, c1: false })).toBeNull();
  });

  it("classLocks is keyed by brand name id", () => {
    const locks = classLocks(sevetri(), pick("p-word", "p-c1", "t-logo", "t-c1", "t-c2"));
    expect(Object.keys(locks)).toEqual(["p"]);
    expect(locks.p.classId).toBe("p-c1");
  });

  it("never throws on odd content", () => {
    expect(classLock({ marks: [], classes: undefined as never }, {})).toBeNull();
    expect(classLocks({ names: undefined } as never, {})).toEqual({});
  });
});

describe("repairSelection", () => {
  it("leaves a good selection alone", () => {
    const sel = pick("p-word", "p-c1");
    expect(repairSelection(sevetri(), sel)).toEqual({ ok: true, selection: sel, repaired: [] });
  });

  it("ticks the first class of a ticked mark that has none", () => {
    const r = repairSelection(sevetri(), pick("p-word", "t-logo", "t-c2"));
    expect(r).toMatchObject({ ok: true, repaired: ["p"] });
    if (r.ok) expect(r.selection["p-c1"]).toBe(true);
  });

  it("refuses a brand name with a ticked mark and no class to fall back on", () => {
    const c = sevetri();
    c.names[0].classes = [];
    expect(repairSelection(c, pick("p-word"))).toEqual({ ok: false, nameId: "p" });
  });

  it("an unticked mark needs no class", () => {
    expect(markWithoutClass(sevetri().names[0], {})).toBe(false);
    expect(markWithoutClass(sevetri().names[0], pick("p-logo"))).toBe(true);
  });
});

describe("validateContent and repairPreselections: a ticked mark needs a ticked class", () => {
  it("refuses a brand name whose mark starts ticked and no class does", async () => {
    const { validateContent } = await import("@/lib/proposals/validate");
    const c = sevetri();
    c.names[0].classes.forEach((cl) => (cl.preselected = false));
    const issues = validateContent(c);
    expect(issues.some((i) => i.level === "error" && i.path === "names[0].classes" && /at least one class/i.test(i.message))).toBe(true);
    expect(validateContent(sevetri()).filter((i) => i.level === "error")).toEqual([]);
  });

  it("a ticked mark with no class at all is refused with the 'Add a class' sentence", async () => {
    const { validateContent } = await import("@/lib/proposals/validate");
    const c = sevetri();
    c.names[0].classes = [];
    expect(validateContent(c).some((i) => i.path === "names[0].classes" && /Add a class/.test(i.message))).toBe(true);
  });

  it("repairs by ticking the first class, and cannot repair a brand with no class", async () => {
    const { repairPreselections } = await import("@/lib/proposals/class-lock");
    const c = sevetri();
    c.names[1].classes.forEach((cl) => (cl.preselected = false));
    const r = repairPreselections(c);
    expect(r).toMatchObject({ ok: true, repaired: ["t"] });
    if (r.ok) {
      expect(r.content.names[1].classes.map((x) => x.preselected)).toEqual([true, false]);
      expect(c.names[1].classes[0].preselected).toBe(false); // the input is not changed
    }
    c.names[1].classes = [];
    expect(repairPreselections(c)).toEqual({ ok: false, nameId: "t" });
    expect(repairPreselections(sevetri())).toMatchObject({ ok: true, repaired: [] });
  });
});
