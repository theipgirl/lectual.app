import { describe, expect, it, vi } from "vitest";
import { sheetKeyFor } from "../../src/lib/intake/sheet-import";
import { readSheetRecords, parseSheetRecords } from "../../src/lib/intake/sheet-read";
import type { LawmaticsSourceRecord } from "../../src/lib/lawmatics/normalize";
import { buildPlan, intakeStageIdSet, tableLeads, type EmailInput, type LawmaticsInput } from "../../src/lib/reconcile/plan";
import { planFingerprint } from "../../src/lib/reconcile/fingerprint";
import type { LeadRow } from "../../src/lib/reconcile/types";
import { NOW, S, STAGES, fixtureText } from "./helpers";
import { L } from "./world";

const key = (owner: string, mark: string | null, code: string) => sheetKeyFor({ ownerName: owner, markText: mark, stageCode: code });

const lead = (id: string, first: string, last: string, over: Partial<LeadRow> = {}): LeadRow => ({
  id,
  firstName: first,
  lastName: last,
  email: `${first.toLowerCase()}@example.com`,
  currentStageId: S.pnc,
  sheetKey: null,
  lawmaticsId: null,
  practiceArea: null,
  ...over,
});

const sheet = () => {
  const parsed = parseSheetRecords(fixtureText());
  if (!parsed.ok) throw new Error(parsed.error);
  return readSheetRecords(parsed.records, STAGES.map((s) => ({ id: s.id, name: s.name })), NOW);
};

const lm = (over: Partial<LawmaticsSourceRecord>): LawmaticsSourceRecord => ({
  lawmaticsId: "1", matterName: null, firstName: null, lastName: null, email: null, phone: null, businessName: null, website: null,
  stageName: "Consultation Scheduled", practiceArea: null, createdAt: null, updatedAt: null, contactId: null, referralSource: null, ...over,
});

const okMail = (byLead: Record<string, Array<{ type: string; at: string; sensitive?: boolean }>> = {}): EmailInput => ({
  status: "ok",
  byLead: new Map(Object.entries(byLead).map(([id, rows]) => [id, rows.map((r) => ({ type: r.type, at: r.at, sensitive: r.sensitive ?? false }))])),
  total: Object.values(byLead).flat().length,
});

const LEADS: LeadRow[] = [
  lead(L.amara, "Amara", "Nwosu", { sheetKey: key("Amara Nwosu", null, "1"), currentStageId: S.followUp }),
  lead(L.priya, "Priya", "Raman", { sheetKey: key("Priya Raman", "Saffron Lane", "2"), currentStageId: S.prelim }), // already there
  lead(L.margo, "Margo", "Delacroix", { sheetKey: key("Marguerite (Margo) Delacroix", "Château Bellerive", "3"), currentStageId: S.pnc, lawmaticsId: "200" }),
  lead(L.hollis, "Hollis", "Vance", { sheetKey: key("Hollis Vance", "Nine Lantern", "6"), currentStageId: S.pnc, email: "hollis@example.com" }),
  lead(L.ines, "Ines", "Marchetti", { sheetKey: key("Ines Marchetti", "Verdi Loop", "5"), currentStageId: S.signed }), // a client, wherever it sits
  lead(L.desmond, "Desmond", "Okafor", { currentStageId: S.consult }), // no sheet_key
  lead(L.lena, "Lena", "Fitzgerald", { currentStageId: S.signed }), // won stage, no sheet match: off the table
  lead(L.kwame, "Kwame", "Boateng", { currentStageId: S.pnc, practiceArea: "Patent" }), // not trademark: off the table
];

async function run(over: Partial<Parameters<typeof buildPlan>[0]> = {}) {
  return buildPlan({
    fileName: "intake.csv",
    stages: STAGES,
    leads: LEADS,
    leadsTruncated: false,
    sheet: sheet(),
    lawmatics: { status: "ok", records: [lm({ lawmaticsId: "200", stageName: "Consultation Scheduled" }), lm({ lawmaticsId: "300", email: "hollis@example.com", stageName: "Hired Client" })] },
    readEmail: async () => okMail({ [L.amara]: [{ type: "strategy-session-link", at: "2026-09-11T10:00:00Z" }] }),
    ...over,
  });
}

