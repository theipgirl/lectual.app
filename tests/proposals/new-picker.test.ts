import { describe, it, expect } from "vitest";
import {
  BLANK_HREF,
  buildPicker,
  chooseHref,
  pickerHref,
  pickerKind,
  proposalLeadRecord,
  proposalMatterRecord,
  showingLine,
  type ListRead,
} from "@/lib/proposals/new-picker";
import { SEARCH_MAX } from "@/lib/skills/pick";

/**
 * The New proposal picker's rules, pure: which list, which search, how many rows, and what each link
 * says. Nothing here reads a database; the page hands in the two list reads it made.
 */

type LeadIn = Parameters<typeof proposalLeadRecord>[0];
type MatterIn = Parameters<typeof proposalMatterRecord>[0];

const lead = (n: number, over: Partial<LeadIn> = {}) =>
  proposalLeadRecord({ id: `lead-${n}`, first_name: `First${n}`, last_name: `Last${n}`, business_name: null, email: `p${n}@example.com`, ...over });
const matter = (n: number, over: Partial<MatterIn> = {}) =>
  proposalMatterRecord({
    id: `m-${n}`,
    type: "TM",
    title: null,
    mark_text: `MARK${n}`,
    matter_number: `TM-2026-${String(n).padStart(4, "0")}`,
    owner_name: `Owner ${n}`,
    ...over,
  });

const ok = (records: ReturnType<typeof lead>[]): ListRead => ({ status: "ok", records });
const FAILED: ListRead = { status: "failed" };

function rowsOf(view: ReturnType<typeof buildPicker>) {
  if (view.list.status !== "ok") throw new Error("expected an ok list");
  return view.list;
}

describe("kind and term", () => {
  it("only 'matter' selects matters; anything else is leads", () => {
    expect(pickerKind("matter")).toBe("matter");
    expect(pickerKind("lead")).toBe("lead");
    expect(pickerKind(undefined)).toBe("lead");
    expect(pickerKind("matters")).toBe("lead");
    expect(pickerKind(["matter", "lead"])).toBe("matter");
  });

  it("the term is trimmed and capped at 80 characters", () => {
    const view = buildPicker({ kind: "lead", term: `  ${"x".repeat(200)}  `, leads: ok([]), matters: ok([]) });
    expect(view.term).toBe("x".repeat(SEARCH_MAX));
    expect(buildPicker({ kind: "lead", term: "  ana  ", leads: ok([]), matters: ok([]) }).term).toBe("ana");
  });

  it("only the selected kind's list is built", () => {
    const view = buildPicker({ kind: "matter", term: "", leads: ok([lead(1)]), matters: ok([matter(1), matter(2)]) });
    expect(rowsOf(view).rows.map((r) => r.id)).toEqual(["m-1", "m-2"]);
    const leads = buildPicker({ kind: "lead", term: "", leads: ok([lead(1)]), matters: ok([matter(1), matter(2)]) });
    expect(rowsOf(leads).rows.map((r) => r.id)).toEqual(["lead-1"]);
  });
});

