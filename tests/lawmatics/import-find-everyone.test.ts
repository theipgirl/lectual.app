// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BUCKET_LABEL, findInPlan, foldTerm, notInPullMessage, planPeople, searchPeople } from "@/lib/lawmatics/find-in-plan";
import {
  CONTACT_SOURCE,
  DEFAULT_PLAN_OPTIONS,
  HIRED_LABEL,
  planImport,
  type ExistingLead,
  type PlanOptions,
  type PlanStage,
} from "@/lib/lawmatics/import-plan";
import { pullSource } from "@/lib/lawmatics/import";
import type { LawmaticsClient, ListResult } from "@/lib/lawmatics/client";
import { includedIndex, records, type Raw } from "@/lib/lawmatics/jsonapi";
import type { LawmaticsSourceContact, LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";

import { contactsPayload, prospectsPayload } from "../__fixtures__/lawmatics.fixture";

/**
 * Sprint 26 A: no person who exists in Lawmatics is dropped silently. Every path that used to lose someone
 * (a stage the firm has no name for, "Hired", a contact with no matter, the practice-area filter, a pull cut
 * short, a name that lives only on the sideloaded contact) is exercised here with invented people and fakes.
 */

const STAGES: PlanStage[] = [
  { id: "s-won", name: "Signed LOE / Deposit Received", category: "won", orderIndex: 7 },
  { id: "s-consult", name: "Consultation Scheduled", category: "open", orderIndex: 3 },
  { id: "s-pnc", name: "Potential New Client", category: "open", orderIndex: 1 },
  { id: "s-lost", name: "Lost", category: "lost", orderIndex: 9 },
];

function rec(over: Partial<LawmaticsSourceRecord> = {}): LawmaticsSourceRecord {
  return {
    lawmaticsId: "p1",
    matterName: "Matter One",
    firstName: "Odalys",
    lastName: "Brightwater",
    email: "odalys@brightwater.example",
    phone: null,
    businessName: "Brightwater Goods",
    website: null,
    stageName: "Consultation Scheduled",
    practiceArea: "Trademark",
    createdAt: null,
    updatedAt: null,
    contactId: null,
    referralSource: null,
    ...over,
  };
}

function contact(over: Partial<LawmaticsSourceContact> = {}): LawmaticsSourceContact {
  return { lawmaticsId: "c1", firstName: "Tamsin", lastName: "Quillfeather", email: "tamsin@quill.example", phone: null, businessName: null, website: null, ...over };
}

function existing(over: Partial<ExistingLead> = {}): ExistingLead {
  return {
    id: "lead-1",
    email: "tamsin@quill.example",
    first_name: "Tamsin",
    last_name: "Quillfeather",
    phone: null,
    business_name: null,
    website: null,
    current_stage_id: "s-pnc",
    lawmatics_id: null,
    practice_area: null,
    referral_source: null,
    referral_detail: null,
    ...over,
  };
}

const FILTER_ON: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, practiceAreaFilter: "Trademark" };

