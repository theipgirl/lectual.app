import { beforeEach, describe, expect, it } from "vitest";
import { cleanFormName, lastChangedText, pickLastChanges, withFormNames, type ChangeRowIn } from "@/lib/review/last-changed";
import { CAME_IN_THROUGH_A_FORM, cameInThroughForm } from "@/lib/ui/words";
import { fakeDb, matter, mockReviewSources, NOW, state, type Call } from "./custom-load-harness";

mockReviewSources();

/**
 * Taylor, Nov 23: the Weekly review's last-changed line names the intake form by its STAFF name ("Came in through the UGW 2026 form"),
 * read through the scoped client in the review's batched read. Anything that isn't a readable, non-empty name keeps the exact generic
 * sentence "Came in through a form". Invented names only.
 */

const TZ = "America/New_York";
const L1 = "00000000-0000-4000-8000-0000000000d1";
const FORM = "00000000-0000-4000-8000-0000000000f1";
const formRow = (over: Partial<ChangeRowIn> = {}): ChangeRowIn => ({
  lead_id: L1, matter_id: null, type: "lead_created", actor_type: "system", actor_id: null, created_at: "2026-11-01T15:00:00Z", actor: null, source: "Intake form", ...over,
});
const changes = () => pickLastChanges([formRow()], TZ, NOW);
const line = (names: ReadonlyMap<string, string> | null) => lastChangedText(withFormNames(changes(), names).get(`lead:${L1}`), new Map(), "2026-11-02");

describe("the line, from the pure rules", () => {
  it("found: Came in through the <name> form", () => {
    expect(line(new Map([[L1, "UGW 2026"]]))).toBe("Came in through the UGW 2026 form · Nov 1");
    expect(cameInThroughForm("UGW 2026")).toBe("Came in through the UGW 2026 form");
  });
  it("a name that already ends in 'form' gets no second one", () => {
    expect(line(new Map([[L1, "Website intake form"]]))).toBe("Came in through the Website intake form · Nov 1");
    // Review fix: "form" at the end of a word counts too (no "Webform form").
    expect(cameInThroughForm("Webform")).toBe("Came in through the Webform");
    expect(cameInThroughForm("Contact FORM")).toBe("Came in through the Contact FORM");
    expect(cameInThroughForm("Formal intake")).toBe("Came in through the Formal intake form");
  });
  it("not found (no entry for the lead): exactly the generic sentence", () => {
    expect(line(new Map())).toBe(`${CAME_IN_THROUGH_A_FORM} · Nov 1`);
    expect(CAME_IN_THROUGH_A_FORM).toBe("Came in through a form");
  });
  it("failed read (null): exactly the generic sentence", () => {
    expect(line(null)).toBe("Came in through a form · Nov 1");
  });
  it("empty or whitespace name: exactly the generic sentence", () => {
    for (const n of ["", "   ", "\t\n"]) expect(line(new Map([[L1, n]])), JSON.stringify(n)).toBe("Came in through a form · Nov 1");
  });
  it("only form lines are touched; a person's change is not renamed", () => {
    const person = pickLastChanges([formRow({ actor_type: "user", actor_id: "u1", source: null })], TZ, NOW);
    expect(withFormNames(person, new Map([[L1, "UGW 2026"]])).get(`lead:${L1}`)?.actor).toEqual({ kind: "person", userId: "u1" });
  });
  it("a long name is cut; whitespace and control characters are tidied (the name is drawn as React text)", () => {
    expect(cleanFormName(`  Spring\u0007   expo  `)).toBe("Spring expo");
    expect([...(cleanFormName("x".repeat(200)) ?? "")].length).toBe(81);
    expect(cleanFormName(42)).toBeNull();
  });
});

