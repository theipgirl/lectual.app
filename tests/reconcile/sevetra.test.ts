import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN_OPTIONS, planImport, type PlanStage } from "../../src/lib/lawmatics/import-plan";
import type { LawmaticsSourceRecord } from "../../src/lib/lawmatics/normalize";
import { prospectsPayload } from "../__fixtures__/lawmatics.fixture";
import { key, csvFile, formWith, loadActions } from "./actions-helpers";
import { S } from "./helpers";
import { leadRow, lawmaticsStub, makeWorld, stageRows } from "./world";

/**
 * The "Sevetra-shaped" acceptance fixture (invented person, same shape as the case that started Sprint 26):
 * a Lawmatics prospect in "Proposal Sent" with the note "consult held, proposal sent"; a sheet row at status 1
 * whose log says the consult was done and the proposal sent on Oct 16; a sent mail "Your Trademark Proposal" on
 * Oct 16 and a follow-up on Oct 18. She has NOT accepted.
 *
 * Expected: imported (A); on Reconcile proposed at the proposal / follow-up stage with all three sources cited,
 * last touch Oct 18, and never proposed as accepted or hired.
 */

const LEAD = "22222222-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-22T20:00:00Z");

const sheetCsv = [
  "0,Trademark Owner,Trademark Name,Serial No.,Status,Description,Source,Notes,Priority,,Assigned To",
  // Dates end each log entry, as in the real sheet.
  "Sevetra Wrenfield,,Prosperall Goods,,1. Potential New Client,PNC scheduled consult for 10.12.26; consult done - proposal sent 10.16.26,Referral,,,,RL",
  "",
  "First Name,Last Name,Email Address,Phone Number,Practice Area,Trademark Name,Website/Instagram,Priority,Notes",
  "Sevetra,Wrenfield,sevetra@prosperall.example,,Trademark,Prosperall Goods,,,",
].join("\n");

const lm = () =>
  prospectsPayload([{ id: "700", matterName: "Prosperall Goods", firstName: "Sevetra", lastName: "Wrenfield", email: "sevetra@prosperall.example", stage: "Proposal Sent", practiceArea: "Trademark", updatedAt: "2026-10-16T18:00:00Z" }]);

const lmNote = () => ({
  type: "note",
  id: "n1",
  attributes: { body: "consult held, proposal sent", notable_id: "700", notable_type: "Prospect", created_at: "2026-10-16T16:00:00Z" },
});

const mailRow = (n: number, subject: string, type: string, at: string) => ({
  id: `act-${n}`,
  org_id: "aaaaaaaa-0000-4000-8000-000000000001",
  lead_id: LEAD,
  type: "email_sent",
  created_at: at,
  payload: { type, subject, at, direction: "outbound", message_id: `m${n}` },
});