describe("a stage the firm has no name for is imported, not dropped", () => {
  it.each(["Proposal Sent", "Consult Completed", "Discovery Call No Show"])('"%s" is created in the first open stage with the flag', (stageName) => {
    const plan = planImport([rec({ stageName })], STAGES, []);
    expect(plan.skipped).toEqual([]);
    expect(plan.unmapped).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    const c = plan.creates[0];
    // The lowest-ordered OPEN stage, though it is not first in the list.
    expect(c.stageId).toBe("s-pnc");
    expect(c.stageDecision).toEqual({
      lawmaticsStage: stageName,
      hired: false,
      label: `Imported, stage needs a decision: ${stageName}`,
    });
    expect(plan.totals).toMatchObject({ create: 1, stageDecision: 1, unmapped: 0, skipped: 0 });
  });

  it("a person with no stage at all is flagged the same way, not parked silently", () => {
    const plan = planImport([rec({ stageName: null })], STAGES, []);
    expect(plan.creates[0].stageDecision?.label).toBe("Imported, stage needs a decision: no stage");
  });

  it("a stage the firm does have is created there with no flag", () => {
    const plan = planImport([rec()], STAGES, []);
    expect(plan.creates[0]).toMatchObject({ stageId: "s-consult", stageDecision: null });
    expect(plan.totals.stageDecision).toBe(0);
  });

  it("never invents a mapping: the alias table still says Proposal Sent matches nothing", async () => {
    const { resolveStage } = await import("@/lib/lawmatics/stage-map");
    expect(resolveStage("Proposal Sent", STAGES).ok).toBe(false);
    expect(resolveStage("Consult Completed", STAGES).ok).toBe(false);
  });

  it("a firm with no open stage leaves them in unmapped with that reason: named, not dropped", () => {
    const noOpen = STAGES.filter((s) => s.category !== "open");
    const plan = planImport([rec({ stageName: "Proposal Sent" })], noOpen, []);
    expect(plan.creates).toEqual([]);
    expect(plan.unmapped).toHaveLength(1);
    expect(plan.unmapped[0].reason).toMatch(/no open stage/i);
    expect(plan.unmapped[0].reason).toContain("Proposal Sent");
  });

  it("leaves a stage-less list (no categories known) in unmapped rather than guessing a stage", () => {
    const plan = planImport([rec({ stageName: "Proposal Sent" })], STAGES.map(({ id, name }) => ({ id, name })), []);
    expect(plan.creates).toEqual([]);
    expect(plan.unmapped).toHaveLength(1);
  });
});

describe('"Hired" and "Hired Client" are imported as leads and never put in a won stage', () => {
  it.each(["Hired", "Hired Client", "HIRED CLIENT"])('"%s"', (stageName) => {
    const plan = planImport([rec({ stageName })], STAGES, []);
    const c = plan.creates[0];
    expect(c.stageDecision).toEqual({ lawmaticsStage: stageName, hired: true, label: HIRED_LABEL });
    expect(HIRED_LABEL).toBe("Hired in Lawmatics — open a matter");
    const target = STAGES.find((s) => s.id === c.stageId)!;
    expect(target.category).not.toBe("won");
    expect(target.category).toBe("open");
  });

  it("even when the firm has a stage literally named Hired Client in a won category", () => {
    const withHired: PlanStage[] = [...STAGES, { id: "s-hired", name: "Hired Client", category: "won", orderIndex: 8 }];
    const plan = planImport([rec({ stageName: "Hired Client" })], withHired, []);
    expect(plan.creates[0].stageId).toBe("s-pnc");
    expect(plan.creates[0].stageDecision?.hired).toBe(true);
  });

  it("and a Lawmatics stage that is one of the firm's matter-opening stages", () => {
    const plan = planImport([rec({ stageName: "Signed LOE / Deposit Received" })], STAGES, []);
    expect(plan.creates[0].stageId).toBe("s-pnc");
    expect(plan.creates[0].stageDecision?.label).toBe(HIRED_LABEL);
  });
});