describe("readIntakeFormNames: two batched scoped reads, the name never the slug", () => {
  const db = (answer: (c: Call) => { data: unknown; error?: unknown }) => fakeDb(answer);

  it("found: the lead's FIRST submission's form name; only id and name are selected from the form", async () => {
    const { readIntakeFormNames } = await import("@/lib/review/load");
    const OTHER = "00000000-0000-4000-8000-0000000000f2";
    const { db: d, calls } = db((c) =>
      c.table === "crm_intake_submission"
        ? { data: [{ id: "s2", lead_id: L1, form_id: OTHER, started_at: "2026-11-05T00:00:00Z" }, { id: "s1", lead_id: L1, form_id: FORM, started_at: "2026-11-01T00:00:00Z" }] }
        : { data: [{ id: FORM, name: "UGW 2026" }, { id: OTHER, name: "Later form" }] },
    );
    const names = await readIntakeFormNames(d as never, [L1]);
    expect(names.get(L1)).toBe("UGW 2026");
    const formCall = calls.find((c) => c.table === "crm_intake_form")!;
    expect(formCall.select).toBe("id, name");
    expect(formCall.select).not.toContain("slug");
    expect(calls.filter((c) => c.table === "crm_intake_submission")).toHaveLength(1);
    expect(calls.filter((c) => c.table === "crm_intake_form")).toHaveLength(1);
  });

  it("not found: a submission whose form row isn't returned, or an empty name, leaves the lead out", async () => {
    const { readIntakeFormNames } = await import("@/lib/review/load");
    const { db: d } = db((c) => (c.table === "crm_intake_submission" ? { data: [{ id: "s1", lead_id: L1, form_id: FORM, started_at: null }] } : { data: [] }));
    expect((await readIntakeFormNames(d as never, [L1])).has(L1)).toBe(false);
    const { db: e } = db((c) => (c.table === "crm_intake_submission" ? { data: [{ id: "s1", lead_id: L1, form_id: FORM, started_at: null }] } : { data: [{ id: FORM, name: "  " }] }));
    expect((await readIntakeFormNames(e as never, [L1])).has(L1)).toBe(false);
  });

  it("failed: either read's error rejects (the caller keeps the generic sentence)", async () => {
    const { readIntakeFormNames } = await import("@/lib/review/load");
    const { db: d } = db(() => ({ data: null, error: { code: "42501" } }));
    await expect(readIntakeFormNames(d as never, [L1])).rejects.toBeTruthy();
    const { db: e } = db((c) => (c.table === "crm_intake_submission" ? { data: [{ id: "s1", lead_id: L1, form_id: FORM, started_at: null }] } : { data: null, error: { code: "57014" } }));
    await expect(readIntakeFormNames(e as never, [L1])).rejects.toBeTruthy();
  });
});

describe("loadReview: a matter shows its lead's form line, named, in the one batched read", () => {
  beforeEach(() => {
    state.matters = [matter("m1", { lead_id: L1 })];
    state.merged = false;
  });
  const answer = (forms: "ok" | "fail" | "empty") => (c: Call) => {
    if (c.table === "crm_activity" && c.select.includes("source:payload->>source")) return { data: c.inn.some(([col, ids]) => col === "lead_id" && ids.includes(L1)) ? [formRow()] : [] };
    if (c.table === "crm_intake_submission") return forms === "fail" ? { data: null, error: { code: "500" } } : { data: [{ id: "s1", lead_id: L1, form_id: FORM, started_at: "2026-11-01T00:00:00Z" }] };
    if (c.table === "crm_intake_form") return { data: forms === "empty" ? [{ id: FORM, name: "" }] : [{ id: FORM, name: "UGW 2026" }] };
    return { data: [] };
  };

  for (const [mode, want] of [["ok", "Came in through the UGW 2026 form · Nov 1"], ["fail", "Came in through a form · Nov 1"], ["empty", "Came in through a form · Nov 1"]] as const)
    it(`${mode}: ${want}`, async () => {
      state.db = fakeDb(answer(mode)).db;
      const { loadReview } = await import("@/lib/review/load");
      const r = await loadReview(NOW);
      if (r.status !== "ok") throw new Error("ok expected");
      const row = r.rows.find((x) => x.id === "m1")!;
      expect(lastChangedText(row.lastChange, new Map(), r.today)).toBe(want);
      // A failed form-name read is not a "Some details couldn't load" source: the line still says something true.
      expect(r.failed).not.toContain("last change");
    });
});