const world = (over: Parameters<typeof makeWorld>[0] = {}) =>
  makeWorld({
    leads: [
      leadRow({
        id: LEAD,
        first_name: "Sevetra",
        last_name: "Wrenfield",
        email: "sheet+abc@intake.invalid",
        current_stage_id: S.pnc,
        sheet_key: key("Sevetra Wrenfield", "Prosperall Goods", "1"),
        lawmatics_id: "700",
        practice_area: "Trademark",
      }),
    ],
    activity: [mailRow(1, "Your Trademark Proposal", "other", "2026-10-16T15:00:00Z"), mailRow(2, "Following up on your proposal", "follow-up", "2026-10-18T09:00:00Z")],
    ...over,
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function preview(w = world(), opts: Parameters<typeof loadActions>[1] = {}) {
  const stub = lawmaticsStub({ prospects: lm, notes: (id) => (id === "700" ? [lmNote()] : []) });
  const loaded = await loadActions(w, { lawmatics: stub, ...opts });
  const r = await loaded.previewReconcileAction(formWith(csvFile("tracker.csv", sheetCsv)));
  if (!r.ok) throw new Error(r.error);
  return { r, row: r.view.rows.find((x) => x.leadId === LEAD)!, stub };
}

describe("imported (A)", () => {
  it('the Lawmatics prospect in "Proposal Sent" is created in the first open stage and flagged, not dropped', () => {
    const stages: PlanStage[] = [
      { id: "s1", name: "Potential New Client", category: "open", orderIndex: 1 },
      { id: "s7", name: "Signed LOE / Deposit Received", category: "won", orderIndex: 7 },
    ];
    const record: LawmaticsSourceRecord = {
      lawmaticsId: "700", matterName: "Prosperall Goods", firstName: "Sevetra", lastName: "Wrenfield", email: "sevetra@prosperall.example", phone: null,
      businessName: null, website: null, stageName: "Proposal Sent", practiceArea: "Trademark", createdAt: null, updatedAt: null, contactId: null, referralSource: null,
    };
    const plan = planImport([record], stages, [], DEFAULT_PLAN_OPTIONS);
    expect(plan.skipped).toEqual([]);
    expect(plan.creates[0]).toMatchObject({ stageId: "s1", stageDecision: { label: "Imported, stage needs a decision: Proposal Sent" } });
  });
});

describe("on Reconcile", () => {
  it("is proposed at the proposal stage, citing all three sources, with last touch Oct 18", async () => {
    const mailboxMessages = {
      received: [],
      sent: [
        { subject: "Your Trademark Proposal", sentDateTime: "2026-10-16T15:00:00Z", isDraft: false },
        { subject: "Following up on your proposal", sentDateTime: "2026-10-18T09:00:00Z", isDraft: false },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ value: url.includes("/mailFolders/sentitems/") ? mailboxMessages.sent : mailboxMessages.received }),
      })),
    );
    const { row } = await preview(world(), {
      mailbox: { moduleOn: true, items: [{ id: "m1", email: "firm@example.com", provider: "microsoft", scopes: null, accessToken: async () => "tok" }] },
    });

    expect(row.proposal.kind).toBe("stage");
    // RPB's stage list has no "Proposal Sent" stage: the proposal lands where the post-consultation email does.
    expect(row.proposal.stage?.id).toBe(S.post);
    expect(row.proposal.kind).not.toBe("needs_matter");

    const evidence = row.proposal.reasons.find((r) => r.startsWith("Evidence:"))!;
    expect(evidence).toContain("(sheet note)");
    expect(evidence).toContain("(Lawmatics note)");
    expect(evidence).toMatch(/\((email|mailbox search)\)/);
    expect(evidence).toContain("Proposal sent Oct 16");
    expect(evidence).toContain("Follow-up sent Oct 18");
    expect(evidence).toContain("Lawmatics stage");

    expect(row.lastTouch).toBe("2026-10-18T09:00:00.000Z");
    expect(row.mailbox).toMatchObject({ status: "ok", sent: 2 });
    expect(row.notes).toEqual({ status: "ok", count: 1 });
    expect(row.evidence?.some((e) => e.milestone === "accepted" || e.milestone === "hired" || e.milestone === "paid")).toBe(false);
  });

  it("with the firm's own Proposal Sent and Follow-Up Sent stages, lands on the follow-up stage", async () => {
    const own = [
      ...stageRows(),
      { id: "5100aaaa-0000-4000-8000-0000000000a1", org_id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Proposal Sent", category: "open", order_index: 4.5 },
      { id: "5100aaaa-0000-4000-8000-0000000000a2", org_id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Follow-Up Sent", category: "open", order_index: 4.6 },
    ];
    const { row } = await preview(world({ stages: own }));
    expect(row.proposal.stage?.name).toBe("Follow-Up Sent");
    expect(row.proposal.kind).toBe("stage");
  });

  it("still proposes (as the stored mail and notes allow) when the mailbox search is off, and says so", async () => {
    const { row } = await preview(world());
    expect(row.proposal.stage?.id).toBe(S.post);
    expect(row.mailbox).toMatchObject({ status: "unavailable", code: "module-off" });
    expect(row.lastTouch).toBe("2026-10-18T09:00:00.000Z");
  });

  it("the sheet's status alone would have said Potential New Client: that is the conflict, and the notes win", async () => {
    const { row } = await preview();
    expect(row.sheet).toMatchObject({ kind: "stage", stageId: S.pnc });
    expect(row.proposal.confidence).toBe("conflict");
  });
});