describe("a Lawmatics contact with no prospect becomes a lead", () => {
  it("is planned as its own group, filed in the first open stage, source Lawmatics contact", () => {
    const plan = planImport([], STAGES, [], DEFAULT_PLAN_OPTIONS, [contact()]);
    expect(plan.contactCreates).toHaveLength(1);
    expect(plan.contactCreates[0]).toMatchObject({
      contactId: "c1",
      stageId: "s-pnc",
      fields: { first_name: "Tamsin", last_name: "Quillfeather", email: "tamsin@quill.example", referral_detail: CONTACT_SOURCE, referral_source: null },
    });
    expect(CONTACT_SOURCE).toBe("Lawmatics contact");
    expect(plan.totals).toMatchObject({ create: 1, contactOnly: 1, sourceRecords: 1 });
  });

  it("is deduped by email, case-insensitively, against an existing lead: a second run creates nothing", () => {
    const first = planImport([], STAGES, [], DEFAULT_PLAN_OPTIONS, [contact()]);
    expect(first.contactCreates).toHaveLength(1);
    // The lead the first run wrote, with the address in another case.
    const second = planImport([], STAGES, [existing({ email: "Tamsin@Quill.EXAMPLE" })], DEFAULT_PLAN_OPTIONS, [contact()]);
    expect(second.contactCreates).toEqual([]);
    expect(second.unchanged).toEqual([expect.objectContaining({ lawmaticsId: "contact:c1", leadId: "lead-1" })]);
    expect(second.totals.create).toBe(0);
  });

  it("is deduped against a prospect in the same pull (that record carries the person)", () => {
    const plan = planImport([rec({ email: "TAMSIN@quill.example" })], STAGES, [], DEFAULT_PLAN_OPTIONS, [contact()]);
    expect(plan.contactCreates).toEqual([]);
    expect(plan.skipped.find((s) => s.lawmaticsId === "contact:c1")?.reason).toMatch(/same pull/);
  });

  it("is deduped by contact id and by address within the contacts themselves", () => {
    const plan = planImport([], STAGES, [], DEFAULT_PLAN_OPTIONS, [contact(), contact(), contact({ lawmaticsId: "c2" })]);
    expect(plan.contactCreates).toHaveLength(1);
    expect(plan.skipped.map((s) => s.reason).join(" ")).toMatch(/more than once/);
    expect(plan.skipped.map((s) => s.reason).join(" ")).toMatch(/already claims this email/);
  });

  it("a contact with no email, or no name, is skipped with a reason: named, not dropped", () => {
    const plan = planImport([], STAGES, [], DEFAULT_PLAN_OPTIONS, [contact({ email: null }), contact({ lawmaticsId: "c3", firstName: null, lastName: null })]);
    expect(plan.contactCreates).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0].reason).toMatch(/no email/i);
    expect(plan.skipped[1].reason).toMatch(/name/i);
  });

  it("with the practice-area filter on, a contact (which has no practice area) is excluded and named", () => {
    const plan = planImport([], STAGES, [], FILTER_ON, [contact()]);
    expect(plan.contactCreates).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ name: "Tamsin Quillfeather", reason: expect.stringContaining("no practice area") });
  });

  it("every contact is accounted for in exactly one bucket", () => {
    const plan = planImport([rec()], STAGES, [existing({ email: "kept@x.example" })], DEFAULT_PLAN_OPTIONS, [
      contact(),
      contact({ lawmaticsId: "c2", email: "kept@x.example" }),
      contact({ lawmaticsId: "c3", email: null }),
    ]);
    const { create, update, unchanged, unmapped, skipped, sourceRecords } = plan.totals;
    expect(create + update + unchanged + unmapped + skipped).toBe(sourceRecords);
    expect(sourceRecords).toBe(4);
  });
});