describe("which leads are on the table", () => {
  it("is intake scope plus any lead the sheet matched", async () => {
    const { view } = await run();
    expect(view.rows.map((r) => r.leadId).sort()).toEqual([L.amara, L.priya, L.margo, L.hollis, L.ines, L.desmond].sort());
  });

  it("intake scope is stages before the first won stage, open or nurture only", () => {
    expect([...intakeStageIdSet(STAGES)].sort()).toEqual([S.followUp, S.pnc, S.prelim, S.consult, S.post, S.undecided, S.loe].sort());
    expect(intakeStageIdSet(STAGES.filter((s) => s.category !== "won")).has(S.lost)).toBe(false);
    expect(tableLeads(STAGES, LEADS, new Set([L.lena])).map((l) => l.id)).toContain(L.lena);
  });
});

describe("buildPlan: the rows", () => {
  it("proposes the sheet's stage with the right confidence per lead", async () => {
    const { view } = await run();
    const by = Object.fromEntries(view.rows.map((r) => [r.leadId, r]));
    expect(by[L.amara].proposal).toMatchObject({ kind: "stage", stage: { id: S.pnc }, confidence: "agree", evidenceDate: "2026-09-14T00:00:00.000Z" });
    expect(by[L.priya].proposal).toMatchObject({ kind: "no_proposal" });
    expect(by[L.priya].proposal.reasons[0]).toBe("Already in this stage.");
    expect(by[L.margo].proposal).toMatchObject({ kind: "stage", stage: { id: S.consult }, confidence: "agree" });
    expect(by[L.hollis].proposal).toMatchObject({ kind: "needs_matter", stage: null, confidence: null });
    expect(by[L.ines].proposal.kind).toBe("needs_matter");
    expect(by[L.desmond].proposal).toMatchObject({ kind: "no_proposal", confidence: "no_evidence" });
  });

  it("puts the actionable rows first", async () => {
    const { view } = await run();
    expect(view.rows[0].proposal.kind).toBe("stage");
    expect(view.rows[view.rows.length - 1].proposal.confidence).toBe("no_evidence");
  });

  it("the plan is one entry per row, in the shown order, with its fingerprint stable under reordering", async () => {
    const { view, plan } = await run();
    expect(plan.map((p) => p.leadId)).toEqual(view.rows.map((r) => r.leadId));
    expect(plan.find((p) => p.leadId === L.amara)).toEqual({
      leadId: L.amara, fromStageId: S.followUp, proposedStageId: S.pnc, evidenceDate: "2026-09-14T00:00:00.000Z", confidence: "agree",
    });
    expect(planFingerprint([...plan].reverse())).toBe(planFingerprint(plan));
  });

  it("the pickable stages are the firm's own, with none that opens a matter", async () => {
    const { view } = await run();
    expect(view.pickable.map((s) => s.name)).toEqual(STAGES.filter((s) => s.category !== "won").map((s) => s.name));
  });
});

