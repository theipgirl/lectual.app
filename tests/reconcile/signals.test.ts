import { describe, expect, it } from "vitest";
import { sheetKeyFor } from "../../src/lib/intake/sheet-import";
import { intakeCodeKeys, readSheetText } from "../../src/lib/intake/sheet-read";
import type { SheetEntry } from "../../src/lib/intake/sheet-read";
import type { LawmaticsSourceRecord } from "../../src/lib/lawmatics/normalize";
import { EMAIL_STAGE_TABLE, emailSignalFor } from "../../src/lib/reconcile/email";
import { indexLawmatics, isHiredStage, lawmaticsSignalFor, matchLawmatics } from "../../src/lib/reconcile/lawmatics";
import { matchSheetToLeads, sheetSignalFor } from "../../src/lib/reconcile/sheet-match";
import { NOW, S, STAGES, fixtureText } from "./helpers";

const key = (owner: string, mark: string | null, code: string) => sheetKeyFor({ ownerName: owner, markText: mark, stageCode: code });

function entry(over: Partial<SheetEntry> & { owner: string; mark?: string | null; code?: string; kind?: "ok" | "client" | "unmapped" }): SheetEntry {
  const { owner, mark = null, code = "1", kind = "ok" } = over;
  return {
    row: over.row ?? 2,
    ownerName: owner,
    markText: mark,
    exactKey: kind === "ok" ? key(owner, mark, code) : null,
    anyCodeKeys: intakeCodeKeys(owner, mark),
    reading:
      kind === "ok"
        ? { kind: "ok", stageId: S.consult, stageName: "Consultation Scheduled", wording: "3. Consultation Scheduled", date: null }
        : kind === "client"
          ? { kind: "client", wording: "7. Signed" }
          : { kind: "unmapped", wording: "9. ???" },
  };
}

