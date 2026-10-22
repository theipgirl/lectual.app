import { describe, it, expect } from "vitest";
import { PICK_LIMIT, SEARCH_MAX, leadRecord, matterRecord, normalizeTerm, pickRecords, type PickRecord } from "@/lib/skills/pick";
import { skillBySlug } from "@/lib/skills/catalog";

const lead = (n: number, over: Partial<Parameters<typeof leadRecord>[0]> = {}) =>
  leadRecord({ id: `lead-${n}`, first_name: `First${n}`, last_name: `Last${n}`, business_name: null, email: `p${n}@example.com`, ...over });
const matter = (n: number, over: Partial<Parameters<typeof matterRecord>[0]> = {}) =>
  matterRecord({ id: `m-${n}`, type: "TM", title: null, mark_text: `MARK${n}`, matter_number: `TM-2026-${String(n).padStart(4, "0")}`, owner_name: `Owner ${n}`, ...over });

const prep = skillBySlug("prep-consult")!;
const welcome = skillBySlug("welcome-client")!;
const letter = skillBySlug("opinion-letter")!;

describe("normalizeTerm", () => {
  it("trims, and caps at 80 characters", () => {
    expect(normalizeTerm("  jane  ")).toBe("jane");
    expect(normalizeTerm("x".repeat(200))).toHaveLength(SEARCH_MAX);
    expect(normalizeTerm(`${" ".repeat(10)}${"y".repeat(100)}`)).toBe("y".repeat(80));
  });
  it("takes the first of repeated values, and nothing is empty", () => {
    expect(normalizeTerm(["a", "b"])).toBe("a");
    expect(normalizeTerm(undefined)).toBe("");
    expect(normalizeTerm("   ")).toBe("");
  });
});

describe("records", () => {
  it("a lead is labelled by business, else name, else email, and the detail carries the rest", () => {
    expect(lead(1, { business_name: "Acme Co" })).toMatchObject({ label: "Acme Co", detail: "First1 Last1 · p1@example.com" });
    expect(lead(2)).toMatchObject({ label: "First2 Last2", detail: "p2@example.com" });
    expect(lead(3, { first_name: null, last_name: null, business_name: null }).label).toBe("p3@example.com");
    expect(lead(4, { first_name: null, last_name: null, business_name: null, email: null }).label).toBe("Unnamed lead");
  });
  it("a matter is labelled by mark, else title, else number", () => {
    expect(matter(1).label).toBe("MARK1");
    expect(matter(2, { mark_text: null, title: "A title" }).label).toBe("A title");
    expect(matter(3, { mark_text: null, title: null }).label).toBe("TM-2026-0003");
    expect(matter(3, { mark_text: null, title: null }).detail).toBe("Owner 3");
  });
});

describe("pickRecords", () => {
  const leads = Array.from({ length: 12 }, (_, i) => lead(i + 1));

  it("with no term: the first 8, and how many there are", () => {
    const { shown, total } = pickRecords(leads, prep, "lead", "");
    expect(PICK_LIMIT).toBe(8);
    expect(shown.map((r) => r.id)).toEqual(leads.slice(0, 8).map((r) => r.id));
    expect(total).toBe(12);
  });

  it("keeps the caller's order (most recent first)", () => {
    expect(pickRecords([...leads].reverse(), prep, "lead", "").shown[0].id).toBe("lead-12");
  });

  it("filters on name, business, email, case-insensitively", () => {
    const rows = [
      lead(1, { first_name: "Jane", last_name: "Doe" }),
      lead(2, { first_name: "Bob", last_name: "Smith", business_name: "Acme Widgets" }),
      lead(3, { first_name: "Cy", last_name: "Poe", email: "Cy@Example.org" }),
    ];
    expect(pickRecords(rows, prep, "lead", "JANE").shown.map((r) => r.id)).toEqual(["lead-1"]);
    expect(pickRecords(rows, prep, "lead", "jane doe").shown.map((r) => r.id)).toEqual(["lead-1"]);
    expect(pickRecords(rows, prep, "lead", "widget").shown.map((r) => r.id)).toEqual(["lead-2"]);
    expect(pickRecords(rows, prep, "lead", "cy@example.ORG").shown.map((r) => r.id)).toEqual(["lead-3"]);
  });

  it("filters on mark, matter number, title and client", () => {
    const rows = [matter(1, { mark_text: "Zephyr" }), matter(2, { title: "Brand refresh", mark_text: null }), matter(3, { owner_name: "Quinn LLC" })];
    expect(pickRecords(rows, letter, "matter", "zeph").shown.map((r) => r.id)).toEqual(["m-1"]);
    expect(pickRecords(rows, letter, "matter", "tm-2026-0003").shown.map((r) => r.id)).toEqual(["m-3"]);
    expect(pickRecords(rows, letter, "matter", "refresh").shown.map((r) => r.id)).toEqual(["m-2"]);
    expect(pickRecords(rows, letter, "matter", "quinn").shown.map((r) => r.id)).toEqual(["m-3"]);
  });

  it("a term is trimmed and capped before it is used", () => {
    const rows = [lead(1, { first_name: "Jane" })];
    expect(pickRecords(rows, prep, "lead", "  jane ").total).toBe(1);
    expect(pickRecords(rows, prep, "lead", `jane${"z".repeat(100)}`).total).toBe(0);
  });

  it("counts every match, not only the ones shown", () => {
    const { shown, total } = pickRecords(leads, prep, "lead", "last1");
    expect(total).toBe(4); // Last1, Last10, Last11, Last12
    expect(shown).toHaveLength(4);
  });

  it("a search that matches nothing is an empty list with a zero total", () => {
    expect(pickRecords(leads, prep, "lead", "nobody")).toEqual({ shown: [], total: 0 });
  });

  it("returns only the kind asked for", () => {
    const mixed: PickRecord[] = [lead(1), matter(1)];
    expect(pickRecords(mixed, prep, "lead", "").shown.map((r) => r.kind)).toEqual(["lead"]);
    expect(pickRecords(mixed, letter, "matter", "").shown.map((r) => r.kind)).toEqual(["matter"]);
  });

  it("Welcome a client lists only trademark matters", () => {
    const rows = [matter(1), matter(2, { type: "COPYRIGHT" }), matter(3, { type: "LIT" })];
    expect(pickRecords(rows, welcome, "matter", "").shown.map((r) => r.id)).toEqual(["m-1"]);
    expect(pickRecords(rows, letter, "matter", "").total).toBe(3);
  });
});
