import { describe, it, expect } from "vitest";

import {
  HIRED_SYNC_CUTOFF,
  MAX_CREATES_PER_RUN,
  SKIP,
  matterTypeFor,
  normalizeOwner,
  normalizeTitle,
  ownersMatch,
  planHiredSync,
  type HiredProspect,
  type PlanLead,
  type PlanMatter,
} from "@/lib/lawmatics/hired-sync-plan";

const P = (o: Partial<HiredProspect> = {}): HiredProspect => ({
  lawmaticsId: "100",
  name: "Ada Lovelace",
  email: "ada@example.com",
  status: "Hired",
  convertedDate: "2026-11-02",
  caseNumber: "77",
  caseTitle: "ENGINE",
  trademarkName: null,
  practiceAreaField: null,
  practiceAreaName: "Trademark Law",
  ...o,
});
const M = (o: Partial<PlanMatter> = {}): PlanMatter => ({
  id: "m1",
  owner_name: "Ada Lovelace",
  title: "ENGINE",
  mark_text: null,
  matter_number: "TM-X",
  lawmatics_id: null,
  ...o,
});
const STAGES = [{ id: "st1", label: "Signed LOE / Deposit Received" }, { id: "st2", label: "Other" }];
const plan = (prospects: HiredProspect[], matters: PlanMatter[] = [], leads: PlanLead[] = [], stages = STAGES) =>
  planHiredSync({ prospects, matters, leads, stages });

describe("cutoff and status", () => {
  it("cutoff is today's reconciliation date", () => expect(HIRED_SYNC_CUTOFF).toBe("2026-10-28"));
  it("ignores records dated before the cutoff", () => {
    const r = plan([P({ convertedDate: "2026-10-27" })]);
    expect(r).toEqual({ create: [], link: [], skipped: [] });
  });
  it("includes a record dated exactly on the cutoff", () => {
    expect(plan([P({ convertedDate: "2026-10-28" })]).create).toHaveLength(1);
  });
  it("ignores non-hired and accepts any case of hired", () => {
    expect(plan([P({ status: "Open" })]).create).toHaveLength(0);
    expect(plan([P({ status: " HIRED " })]).create).toHaveLength(1);
  });
  it("skips a hired record with no converted date", () => {
    const r = plan([P({ convertedDate: null })]);
    expect(r.create).toHaveLength(0);
    expect(r.skipped).toEqual([{ lawmaticsId: "100", reason: SKIP.noDate }]);
  });
});

describe("matching existing matters", () => {
  it("skips when the Lawmatics id is already on a matter", () => {
    const r = plan([P()], [M({ lawmatics_id: "100", title: "something else" })]);
    expect(r.skipped).toEqual([{ lawmaticsId: "100", reason: SKIP.linked }]);
    expect(r.create).toHaveLength(0);
  });
  it("links an unlinked matter with the same owner and title", () => {
    const r = plan([P()], [M()]);
    expect(r.link).toEqual([{ lawmaticsId: "100", matterId: "m1" }]);
    expect(r.create).toHaveLength(0);
  });
  it("normalizes decoration: (word mark), 'logo mark -', punctuation", () => {
    expect(normalizeTitle("Word Mark - Engine (Design Mark)")).toBe("engine");
    expect(plan([P({ caseTitle: "E.N.G.I.N.E (word mark)" })], [M({ title: "Logo Mark - engine" })]).link).toHaveLength(1);
  });
  it("matches the title against mark_text too", () => {
    expect(plan([P()], [M({ title: "Ada Lovelace TM", mark_text: "ENGINE" })]).link).toHaveLength(1);
  });
  it("ambiguous: two unlinked matches skip", () => {
    const r = plan([P()], [M(), M({ id: "m2", matter_number: "TM-Y" })]);
    expect(r.skipped).toEqual([{ lawmaticsId: "100", reason: SKIP.ambiguous }]);
    expect(r.link).toHaveLength(0);
  });
  it("same owner, different title is a NEW matter", () => {
    const r = plan([P({ caseTitle: "LOOM" })], [M()]);
    expect(r.create).toHaveLength(1);
    expect(r.link).toHaveLength(0);
  });
  it("owner loosely: first+last tokens equal, or containment", () => {
    expect(ownersMatch(normalizeOwner("Vivian Olodun Anderson"), normalizeOwner("Vivian Anderson"))).toBe(true);
    expect(ownersMatch(normalizeOwner("Eli Chazin (Eli Levi)"), normalizeOwner("Eli Chazin"))).toBe(true);
    expect(ownersMatch(normalizeOwner("Ada Lovelace"), normalizeOwner("Ada Byron"))).toBe(false);
    expect(plan([P({ name: "Vivian Olodun Anderson" })], [M({ owner_name: "Vivian Anderson" })]).link).toHaveLength(1);
  });
  it("titles loosely: one contains the other", () => {
    expect(plan([P({ caseTitle: "ENGINE WORKS" })], [M({ title: "ENGINE" })]).link).toHaveLength(1);
    expect(plan([P({ caseTitle: "ENGINE" })], [M({ title: "THE ENGINE CO" })]).link).toHaveLength(1);
  });
  it("owner+title match on a matter with a DIFFERENT Lawmatics id never creates", () => {
    const r = plan([P()], [M({ lawmatics_id: "999" })]);
    expect(r.skipped).toEqual([{ lawmaticsId: "100", reason: SKIP.anotherRecord }]);
    expect(r.create).toHaveLength(0);
    expect(r.link).toHaveLength(0);
  });
  it("no usable title and the owner has any matter: needs a look, no create", () => {
    const r = plan([P({ caseTitle: null, trademarkName: null })], [M({ title: "UNRELATED", lawmatics_id: "5" })]);
    expect(r.skipped).toEqual([{ lawmaticsId: "100", reason: SKIP.needsLook }]);
    expect(r.create).toHaveLength(0);
  });
  it("no usable title and a new owner is created from the practice area", () => {
    const r = plan([P({ caseTitle: null })]);
    expect(r.create[0].title).toBe("Trademark Law");
    expect(r.create[0].mark_text).toBeNull();
  });
  it("two records for one matter: the second does not steal it", () => {
    const r = plan([P(), P({ lawmaticsId: "101" })], [M()]);
    expect(r.link).toHaveLength(1);
    expect(r.skipped).toEqual([{ lawmaticsId: "101", reason: SKIP.anotherRecord }]);
  });
});