describe("a name that lives only on the sideloaded contact", () => {
  function stub(byPath: Record<string, Raw>): LawmaticsClient {
    return {
      get: async () => ({}),
      listAll: async (path): Promise<ListResult> => {
        const payload = byPath[path];
        return { records: records(payload), included: includedIndex(payload), pagesFetched: 1, truncated: false, includeDropped: false };
      },
    };
  }

  it("is imported under that name", async () => {
    const client = stub({
      "/prospects": prospectsPayload([{ id: "p9", matterName: "", stage: "Consultation Scheduled", contactId: "c-9" }]),
      "/contacts": contactsPayload([{ id: "c-9", firstName: "Ravenna", lastName: "Holloway", email: "ravenna@holloway.example" }]),
    });
    const pull = await pullSource(client);
    const plan = planImport(pull.records, STAGES, [], DEFAULT_PLAN_OPTIONS, pull.contactOnly);
    expect(plan.skipped).toEqual([]);
    expect(plan.creates[0].fields).toMatchObject({ first_name: "Ravenna", last_name: "Holloway", email: "ravenna@holloway.example" });
    // That contact is the prospect's, so it is not also a contact-only lead.
    expect(pull.contactOnly).toEqual([]);
    expect(plan.contactCreates).toEqual([]);
  });

  it("pullSource returns only the contacts that no prospect refers to", async () => {
    const client = stub({
      "/prospects": prospectsPayload([{ id: "p9", matterName: "M", firstName: "A", lastName: "B", email: "ab@x.example", stage: "Consultation Scheduled", contactId: "c-9" }]),
      "/contacts": contactsPayload([
        { id: "c-9", firstName: "A", lastName: "B", email: "ab@x.example" },
        { id: "c-10", firstName: "Lone", lastName: "Contact", email: "lone@x.example" },
      ]),
    });
    const pull = await pullSource(client);
    expect(pull.contactOnly.map((c) => c.lawmaticsId)).toEqual(["c-10"]);
  });

  it("a failed contacts read is the truncated warning, and no contact-only lead is invented", async () => {
    const client: LawmaticsClient = {
      get: async () => ({}),
      listAll: async (path): Promise<ListResult> => {
        if (path === "/contacts") throw new Error("boom");
        const payload = prospectsPayload([{ id: "p1", matterName: "M", firstName: "A", lastName: "B", email: "ab@x.example", stage: "Consultation Scheduled" }]);
        return { records: records(payload), included: includedIndex(payload), pagesFetched: 1, truncated: false, includeDropped: false };
      },
    };
    const pull = await pullSource(client);
    expect(pull.truncated).toBe(true);
    expect(pull.truncatedReason).toMatch(/Contact details could not be fetched/);
    expect(pull.contactOnly).toEqual([]);
  });
});

describe("the practice-area filter lists everyone it excludes, by name", () => {
  it("defaults to OFF", () => {
    expect(DEFAULT_PLAN_OPTIONS.practiceAreaFilter).toBeNull();
    const plan = planImport([rec({ practiceArea: null }), rec({ lawmaticsId: "p2", email: "b@x.example", practiceArea: "Patent" })], STAGES, []);
    expect(plan.skipped).toEqual([]);
    expect(plan.creates).toHaveLength(2);
  });

  it("names every excluded person with the reason, including one with no practice area", () => {
    const plan = planImport(
      [
        rec({ lawmaticsId: "p1", email: "a@x.example", firstName: "Ansel", lastName: "Greaves", practiceArea: "Patent" }),
        rec({ lawmaticsId: "p2", email: "b@x.example", firstName: "Beatrix", lastName: "Lund", practiceArea: null }),
        rec({ lawmaticsId: "p3", email: "c@x.example", firstName: "Cato", lastName: "Mbeki", practiceArea: "Trademark" }),
      ],
      STAGES,
      [],
      FILTER_ON,
    );
    expect(plan.skipped.map((s) => s.name)).toEqual(["Ansel Greaves", "Beatrix Lund"]);
    expect(plan.skipped[0].reason).toContain('practice area "Patent" excluded by filter "Trademark"');
    expect(plan.skipped[1].reason).toContain("no practice area on record");
    expect(plan.creates.map((c) => c.lawmaticsId)).toEqual(["p3"]);
    expect(plan.totals).toMatchObject({ skipped: 2, create: 1 });
  });
});

