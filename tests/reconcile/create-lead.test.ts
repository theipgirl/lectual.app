import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOUND_LABEL, parseCandidate } from "../../src/lib/reconcile/create-lead";
import { RECONCILE_MESSAGES as MSG } from "../../src/lib/reconcile/rules";
import type { CreateLeadCandidate } from "../../src/lib/reconcile/types";
import { writesTo } from "../matters/helpers/fake-db";
import { ORG, OTHER_ORG, S, SECRET, STAGES } from "./helpers";
import { L, leadRow, lawmaticsStub, makeWorld, type World } from "./world";
import { csvFile, formWith, key, loadActions } from "./actions-helpers";

/**
 * "Create lead" for a person under "Not in Lectual yet": the same admin-tier gate as the screen, scoped client only,
 * fixed sentences, nothing created without the click, and the new lead reconciles like any other.
 */

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const ALLOWED = ["owner", "admin", "senior_admin"] as const;
const REFUSED = ["intake", "paralegal", "law_clerk", "attorney", "clerk", "viewer", "social_media"] as const;

const sheetPerson: CreateLeadCandidate = {
  found: "sheet",
  firstName: "Ottoline",
  lastName: "Marchbanks",
  businessName: null,
  email: null,
  sheetKey: key("Ottoline Marchbanks", "Inkwell", "3"),
  lawmaticsId: null,
  stageId: S.consult,
  practiceArea: "Trademark",
};

async function load(world: World) {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  return import("../../src/app/dashboard/intake/reconcile/create-lead");
}

describe("who may create a lead", () => {
  it.each(ALLOWED)("%s can", async (role) => {
    const w = makeWorld({ role });
    const { createLeadFromReconcileAction } = await load(w);
    const r = await createLeadFromReconcileAction(sheetPerson);
    expect(r).toMatchObject({ ok: true, name: "Ottoline Marchbanks" });
  });

  it.each(REFUSED)("refuses %s with a fixed sentence and writes and reads nothing", async (role) => {
    const w = makeWorld({ role });
    const { createLeadFromReconcileAction } = await load(w);
    w.db.froms.length = 0;
    const r = await createLeadFromReconcileAction(sheetPerson);
    expect(r).toEqual({ ok: false, error: MSG.notAllowed });
    expect(w.db.froms).toEqual([]);
    expect(w.db.writes).toEqual([]);
  });

  it("refuses a signed-out caller and an unresolvable role, naming nothing", async () => {
    for (const opts of [{ client: { signedIn: false } }, { client: { roleError: true } }, { role: null }] as const) {
      const w = makeWorld(opts);
      const { createLeadFromReconcileAction } = await load(w);
      const r = await createLeadFromReconcileAction(sheetPerson);
      expect(r.ok).toBe(false);
      expect(w.db.writes).toEqual([]);
      expect(w.db.froms).toEqual([]);
      expect(JSON.stringify(r)).not.toContain("SECRET");
    }
  });

  it("re-resolves the role on every call", async () => {
    const w = makeWorld({ role: "admin" });
    const { createLeadFromReconcileAction } = await load(w);
    expect((await createLeadFromReconcileAction(sheetPerson)).ok).toBe(true);
    w.db.role = "viewer";
    expect((await createLeadFromReconcileAction({ ...sheetPerson, sheetKey: "other1" })).ok).toBe(false);
    expect(w.db.rpcCalls.filter((n) => n === "current_org_role")).toHaveLength(2);
  });
});

