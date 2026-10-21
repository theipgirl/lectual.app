import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planFingerprint } from "../../src/lib/reconcile/fingerprint";
import { SHEET_MESSAGES } from "../../src/lib/intake/sheet-read";
import { RECONCILE_MESSAGES as MSG } from "../../src/lib/reconcile/rules";
import { SECRET, S } from "./helpers";
import { L, lawmaticsStub, makeWorld } from "./world";
import { csvFile, fakeUpload, fixtureLeads, formWith, loadActions } from "./actions-helpers";
import { prospectsPayload } from "../__fixtures__/lawmatics.fixture";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");
const ALLOWED = ["owner", "admin", "senior_admin"] as const;
const REFUSED = ["intake", "paralegal", "law_clerk", "attorney", "clerk", "viewer", "social_media"] as const;

const world = (over: Parameters<typeof makeWorld>[0] = {}) => makeWorld({ leads: fixtureLeads(), ...over });

describe("previewReconcileAction: who may preview", () => {
  it.each(ALLOWED)("%s gets a preview", async (role) => {
    const w = world({ role });
    const { previewReconcileAction } = await loadActions(w);
    const r = await previewReconcileAction(formWith(csvFile()));
    expect(r.ok).toBe(true);
  });

  it.each(REFUSED)("refuses %s with a sentence and reads nothing", async (role) => {
    const w = world({ role });
    const upload = fakeUpload("sheet.csv", 100, "0,Status\nA,1\n");
    const { previewReconcileAction, clientFactory } = await loadActions(w);
    const r = await previewReconcileAction(formWith(upload));
    expect(r).toEqual({ ok: false, error: MSG.notAllowed });
    expect(w.db.froms).toEqual([]);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(upload.read).not.toHaveBeenCalled();
    expect(w.db.writes).toEqual([]);
  });

  it("fails closed when the role cannot be resolved, and with no session", async () => {
    for (const opts of [{ role: null }, { client: { roleError: true } }, { client: { signedIn: false } }] as const) {
      const w = world(opts);
      const { previewReconcileAction, clientFactory } = await loadActions(w);
      const r = await previewReconcileAction(formWith(csvFile()));
      expect(r.ok).toBe(false);
      expect(w.db.froms).toEqual([]);
      expect(clientFactory).not.toHaveBeenCalled();
      expect(JSON.stringify(r)).not.toContain("SECRET");
    }
  });

  it("re-resolves the role on every call", async () => {
    const w = world({ role: "admin" });
    const { previewReconcileAction } = await loadActions(w);
    expect((await previewReconcileAction(formWith(csvFile()))).ok).toBe(true);
    w.db.role = "viewer";
    expect((await previewReconcileAction(formWith(csvFile()))).ok).toBe(false);
    w.db.role = "owner";
    expect((await previewReconcileAction(formWith(csvFile()))).ok).toBe(true);
    expect(w.db.rpcCalls.filter((n) => n === "current_org_role")).toHaveLength(3);
  });
});