describe("Find a person in this pull", () => {
  const sevetra = rec({ lawmaticsId: "p77", firstName: "Sévetra", lastName: "Wren", email: "sevetra@prospera.example", businessName: "Prosperall", stageName: "Proposal Sent" });
  const plan = planImport(
    [
      rec({ lawmaticsId: "p1", email: "a@x.example", firstName: "Ansel", lastName: "Greaves" }),
      sevetra,
      rec({ lawmaticsId: "p3", email: "c@x.example", firstName: "Cato", lastName: "Mbeki", stageName: "Hired Client" }),
      rec({ lawmaticsId: "p4", email: null, firstName: "Nomail", lastName: "Person" }),
    ],
    STAGES,
    [existing({ id: "lead-9", email: "a@x.example", first_name: "Ansel", last_name: "Greaves", lawmatics_id: "p1", practice_area: "Trademark", current_stage_id: "s-consult" })],
    DEFAULT_PLAN_OPTIONS,
    [contact({ firstName: "Lone", lastName: "Contact", email: "lone@x.example" })],
  );

  it("matches case- and accent-insensitively and says which bucket, and why", () => {
    const [hit, ...rest] = findInPlan(plan, "  SEVETRA ");
    expect(rest).toEqual([]);
    expect(hit).toMatchObject({ bucket: "stage-decision", name: "Sévetra Wren", stage: "Proposal Sent" });
    expect(hit.reason).toContain("Imported, stage needs a decision: Proposal Sent");
    expect(BUCKET_LABEL[hit.bucket]).toMatch(/stage needs a decision/);
  });

  it("matches by business and by email", () => {
    expect(findInPlan(plan, "prosperall").map((p) => p.ref)).toEqual(["p77"]);
    expect(findInPlan(plan, "prospera.example").map((p) => p.ref)).toEqual(["p77"]);
  });

  it("finds a person in every bucket", () => {
    const bucketOf = (term: string) => findInPlan(plan, term)[0]?.bucket;
    expect(bucketOf("Lone")).toBe("contact-only");
    expect(bucketOf("Cato")).toBe("stage-decision");
    expect(bucketOf("Ansel")).toBe("update");
    expect(bucketOf("Nomail")).toBe("skipped");
  });

  it("every person the plan accounts for appears exactly once", () => {
    const people = planPeople(plan);
    expect(people).toHaveLength(plan.totals.sourceRecords);
  });

  it("a term is trimmed and capped; an empty term finds nothing", () => {
    expect(foldTerm("   Sévetra   ")).toBe("sevetra");
    expect(foldTerm("x".repeat(500))).toHaveLength(80);
    expect(findInPlan(plan, "   ")).toEqual([]);
    expect(searchPeople(planPeople(plan), "e", 2)).toHaveLength(2);
  });

  it('no match says "Not in this pull" and names the causes', () => {
    expect(findInPlan(plan, "Zzyzx")).toEqual([]);
    const text = notInPullMessage({ truncated: true, practiceAreaFilterOn: true, includeDropped: false });
    expect(text).toMatch(/^Not in this pull\./);
    expect(text).toContain("cut short");
    expect(text).toContain("and it was, this time");
    expect(text).toContain("practice-area filter is on");
    expect(text).toContain("and it is");
    expect(notInPullMessage({ truncated: false, practiceAreaFilterOn: false, includeDropped: false })).not.toContain("and it is");
  });
});

describe("the fingerprint covers the new groups", () => {
  it("a flagged stage and a contact-only lead change it", () => {
    const base = planImport([rec()], STAGES, []).fingerprint;
    expect(planImport([rec({ stageName: "Proposal Sent" })], STAGES, []).fingerprint).not.toBe(base);
    expect(planImport([rec()], STAGES, [], DEFAULT_PLAN_OPTIONS, [contact()]).fingerprint).not.toBe(base);
  });
});

// ── apply: contact leads are written, the stage flag lands on the timeline ───

type Insert = Record<string, unknown>;