describe("what is written", () => {
  it("one lead in the caller's org, from the session, with where they were found as the source", async () => {
    const w = makeWorld();
    const { createLeadFromReconcileAction } = await load(w);
    const r = await createLeadFromReconcileAction(sheetPerson);
    expect(r.ok).toBe(true);
    const inserts = writesTo(w.db, "crm_lead").filter((x) => x.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      org_id: ORG,
      first_name: "Ottoline",
      last_name: "Marchbanks",
      current_stage_id: S.consult,
      sheet_key: sheetPerson.sheetKey,
      practice_area: "Trademark",
      referral_detail: "Found in the intake sheet",
    });
    expect(FOUND_LABEL).toEqual({ sheet: "Found in the intake sheet", lawmatics: "Found in Lawmatics", mailbox: "Found in the mailbox" });
    // No address known: the undeliverable placeholder, never an invented real-looking one.
    expect((inserts[0].payload as { email: string }).email).toMatch(/@intake\.invalid$/);
  });

  it("a Lawmatics person keeps their Lawmatics id and real address; the source says Lawmatics", async () => {
    const w = makeWorld();
    const { createLeadFromReconcileAction } = await load(w);
    await createLeadFromReconcileAction({ ...sheetPerson, found: "lawmatics", sheetKey: null, lawmaticsId: "700", email: "O@Marchbanks.Example", stageId: null });
    const row = w.db.rows("crm_lead").find((r) => r.lawmatics_id === "700")!;
    expect(row).toMatchObject({ email: "o@marchbanks.example", referral_detail: "Found in Lawmatics", current_stage_id: S.pnc });
  });

  it("logs a lead_created row on the timeline saying it came from Reconcile", async () => {
    const w = makeWorld();
    const { createLeadFromReconcileAction } = await load(w);
    const r = await createLeadFromReconcileAction(sheetPerson);
    if (!r.ok) throw new Error(r.error);
    expect(w.db.activity()).toEqual([expect.objectContaining({ type: "lead_created", lead_id: r.leadId, payload: expect.objectContaining({ source: "reconcile", found: "sheet" }) })]);
  });

  it("never files in a stage that opens a matter: a won stage falls back to the first open one", async () => {
    const w = makeWorld();
    const { createLeadFromReconcileAction } = await load(w);
    await createLeadFromReconcileAction({ ...sheetPerson, stageId: S.signed });
    expect(w.db.rows("crm_lead")[0].current_stage_id).toBe(S.pnc);
  });

  it("a stage id that is not the firm's falls back to the first open stage", async () => {
    const w = makeWorld();
    const { createLeadFromReconcileAction } = await load(w);
    await createLeadFromReconcileAction({ ...sheetPerson, stageId: "99999999-0000-4000-8000-000000000009" });
    expect(w.db.rows("crm_lead")[0].current_stage_id).toBe(S.pnc);
  });

  it("with no evidence the person lands in the new-enquiry stage, not in an open Follow-Up that sorts first (Sprint 29)", async () => {
    const stages = STAGES.map((st) => (st.id === S.followUp ? { ...st, category: "open" } : st));
    const w = makeWorld({ stages: stages.map((st) => ({ id: st.id, org_id: ORG, name: st.name, category: st.category, order_index: st.orderIndex })) });
    const { createLeadFromReconcileAction } = await load(w);
    await createLeadFromReconcileAction({ ...sheetPerson, found: "lawmatics", sheetKey: null, lawmaticsId: "801", email: "p@x.example", stageId: null });
    expect(w.db.rows("crm_lead").find((r) => r.lawmatics_id === "801")!.current_stage_id).toBe(S.pnc);
  });

  it("a firm with no open stage creates nothing and says why", async () => {
    const w = makeWorld({ stages: [] });
    const { createLeadFromReconcileAction } = await load(w);
    expect(await createLeadFromReconcileAction({ ...sheetPerson, stageId: null })).toEqual({ ok: false, error: MSG.createNoStage });
    expect(writesTo(w.db, "crm_lead")).toEqual([]);
  });

  it("uses only the caller's scoped client (no service role anywhere in the file)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/app/dashboard/intake/reconcile/create-lead.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/getAdminClient|db\/admin|SERVICE_ROLE/);
  });
});

describe("one person, one lead", () => {
  it.each([
    ["sheet key", { sheetKey: "samekey" }, { sheet_key: "samekey" }],
    ["Lawmatics id", { lawmaticsId: "700" }, { lawmatics_id: "700" }],
    ["email", { email: "Dupe@Example.com" }, { email: "dupe@example.com" }],
  ])("refuses when the %s is already a lead", async (_label, candidate, existing) => {
    const w = makeWorld({ leads: [leadRow({ id: L.amara, ...existing })] });
    const { createLeadFromReconcileAction } = await load(w);
    const r = await createLeadFromReconcileAction({ ...sheetPerson, sheetKey: null, ...candidate });
    expect(r).toEqual({ ok: false, error: MSG.createExists });
    expect(writesTo(w.db, "crm_lead")).toEqual([]);
  });

  it("another firm's lead with the same key is invisible, so it does not block", async () => {
    const w = makeWorld({ leads: [leadRow({ id: L.other, org_id: OTHER_ORG, sheet_key: "samekey" })] });
    const { createLeadFromReconcileAction } = await load(w);
    expect((await createLeadFromReconcileAction({ ...sheetPerson, sheetKey: "samekey" })).ok).toBe(true);
  });

  it("a failed check is a fixed sentence, never an empty answer", async () => {
    const w = makeWorld();
    w.db.fail("crm_lead", "select", { code: "XX000", message: SECRET });
    const { createLeadFromReconcileAction } = await load(w);
    const r = await createLeadFromReconcileAction(sheetPerson);
    expect(r).toEqual({ ok: false, error: MSG.createReadFailed });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(writesTo(w.db, "crm_lead")).toEqual([]);
  });

  it("a failed insert is a fixed sentence and nothing from the database", async () => {
    const w = makeWorld();
    w.db.fail("crm_lead", "insert", { code: "23505", message: SECRET });
    const { createLeadFromReconcileAction } = await load(w);
    const r = await createLeadFromReconcileAction(sheetPerson);
    expect(r).toEqual({ ok: false, error: MSG.createFailed });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(SECRET);
  });
});