describe("matching a sheet row to a lead", () => {
  it("matches by the exact stored sheet_key", () => {
    const e = entry({ owner: "Amara Nwosu", code: "1" });
    const m = matchSheetToLeads([e], [{ id: "L1", sheetKey: key("Amara Nwosu", null, "1") }]);
    expect(m.byLead.get("L1")).toEqual({ kind: "entry", entry: e });
    expect(m.withoutLead).toEqual([]);
  });

  it("matches a row that moved on the sheet, whose key is under a different status code", () => {
    const e = entry({ owner: "Amara Nwosu", code: "3" });
    const m = matchSheetToLeads([e], [{ id: "L1", sheetKey: key("Amara Nwosu", null, "1") }]);
    expect(m.byLead.get("L1")).toEqual({ kind: "entry", entry: e });
  });

  it("lists sheet rows with no lead and never matches a lead with no sheet_key", () => {
    const a = entry({ owner: "Amara Nwosu" });
    const b = entry({ owner: "Priya Raman", row: 3 });
    const m = matchSheetToLeads([a, b], [{ id: "L1", sheetKey: key("Amara Nwosu", null, "1") }, { id: "L2", sheetKey: null }]);
    expect(m.withoutLead).toEqual([b]);
    expect(m.byLead.has("L2")).toBe(false);
  });

  it("does not count client or unmapped rows as 'sheet rows with no lead'", () => {
    const m = matchSheetToLeads([entry({ owner: "Ines", kind: "client" }), entry({ owner: "Ola", kind: "unmapped" })], []);
    expect(m.withoutLead).toEqual([]);
  });

  it("reports two leads sharing a sheet_key instead of silently picking one", () => {
    const k = key("Amara Nwosu", null, "1");
    const m = matchSheetToLeads([entry({ owner: "Amara Nwosu" })], [{ id: "L1", sheetKey: k }, { id: "L2", sheetKey: k }]);
    expect(m.byLead.get("L1")).toMatchObject({ kind: "ambiguous", note: "2 leads share this sheet key" });
    expect(m.byLead.get("L2")).toMatchObject({ kind: "ambiguous" });
    expect(m.ambiguousLeads).toBe(2);
    expect(m.withoutLead).toEqual([]);
  });

  it("reports two leads that reach one sheet row, one by its current key and one by a stale status code", () => {
    const e = entry({ owner: "Acme Inc", mark: "ACME", code: "3" });
    const current = { id: "A", sheetKey: key("Acme Inc", "ACME", "1") };
    const stale = { id: "B", sheetKey: key("Acme Inc", "ACME", "3") };
    const m = matchSheetToLeads([e], [current, stale]);
    expect(m.byLead.get("A")).toMatchObject({ kind: "ambiguous", note: "2 leads match this sheet row" });
    expect(m.byLead.get("B")).toMatchObject({ kind: "ambiguous", note: "2 leads match this sheet row" });
    expect([...m.byLead.values()].some((v) => v.kind === "entry")).toBe(false);
    expect(m.ambiguousLeads).toBe(2);
    expect(m.withoutLead).toEqual([]);
  });

  it("reports a lead that matches two sheet rows (same owner and mark, two codes)", () => {
    const a = entry({ owner: "Amara Nwosu", code: "3", row: 2 });
    const b = entry({ owner: "Amara Nwosu", code: "4", row: 3 });
    const m = matchSheetToLeads([a, b], [{ id: "L1", sheetKey: key("Amara Nwosu", null, "1") }]);
    expect(m.byLead.get("L1")).toMatchObject({ kind: "ambiguous", note: "2 sheet rows match this lead" });
    // An exact key beats the looser match.
    const exact = matchSheetToLeads([a, b], [{ id: "L1", sheetKey: key("Amara Nwosu", null, "3") }]);
    expect(exact.byLead.get("L1")).toEqual({ kind: "entry", entry: a });
  });

  it("turns a match into the sheet source's signal", () => {
    expect(sheetSignalFor(undefined)).toEqual({ kind: "none" });
    expect(sheetSignalFor({ kind: "ambiguous", note: "x" })).toEqual({ kind: "none", note: "x" });
    expect(sheetSignalFor({ kind: "entry", entry: entry({ owner: "A" }) })).toMatchObject({ kind: "stage", stageId: S.consult });
    expect(sheetSignalFor({ kind: "entry", entry: entry({ owner: "A", kind: "client" }) })).toEqual({ kind: "needs_matter", wording: "7. Signed" });
    expect(sheetSignalFor({ kind: "entry", entry: entry({ owner: "A", kind: "unmapped" }) })).toEqual({ kind: "unmapped", wording: "9. ???" });
  });

  it("matches the real fixture: a lead stored at code 1 finds Amara, and Ines (a client) turns into needs_matter", () => {
    const r = readSheetText(fixtureText(), STAGES.map((s) => ({ id: s.id, name: s.name })), NOW);
    if (!r.ok) throw new Error(r.error);
    const m = matchSheetToLeads(r.read.entries, [
      { id: "amara", sheetKey: key("Amara Nwosu", null, "1") },
      { id: "ines", sheetKey: key("Ines Marchetti", "Verdi Loop", "5") },
    ]);
    expect(sheetSignalFor(m.byLead.get("amara"))).toMatchObject({ kind: "stage", stageId: S.pnc });
    expect(sheetSignalFor(m.byLead.get("ines"))).toMatchObject({ kind: "needs_matter" });
  });
});

const rec = (over: Partial<LawmaticsSourceRecord>): LawmaticsSourceRecord => ({
  lawmaticsId: "100",
  matterName: null,
  firstName: null,
  lastName: null,
  email: null,
  phone: null,
  businessName: null,
  website: null,
  stageName: "Consultation Scheduled",
  practiceArea: null,
  createdAt: null,
  updatedAt: null,
  contactId: null,
  referralSource: null,
  ...over,
});

describe("matching a lead to a Lawmatics record", () => {
  const index = indexLawmatics([
    rec({ lawmaticsId: "100", email: "a@x.com" }),
    rec({ lawmaticsId: "200", email: "shared@x.com" }),
    rec({ lawmaticsId: "201", email: "Shared@x.com" }),
    rec({ lawmaticsId: "300", email: "dummy@intake.invalid" }),
  ]);

  it("prefers the stored Lawmatics id", () => {
    const m = matchLawmatics({ lawmaticsId: "100", email: "other@x.com" }, index);
    expect(m).toMatchObject({ kind: "record", record: { lawmaticsId: "100" } });
  });

  it("falls back to one unambiguous email, any letter case", () => {
    expect(matchLawmatics({ lawmaticsId: null, email: "A@X.com" }, index)).toMatchObject({ kind: "record", record: { lawmaticsId: "100" } });
    expect(matchLawmatics({ lawmaticsId: "999", email: "a@x.com" }, index)).toMatchObject({ kind: "record" });
  });

  it("an ambiguous email is none, with a reason", () => {
    expect(matchLawmatics({ lawmaticsId: null, email: "shared@x.com" }, index)).toEqual({ kind: "none", note: "2 Lawmatics records share this email" });
  });

  it("a placeholder email never matches, on either side", () => {
    expect(matchLawmatics({ lawmaticsId: null, email: "dummy@intake.invalid" }, index)).toEqual({ kind: "none" });
    expect(matchLawmatics({ lawmaticsId: null, email: null }, index)).toEqual({ kind: "none" });
    expect(matchLawmatics({ lawmaticsId: null, email: "" }, index)).toEqual({ kind: "none" });
  });
});