function fakeDb() {
  const leads: Insert[] = [];
  const activity: Insert[] = [];
  const stages = STAGES.map((s) => ({ id: s.id, name: s.name, category: s.category, order_index: s.orderIndex }));
  let n = 0;
  const client = {
    rpc: async (name: string) => (name === "current_org_id" ? { data: "org-1", error: null } : { data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => {
      if (table === "crm_stage") return { select: () => ({ order: () => Promise.resolve({ data: stages, error: null }) }) };
      if (table === "crm_activity") {
        return {
          insert: (row: Insert) => {
            activity.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        insert: (rows: Insert | Insert[]) => {
          for (const r of Array.isArray(rows) ? rows : [rows]) leads.push({ id: `lead-new-${(n += 1)}`, ...r });
          return Promise.resolve({ error: null });
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: (cols: string) => {
          if (cols === "org_id") return { eq: () => ({ single: async () => ({ data: { org_id: "org-1" }, error: null }) }) };
          const chain = {
            order: () => chain,
            range: () => Promise.resolve({ data: [], error: null }),
            in: (_col: string, ids: string[]) =>
              Promise.resolve({ data: leads.filter((l) => ids.includes(String(l.lawmatics_id))).map((l) => ({ id: l.id, lawmatics_id: l.lawmatics_id })), error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { client, leads, activity };
}

describe("applyImport writes the contact leads and flags the stand-in stages", () => {
  beforeEach(() => vi.resetModules());
  afterAll(() => vi.unstubAllGlobals());

  async function load(db: ReturnType<typeof fakeDb>) {
    const prospects = prospectsPayload([
      { id: "p1", matterName: "One", firstName: "Odalys", lastName: "Brightwater", email: "o@x.example", stage: "Proposal Sent", practiceArea: "Trademark" },
      { id: "p2", matterName: "Two", firstName: "Cato", lastName: "Mbeki", email: "c@x.example", stage: "Hired Client", practiceArea: "Trademark" },
      { id: "p3", matterName: "Three", firstName: "Mina", lastName: "Okoro", email: "m@x.example", stage: "Consultation Scheduled", practiceArea: "Trademark" },
    ]);
    const contacts = contactsPayload([{ id: "c-lone", firstName: "Lone", lastName: "Contact", email: "lone@x.example" }]);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const body = String(url).includes("/contacts") ? contacts : prospects;
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/lib/lawmatics/connection", async () => {
      const { createLawmaticsClient } = await import("@/lib/lawmatics/client");
      return { firmLawmaticsClient: async () => createLawmaticsClient({ token: "t" }) };
    });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => db.client }));
    return { mod: await import("@/lib/lawmatics/import"), fetchMock };
  }

  it("creates the prospects and the contact lead; flags exactly the two stand-in stages", async () => {
    const db = fakeDb();
    const { mod, fetchMock } = await load(db);
    const preview = await mod.previewImport();
    expect(preview.plan.totals).toMatchObject({ create: 4, stageDecision: 2, contactOnly: 1 });

    const report = await mod.applyImport(preview.plan.fingerprint, undefined, 60_000);
    expect(report).toMatchObject({ created: 4, contactsCreated: 1, stageDecisions: 2, flagsNotRecorded: 0, partial: false });

    const contactLead = db.leads.find((l) => l.email === "lone@x.example")!;
    expect(contactLead).toMatchObject({ referral_detail: "Lawmatics contact", current_stage_id: "s-pnc" });
    expect(contactLead.lawmatics_id).toBeUndefined();

    // No lead was filed in the won stage.
    expect(db.leads.every((l) => l.current_stage_id !== "s-won")).toBe(true);

    const flags = db.activity.map((a) => a.payload as Record<string, unknown>).sort((a, b) => String(a.lawmatics_stage_unmapped).localeCompare(String(b.lawmatics_stage_unmapped)));
    expect(flags).toEqual([
      expect.objectContaining({ source: "lawmatics_import", lawmatics_stage_unmapped: "Hired Client", hired_in_lawmatics: true }),
      expect.objectContaining({ source: "lawmatics_import", lawmatics_stage_unmapped: "Proposal Sent", hired_in_lawmatics: false }),
    ]);
    expect(db.activity.every((a) => a.type === "lead_created" && a.actor_type === "system")).toBe(true);

    // Lawmatics was only read.
    for (const call of fetchMock.mock.calls) {
      const init = (call as unknown as [unknown, { method?: string }?])[1];
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("a second run against the leads the first wrote creates nothing for the contact", async () => {
    const db = fakeDb();
    const { mod } = await load(db);
    const preview = await mod.previewImport();
    await mod.applyImport(preview.plan.fingerprint, undefined, 60_000);
    // What the database now holds is what the next pull is planned against.
    const again = planImport([], STAGES, [existing({ email: "lone@x.example", first_name: "Lone", last_name: "Contact" })], DEFAULT_PLAN_OPTIONS, [contact({ lawmaticsId: "c-lone", firstName: "Lone", lastName: "Contact", email: "lone@x.example" })]);
    expect(again.contactCreates).toEqual([]);
    expect(again.totals.create).toBe(0);
  });
});