describe("search: one test per field proves a record is found by it and another is not", () => {
  const found = (view: ReturnType<typeof buildPicker>) => rowsOf(view).rows.map((r) => r.id);

  describe("leads", () => {
    const leads = ok([
      lead(1, { first_name: "Ana", last_name: "Ruiz", business_name: "Zephyr Co", email: "ana@example.com" }),
      lead(2, { first_name: "Ben", last_name: "Okafor", business_name: "Birch LLC", email: "ben@birch.test" }),
    ]);
    const search = (term: string) => found(buildPicker({ kind: "lead", term, leads, matters: ok([]) }));

    it("first name, case-insensitively", () => expect(search("aNa")).toEqual(["lead-1"]));
    it("last name", () => expect(search("okafor")).toEqual(["lead-2"]));
    it("full name", () => expect(search("ana ruiz")).toEqual(["lead-1"]));
    it("business name", () => expect(search("BIRCH")).toEqual(["lead-2"]));
    it("email", () => expect(search("ben@birch")).toEqual(["lead-2"]));
    it("nothing matches a stranger", () => expect(search("zzz")).toEqual([]));
  });

  describe("matters", () => {
    const matters = ok([
      matter(1, { mark_text: "Zephyr", title: "Zephyr filing", matter_number: "TM-2026-0101", owner_name: "Ana Ruiz" }),
      matter(2, { mark_text: "Birch", title: "Birch refresh", matter_number: "TM-2026-0202", owner_name: "Ben Okafor" }),
    ]);
    const search = (term: string) => found(buildPicker({ kind: "matter", term, leads: ok([]), matters }));

    it("mark", () => expect(search("zeph")).toEqual(["m-1"]));
    it("title", () => expect(search("refresh")).toEqual(["m-2"]));
    it("matter number", () => expect(search("0202")).toEqual(["m-2"]));
    it("owner (client) name", () => expect(search("ruiz")).toEqual(["m-1"]));
    it("nothing matches a stranger", () => expect(search("zzz")).toEqual([]));
  });

  it("every matter type is offered, not only trademark matters", () => {
    const view = buildPicker({
      kind: "matter",
      term: "",
      leads: ok([]),
      matters: ok([matter(1, { type: "TM" }), matter(2, { type: "CR" }), matter(3, { type: "LIT" })] as never),
    });
    expect(rowsOf(view).total).toBe(3);
  });
});

describe("the cap of 8 and 'Showing N of M'", () => {
  const many = (n: number) => ok(Array.from({ length: n }, (_, i) => lead(i + 1)));

  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [8, 8, 8],
    [9, 8, 9],
    [30, 8, 30],
  ])("%i matches draw %i and say M = %i", (n, drawn, total) => {
    const list = rowsOf(buildPicker({ kind: "lead", term: "", leads: many(n), matters: ok([]) }));
    expect(list.rows).toHaveLength(drawn);
    expect(list.total).toBe(total);
    expect(showingLine(list.rows.length, list.total)).toBe(`Showing ${drawn} of ${total}.`);
  });

  it("keeps the order the read returned (recent first)", () => {
    const list = rowsOf(buildPicker({ kind: "lead", term: "", leads: many(12), matters: ok([]) }));
    expect(list.rows.map((r) => r.id)).toEqual(Array.from({ length: 8 }, (_, i) => `lead-${i + 1}`));
  });

  it("a search narrows M, not just the drawn rows", () => {
    const leads = ok(Array.from({ length: 30 }, (_, i) => lead(i + 1, { first_name: i < 12 ? "Pat" : "Sam" })));
    const list = rowsOf(buildPicker({ kind: "lead", term: "pat", leads, matters: ok([]) }));
    expect(list.total).toBe(12);
    expect(list.rows).toHaveLength(8);
  });
});

describe("labels", () => {
  it("a lead is named like the transcript picker names it: person and business", () => {
    expect(lead(1, { first_name: "Ana", last_name: "Ruiz", business_name: "Ruiz Co" }).label).toBe("Ana Ruiz · Ruiz Co");
    expect(lead(2, { business_name: null }).label).toBe("First2 Last2");
    expect(lead(3, { first_name: "", last_name: "", business_name: null }).label).toBe("p3@example.com");
  });

  it("the email is the detail, and not repeated when it is the label", () => {
    expect(lead(1).detail).toBe("p1@example.com");
    expect(lead(3, { first_name: "", last_name: "", business_name: null }).detail).toBeNull();
  });

  it("a matter is named by mark, else title, else number", () => {
    expect(matter(1).label).toBe("MARK1");
    expect(matter(2, { mark_text: null, title: "A title" }).label).toBe("A title");
    expect(matter(3, { mark_text: null, title: null }).label).toBe("TM-2026-0003");
  });
});