describe("type mapping", () => {
  const t = (practiceAreaName: string | null, extra: Partial<HiredProspect> = {}) =>
    matterTypeFor({ practiceAreaName, practiceAreaField: null, trademarkName: null, ...extra });
  it.each([
    ["Trademark Law", "TM"],
    ["Copyright Law", "CR"],
    ["Patent Law", "PATENT"],
    ["Litigation Services", "LIT"],
    ["Contracts", "BL"],
    ["General Counsel Services", "BL"],
    ["Business Law", "BL"],
    ["Other", "BL"],
  ])("%s -> %s", (name, type) => expect(t(name)).toBe(type));
  it("no practice area: custom field Trademark, or a trademark name, is TM; else BL", () => {
    expect(t(null, { practiceAreaField: "Trademark" })).toBe("TM");
    expect(t(null, { trademarkName: "ACME" })).toBe("TM");
    expect(t(null)).toBe("BL");
  });
});

describe("created fields", () => {
  it("fills every field for a trademark", () => {
    const c = plan([P({ caseTitle: null, trademarkName: "  ACME  " })]).create[0];
    expect(c).toMatchObject({
      type: "TM",
      title: "ACME",
      mark_text: "ACME",
      owner_name: "Ada Lovelace",
      matter_number: "TM-ada-lovelace-acme",
      stage_id: "st1",
      lead_id: null,
      notes: "Added from Lawmatics (case #77, hired 2026-11-02).",
    });
  });
  it("title falls back to the practice area, then the case number", () => {
    expect(plan([P({ caseTitle: null, practiceAreaName: "Contracts" })]).create[0].title).toBe("Contracts");
    expect(plan([P({ caseTitle: null, practiceAreaName: null })]).create[0].title).toBe("Lawmatics matter #77");
  });
  it("caps title at 200 and mark at 512", () => {
    const c = plan([P({ caseTitle: "x".repeat(300) })]).create[0];
    expect(c.title).toHaveLength(200);
    expect(c.mark_text!.length).toBeLessThanOrEqual(512);
  });
  it("non-TM has no mark and no stage", () => {
    const c = plan([P({ practiceAreaName: "Business Law" })]).create[0];
    expect(c).toMatchObject({ type: "BL", mark_text: null, stage_id: null });
  });
  it("TM stage is null when the firm lacks the stage", () => {
    expect(plan([P()], [], [], [{ id: "x", label: "Signed LOE" }]).create[0].stage_id).toBeNull();
  });
  it("matter_number collision with an existing number appends the case number", () => {
    const c = plan([P({ caseTitle: "NEWMARK" })], [M({ matter_number: "TM-ada-lovelace-newmark", title: "OLD" })]).create[0];
    expect(c.matter_number).toBe("TM-ada-lovelace-newmark-77");
  });
  it("collision with an already-planned number appends the case number", () => {
    const r = plan([P({ lawmaticsId: "1", caseNumber: "1" }), P({ lawmaticsId: "2", caseNumber: "2" })]);
    expect(r.create.map((c) => c.matter_number)).toEqual(["TM-ada-lovelace-engine", "TM-ada-lovelace-engine-2"]);
  });
});

describe("lead link", () => {
  it("by lawmatics_id first", () => {
    const leads = [{ id: "l1", email: "other@x.com", lawmatics_id: "100" }, { id: "l2", email: "ada@example.com", lawmatics_id: null }];
    expect(plan([P()], [], leads).create[0].lead_id).toBe("l1");
  });
  it("by a unique email, case-insensitive", () => {
    expect(plan([P({ email: "ADA@Example.com" })], [], [{ id: "l2", email: "ada@example.com", lawmatics_id: null }]).create[0].lead_id).toBe("l2");
  });
  it("ambiguous email gives null", () => {
    const leads = [{ id: "a", email: "ada@example.com", lawmatics_id: null }, { id: "b", email: "ada@example.com", lawmatics_id: null }];
    expect(plan([P()], [], leads).create[0].lead_id).toBeNull();
  });
});

describe("cap", () => {
  it("creates at most 50 and skips the rest with a reason", () => {
    const many = Array.from({ length: 53 }, (_, i) => P({ lawmaticsId: `id${i}`, name: `Person${i} Name${i}`, caseTitle: `Mark${i}`, email: null }));
    const r = plan(many);
    expect(r.create).toHaveLength(MAX_CREATES_PER_RUN);
    expect(r.skipped).toHaveLength(3);
    expect(r.skipped.every((s) => s.reason === SKIP.overLimit)).toBe(true);
  });
});