describe("the candidate the browser sends is checked again", () => {
  it.each([
    ["not an object", "x"],
    ["no name at all", { ...sheetPerson, firstName: "", lastName: "" }],
    ["a name that is too long", { ...sheetPerson, lastName: "x".repeat(121) }],
    ["a bad address", { ...sheetPerson, email: "not-an-address" }],
    ["an unknown 'found'", { ...sheetPerson, found: "elsewhere" }],
    ["a key with spaces", { ...sheetPerson, sheetKey: "a b" }],
    ["a stage that is not a uuid", { ...sheetPerson, stageId: "nope" }],
    ["a number for a name", { ...sheetPerson, firstName: 5 }],
  ])("%s", async (_label, input) => {
    const w = makeWorld();
    const { createLeadFromReconcileAction } = await load(w);
    expect(await createLeadFromReconcileAction(input)).toEqual({ ok: false, error: MSG.createBadRequest });
    expect(writesTo(w.db, "crm_lead")).toEqual([]);
  });

  it("parseCandidate trims, lower-cases the address and drops anything extra (such as an org id)", () => {
    const out = parseCandidate({ ...sheetPerson, firstName: "  Ottoline ", email: " A@B.Example ", org_id: "evil", orgId: "evil" });
    expect(out).toMatchObject({ firstName: "Ottoline", email: "a@b.example" });
    expect(Object.keys(out!)).not.toContain("org_id");
    expect(Object.keys(out!)).not.toContain("orgId");
  });
});

describe("nothing is created without the click, and the person then reconciles like any lead", () => {
  it("a preview lists the person under Not in Lectual yet and writes nothing", async () => {
    const w = makeWorld({ leads: [] });
    const loaded = await loadActions(w, { lawmatics: lawmaticsStub({ prospects: () => ({ data: [], included: [], meta: { total_pages: 1 } }) }) });
    const r = await loaded.previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    const listed = r.view.summary.notInLectual ?? [];
    expect(listed.map((i) => i.name)).toEqual(expect.arrayContaining(["Amara Nwosu", "Priya Raman"]));
    expect(listed.every((i) => i.found === "sheet" && i.candidate.sheetKey)).toBe(true);
    expect(w.db.writes).toEqual([]);
  });

  it("after Create lead, the next preview has the person as a row with their sheet reading", async () => {
    const w = makeWorld({ leads: [] });
    const loaded = await loadActions(w, { lawmatics: lawmaticsStub({ prospects: () => ({ data: [], included: [], meta: { total_pages: 1 } }) }) });
    const first = await loaded.previewReconcileAction(formWith(csvFile()));
    if (!first.ok) throw new Error(first.error);
    const priya = first.view.summary.notInLectual!.find((i) => i.name === "Priya Raman")!;

    vi.doUnmock("@/lib/pipeline");
    const { createLeadFromReconcileAction } = await load(w);
    const made = await createLeadFromReconcileAction(priya.candidate);
    if (!made.ok) throw new Error(made.error);

    const loaded2 = await loadActions(w, { lawmatics: lawmaticsStub({ prospects: () => ({ data: [], included: [], meta: { total_pages: 1 } }) }) });
    const second = await loaded2.previewReconcileAction(formWith(csvFile()));
    if (!second.ok) throw new Error(second.error);
    const row = second.view.rows.find((x) => x.leadId === made.leadId)!;
    expect(row.sheet.kind).toBe("stage");
    expect(second.view.summary.notInLectual!.map((i) => i.name)).not.toContain("Priya Raman");
  });
});