describe("links carry the id, and nothing else about the record", () => {
  it("choose links are ?lead=<id> / ?matter=<id>, URL-encoded", () => {
    expect(chooseHref("lead", "abc")).toBe("/dashboard/proposals/new/?lead=abc");
    expect(chooseHref("matter", "abc")).toBe("/dashboard/proposals/new/?matter=abc");
    expect(chooseHref("lead", 'a&b="c"')).toBe("/dashboard/proposals/new/?lead=a%26b%3D%22c%22");
  });

  it("the person's own search rides along, encoded and capped", () => {
    expect(chooseHref("lead", "abc", "ana ruiz")).toBe("/dashboard/proposals/new/?lead=abc&q=ana%20ruiz");
    expect(chooseHref("lead", "abc", "x".repeat(200))).toBe(`/dashboard/proposals/new/?lead=abc&q=${"x".repeat(SEARCH_MAX)}`);
  });

  it("no label, name, email or mark is in any href", () => {
    const view = buildPicker({
      kind: "lead",
      term: "",
      leads: ok([lead(1, { first_name: "Ana", last_name: "Ruiz", business_name: "Zephyr", email: "ana@example.com" })]),
      matters: ok([]),
    });
    const [row] = rowsOf(view).rows;
    expect(row.href).toBe("/dashboard/proposals/new/?lead=lead-1");
    for (const word of ["Ana", "Ruiz", "Zephyr", "ana%40", "example"]) expect(row.href).not.toContain(word);
  });

  it("an id with an ampersand or quote is encoded in the rows too", () => {
    const view = buildPicker({ kind: "lead", term: "", leads: ok([lead(1, { id: 'x&y"z' })]), matters: ok([]) });
    expect(rowsOf(view).rows[0].href).toBe("/dashboard/proposals/new/?lead=x%26y%22z");
  });

  it("the switch and Change links name the kind and keep the search", () => {
    const view = buildPicker({ kind: "lead", term: "ana", leads: ok([]), matters: ok([]) });
    expect(view.switchHrefs).toEqual({ lead: "/dashboard/proposals/new/?kind=lead&q=ana", matter: "/dashboard/proposals/new/?kind=matter&q=ana" });
    expect(pickerHref("matter")).toBe("/dashboard/proposals/new/?kind=matter");
    expect(BLANK_HREF).toBe("/dashboard/proposals/new/?blank=1");
    expect(view.blankHref).toBe(BLANK_HREF);
  });
});

describe("three states: a failed read is never an empty list", () => {
  it("a failed leads read is failed for leads only; matters still work", () => {
    const leadsView = buildPicker({ kind: "lead", term: "", leads: FAILED, matters: ok([matter(1)]) });
    expect(leadsView.list).toEqual({ status: "failed" });
    expect(leadsView.failed).toEqual(["lead"]);
    const mattersView = buildPicker({ kind: "matter", term: "", leads: FAILED, matters: ok([matter(1)]) });
    expect(rowsOf(mattersView).rows).toHaveLength(1);
  });

  it("a failed matters read leaves leads working, and the other way round", () => {
    const view = buildPicker({ kind: "lead", term: "", leads: ok([lead(1)]), matters: FAILED });
    expect(rowsOf(view).total).toBe(1);
    expect(view.failed).toEqual(["matter"]);
    expect(buildPicker({ kind: "matter", term: "", leads: ok([lead(1)]), matters: FAILED }).list).toEqual({ status: "failed" });
  });

  it("both failed names both", () => {
    const view = buildPicker({ kind: "lead", term: "ana", leads: FAILED, matters: FAILED });
    expect(view.failed).toEqual(["lead", "matter"]);
    expect(view.list).toEqual({ status: "failed" });
  });

  it("a read that worked and found nothing is an empty ok list", () => {
    expect(buildPicker({ kind: "lead", term: "", leads: ok([]), matters: ok([]) }).list).toEqual({ status: "ok", rows: [], total: 0 });
  });
});