describe("the Lawmatics source signal", () => {
  const lead = { lawmaticsId: "100", email: null };
  const sig = (stageName: string | null) => lawmaticsSignalFor(lead, indexLawmatics([rec({ stageName })]), STAGES);

  it("resolves a stage by name", () => {
    expect(sig("Consultation Scheduled")).toMatchObject({ kind: "stage", stageId: S.consult, wording: "Consultation Scheduled" });
    expect(sig("Discovery Call Scheduled")).toMatchObject({ kind: "stage", stageId: S.consult });
  });
  it.each(["Hired", "Hired Client", "hired client", "HIRED-CLIENT", "3. Hired"])('"%s" is a client', (name) => {
    expect(sig(name)).toEqual({ kind: "needs_matter", wording: name });
    expect(isHiredStage(name)).toBe(true);
  });
  it("another unmapped name is shown by its own wording and does not vote", () => {
    expect(sig("Discovery Call No Show")).toEqual({ kind: "unmapped", wording: "Discovery Call No Show" });
    expect(isHiredStage("Hired Hands")).toBe(false);
  });
  it("a record with no stage is none, with a reason", () => {
    expect(sig(null)).toEqual({ kind: "none", note: "the Lawmatics record has no stage" });
    expect(sig("  ")).toEqual({ kind: "none", note: "the Lawmatics record has no stage" });
  });
  it("no record is none", () => {
    expect(lawmaticsSignalFor({ lawmaticsId: "nope", email: null }, indexLawmatics([rec({})]), STAGES)).toEqual({ kind: "none", note: undefined });
  });
});

describe("the email source signal", () => {
  const mail = (type: string, at: string, sensitive = false) => ({ type, sensitive, at });

  it("has an entry only for the types that name a pipeline position", () => {
    expect(Object.keys(EMAIL_STAGE_TABLE).sort()).toEqual(["discovery-call", "loe-invoice", "post-consult", "strategy-session-link"]);
  });

  it.each([
    ["strategy-session-link", S.pnc],
    ["discovery-call", S.consult],
    ["post-consult", S.post],
    ["loe-invoice", S.loe],
  ])("%s maps to its stage", (type, stage) => {
    expect(emailSignalFor([mail(type, "2026-09-01T10:00:00Z")], STAGES)).toMatchObject({ kind: "stage", stageId: stage });
  });

  it("the newest mapped email decides", () => {
    const s = emailSignalFor([mail("loe-invoice", "2026-09-05T10:00:00Z"), mail("discovery-call", "2026-09-01T10:00:00Z"), mail("post-consult", "2026-09-03T10:00:00Z")], STAGES);
    expect(s).toMatchObject({ kind: "stage", stageId: S.loe, date: "2026-09-05T10:00:00Z" });
  });

  it("a sensitive thread, a type with no table entry and no mail at all give no vote", () => {
    expect(emailSignalFor([mail("loe-invoice", "2026-09-05T10:00:00Z", true)], STAGES)).toMatchObject({ kind: "none" });
    expect(emailSignalFor([mail("follow-up", "2026-09-05T10:00:00Z"), mail("other", "2026-09-06T10:00:00Z")], STAGES)).toEqual({ kind: "none", note: "mail found, but none of it names a stage" });
    expect(emailSignalFor([], STAGES)).toEqual({ kind: "none", note: undefined });
  });

  it("a newer unmapped type does not hide an older mapped one, but a sensitive newer one is skipped too", () => {
    const s = emailSignalFor([mail("follow-up", "2026-09-09T10:00:00Z"), mail("loe-invoice", "2026-09-08T10:00:00Z", true), mail("discovery-call", "2026-09-01T10:00:00Z")], STAGES);
    expect(s).toMatchObject({ kind: "stage", stageId: S.consult });
  });

  it("a stage name the firm lacks is unmapped, never a guess", () => {
    const withoutPost = STAGES.filter((s) => s.id !== S.post);
    expect(emailSignalFor([mail("post-consult", "2026-09-01T10:00:00Z")], withoutPost)).toEqual({ kind: "unmapped", wording: "Post-consultation email" });
  });
});