describe("buildPlan: the summary", () => {
  it("counts confidences and lists what was left out", async () => {
    const { view } = await run();
    const s = view.summary;
    expect(s.confidence).toEqual({ agree: 2, sheet_only: 1, conflict: 0, no_evidence: 1 });
    expect(s.confidence.agree + s.confidence.sheet_only + s.confidence.conflict + s.confidence.no_evidence + s.needsMatter).toBe(view.rows.length);
    expect(s.needsMatter).toBe(2);
    expect(s.alreadyThere).toBe(1);
    expect(s.sheet).toEqual({ rowsRead: 12, intakeRows: 7, blankRows: 1 });
    expect(s.sheetRowsWithoutLead.map((r) => r.owner).sort()).toEqual(["Desmond Okafor", "Kwame Boateng", "Lena Fitzgerald"]);
    expect(s.sheetRowsWithoutLead[0]).toMatchObject({ row: expect.any(Number), status: expect.any(String) });
    expect(s.refused.map((r) => r.row)).toEqual([9, 10, 12]);
    expect(s.leadsTruncated).toBe(false);
    expect(s.fileName).toBe("intake.csv");
  });

  it("never creates anything for a sheet row with no lead", async () => {
    const { view } = await run();
    expect(view.rows.every((r) => LEADS.some((l) => l.id === r.leadId))).toBe(true);
  });

  it("passes the truncated flag through", async () => {
    expect((await run({ leadsTruncated: true })).view.summary.leadsTruncated).toBe(true);
  });

  it("reports a lead that two sheet rows or two leads claim", async () => {
    const dup = [...LEADS, lead("55555555-0000-4000-8000-000000000001", "Amara", "Twin", { sheetKey: key("Amara Nwosu", null, "1") })];
    const { view } = await run({ leads: dup });
    expect(view.summary.ambiguousLeads).toBe(2);
    const amara = view.rows.find((r) => r.leadId === L.amara)!;
    expect(amara.sheet).toEqual({ kind: "none", note: "2 leads share this sheet key" });
    expect(amara.proposal.confidence).toBe("no_evidence");
  });
});

describe("buildPlan: a source that cannot be read", () => {
  it.each([
    ["not-connected", { status: "not-connected", reason: "Lawmatics isn't connected for your firm." }],
    ["unavailable", { status: "unavailable", reason: "Lawmatics returned only part of the firm's records." }],
  ] as Array<[string, LawmaticsInput]>)("Lawmatics %s is unavailable on every row, never none", async (_name, lawmatics) => {
    const { view } = await run({ lawmatics });
    for (const row of view.rows) expect(row.lawmatics).toEqual({ kind: "unavailable", reason: (lawmatics as { reason: string }).reason });
    expect(view.summary.lawmatics).toEqual({ status: (lawmatics as { status: "not-connected" | "unavailable" }).status, reason: (lawmatics as { reason: string }).reason });
    const amara = view.rows.find((r) => r.leadId === L.amara)!;
    expect(amara.proposal.unavailable).toEqual(["lawmatics"]);
    expect(amara.proposal.kind).toBe("stage");
  });

  it("a failed mail read hides only the email column", async () => {
    const { view } = await run({ readEmail: async () => ({ status: "unavailable", reason: "The synced mail could not be read." }) });
    for (const row of view.rows) expect(row.email.kind).toBe("unavailable");
    const margo = view.rows.find((r) => r.leadId === L.margo)!;
    expect(margo.lawmatics.kind).toBe("stage");
    expect(margo.sheet.kind).toBe("stage");
    expect(view.summary.email).toEqual({ status: "unavailable", reason: "The synced mail could not be read." });
  });

  it("no synced mail at all is 'None' with a note that nothing failed", async () => {
    const { view } = await run({ readEmail: async () => okMail() });
    expect(view.rows.every((r) => r.email.kind === "none")).toBe(true);
    expect(view.summary.email).toMatchObject({ status: "ok", leadsWithMail: 0 });
    expect((view.summary.email as { note: string }).note).toMatch(/Nothing failed/);
  });

  it("reads mail only for the leads on the table", async () => {
    const readEmail = vi.fn(async () => okMail());
    await run({ readEmail });
    const ids = (readEmail.mock.calls[0] as unknown as [string[]])[0];
    expect(ids).toHaveLength(6);
    expect(ids).not.toContain(L.lena);
  });
});

describe("buildPlan: an empty table", () => {
  it("has no rows, no mail read, and says nothing was matched", async () => {
    const readEmail = vi.fn(async () => okMail());
    const { view, plan } = await run({ leads: [], readEmail });
    expect(view.rows).toEqual([]);
    expect(plan).toEqual([]);
    expect(readEmail).not.toHaveBeenCalled();
    expect(view.summary.sheetRowsWithoutLead).toHaveLength(7);
  });
});