describe("previewReconcileAction: a file that cannot be used reads no source", () => {
  const cases: Array<[string, () => unknown, string]> = [
    ["no file", () => undefined, SHEET_MESSAGES.noFile],
    ["an .xlsx workbook", () => csvFile("sheet.xlsx"), SHEET_MESSAGES.excel],
    ["an .xls workbook", () => csvFile("sheet.xls"), SHEET_MESSAGES.excel],
    ["a PDF", () => csvFile("sheet.pdf"), SHEET_MESSAGES.notCsv],
    ["a file with no extension", () => csvFile("sheet"), SHEET_MESSAGES.notCsv],
    ["an empty file", () => csvFile("sheet.csv", ""), SHEET_MESSAGES.empty],
    ["a file over 5 MB", () => fakeUpload("sheet.csv", 5 * 1024 * 1024 + 1, "x"), SHEET_MESSAGES.tooBig],
    ["a CSV with no Status column", () => csvFile("sheet.csv", "0,Mark\nAmara,Iron Fig\n"), SHEET_MESSAGES.noStatus],
    ["a CSV with an unclosed quote", () => csvFile("sheet.csv", '0,Status\n"Amara,1'), SHEET_MESSAGES.unterminated],
    ["a CSV with a Status column and no rows", () => csvFile("sheet.csv", "0,Status\n,\n"), SHEET_MESSAGES.noRows],
  ];
  it.each(cases)("%s", async (_label, make, sentence) => {
    const w = world();
    const { previewReconcileAction, clientFactory } = await loadActions(w);
    const r = await previewReconcileAction(formWith(make()));
    expect(r).toEqual({ ok: false, error: sentence });
    expect(w.db.froms).toEqual([]);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("each of those refusals is a different sentence", () => {
    const unique = new Set(cases.map((c) => c[2]));
    // .xlsx and .xls share the Excel sentence; a PDF and an extensionless name share the not-CSV one.
    expect(unique.size).toBe(cases.length - 2);
  });
});

describe("previewReconcileAction: the preview", () => {
  it("returns the table, the plan and the plan's fingerprint", async () => {
    const w = world();
    const { previewReconcileAction } = await loadActions(w, {
      lawmatics: lawmaticsStub({ prospects: () => prospectsPayload([{ id: "200", matterName: "M", firstName: "Margo", stage: "Consultation Scheduled", email: "margo@example.com" }]) }),
    });
    const r = await previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    expect(r.fingerprint).toBe(planFingerprint(r.plan));
    expect(r.plan.map((p) => p.leadId)).toEqual(r.view.rows.map((row) => row.leadId));
    const by = Object.fromEntries(r.view.rows.map((row) => [row.leadId, row]));
    expect(by[L.amara].proposal).toMatchObject({ kind: "stage", stage: { id: S.pnc }, confidence: "sheet_only" });
    expect(by[L.margo].proposal).toMatchObject({ kind: "stage", stage: { id: S.consult }, confidence: "agree" });
    expect(by[L.priya].proposal.reasons[0]).toBe("Already in this stage.");
    expect(r.view.summary.fileName).toBe("sheet.csv");
    expect(r.view.summary.lawmatics).toMatchObject({ status: "ok" });
  });

  it("writes nothing: no insert, update or delete, and Lawmatics sees only reads", async () => {
    const w = world();
    const stub = lawmaticsStub();
    const { previewReconcileAction, move } = await loadActions(w, { lawmatics: stub });
    expect((await previewReconcileAction(formWith(csvFile()))).ok).toBe(true);
    expect(w.db.writes).toEqual([]);
    expect(move).not.toHaveBeenCalled();
    expect(stub.calls.length).toBeGreaterThan(0);
    expect(stub.calls.every((c) => c.method === "listAll" || c.method === "get")).toBe(true);
    expect(Object.keys(stub.client).sort()).toEqual(["get", "listAll"]);
  });

  it("a file with no matching leads still previews, with no rows", async () => {
    const w = world({ leads: [] });
    const { previewReconcileAction } = await loadActions(w);
    const r = await previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    expect(r.view.rows).toEqual([]);
    expect(r.plan).toEqual([]);
    expect(r.view.summary.sheetRowsWithoutLead.length).toBe(7);
  });
});

describe("previewReconcileAction: one failing source never blocks the others", () => {
  it("Lawmatics not connected: named, the sheet column still reads", async () => {
    const w = world();
    const { previewReconcileAction } = await loadActions(w, { lawmatics: "not-connected" });
    const r = await previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    expect(r.view.summary.lawmatics).toMatchObject({ status: "not-connected" });
    expect(r.view.rows.every((row) => row.lawmatics.kind === "unavailable")).toBe(true);
    expect(r.view.rows.find((row) => row.leadId === L.amara)!.sheet.kind).toBe("stage");
  });

  it("Lawmatics failing: unavailable, with nothing from the error", async () => {
    const w = world();
    const { previewReconcileAction } = await loadActions(w, { lawmatics: "throws" });
    const r = await previewReconcileAction(formWith(csvFile()));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
    if (r.ok) expect(r.view.summary.lawmatics.status).toBe("unavailable");
  });

  it("Lawmatics truncated: unavailable", async () => {
    const w = world();
    const { previewReconcileAction } = await loadActions(w, { lawmatics: lawmaticsStub({ truncated: true }) });
    const r = await previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    expect(r.view.summary.lawmatics.status).toBe("unavailable");
    expect(r.view.rows.every((row) => row.lawmatics.kind === "unavailable")).toBe(true);
  });

  it("a failed mail read: the email column is unavailable and the other two still render", async () => {
    const w = world();
    w.db.fail("crm_activity", "select", { code: "XX000", message: SECRET });
    const { previewReconcileAction } = await loadActions(w);
    const r = await previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    expect(r.view.rows.every((row) => row.email.kind === "unavailable")).toBe(true);
    expect(r.view.rows.some((row) => row.sheet.kind === "stage")).toBe(true);
    expect(r.view.rows.some((row) => row.lawmatics.kind !== "unavailable")).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });
});

describe("previewReconcileAction: a failed lead or stage read is an error, never an empty table", () => {
  it("leads", async () => {
    const w = world();
    w.db.fail("crm_lead", "select", { code: "XX000", message: SECRET });
    const { previewReconcileAction } = await loadActions(w);
    const r = await previewReconcileAction(formWith(csvFile()));
    expect(r).toEqual({ ok: false, error: MSG.leadsUnreadable });
    expect(MSG.leadsUnreadable).toMatch(/problem reaching the database/);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });

  it("stages", async () => {
    const w = world();
    w.db.fail("crm_stage", "select", { code: "XX000", message: SECRET });
    const { previewReconcileAction } = await loadActions(w);
    const r = await previewReconcileAction(formWith(csvFile()));
    expect(r).toEqual({ ok: false, error: MSG.stagesUnreadable });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});
