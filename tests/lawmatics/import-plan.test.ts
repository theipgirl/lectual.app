import { describe, it, expect } from "vitest";

import {
  DEFAULT_PLAN_OPTIONS,
  planImport,
  type ExistingLead,
  type PlanOptions,
} from "@/lib/lawmatics/import-plan";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";

import { RPB_STAGE_NAMES, stageRefs } from "../__fixtures__/lawmatics.fixture";

const stages = stageRefs(RPB_STAGE_NAMES);
const stageId = (name: string) => stages.find((s) => s.name === name)!.id;

function source(overrides: Partial<LawmaticsSourceRecord> = {}): LawmaticsSourceRecord {
  return {
    lawmaticsId: "4207",
    matterName: "Verdant Bloom Botanicals — VERDANT BLOOM",
    firstName: "Marisol",
    lastName: "Vega",
    email: "marisol@verdantbloom.co",
    phone: "+1 (305) 555-0134",
    businessName: "Verdant Bloom Botanicals",
    website: "https://verdantbloom.co/",
    stageName: "Application Filed",
    practiceArea: "Trademark",
    createdAt: "2026-01-14T09:30:00.000Z",
    updatedAt: "2026-06-02T16:05:00.000Z",
    contactId: "c-88",
    referralSource: null,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingLead> = {}): ExistingLead {
  return {
    id: "lead-1",
    email: "marisol@verdantbloom.co",
    first_name: "Marisol",
    last_name: "Vega",
    phone: "+1 (305) 555-0134",
    business_name: "Verdant Bloom Botanicals",
    website: "https://verdantbloom.co/",
    current_stage_id: stageId("Application Filed"),
    lawmatics_id: "4207",
    // Matches source()'s defaults (practiceArea: "Trademark", referralSource:
    // null) so the pre-existing idempotency tests below — which pair
    // source() with existing() and expect NOTHING to change — stay true now
    // that these three fields exist; a test that cares about one of them
    // overrides it explicitly.
    practice_area: "Trademark",
    referral_source: null,
    referral_detail: null,
    ...overrides,
  };
}

const MOVE: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, moveExistingStages: true };
const OVERWRITE: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, overwriteEditedFields: true };
const TRADEMARK_ONLY: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, practiceAreaFilter: "Trademark" };

describe("planImport — first run against an empty pipeline", () => {
  it("creates a lead per prospect, mapped onto the firm's own stage row", () => {
    const plan = planImport([source()], stages, []);
    expect(plan.totals).toMatchObject({ create: 1, update: 0, unmapped: 0, skipped: 0 });
    expect(plan.creates[0]).toMatchObject({
      lawmaticsId: "4207",
      stageId: stageId("Application Filed"),
      stageName: "Application Filed",
      stageVia: "exact",
      fields: {
        first_name: "Marisol",
        last_name: "Vega",
        email: "marisol@verdantbloom.co",
        business_name: "Verdant Bloom Botanicals",
      },
    });
  });

  it("carries the Lawmatics timestamps through so matter age isn't reset to today", () => {
    const plan = planImport([source()], stages, []);
    expect(plan.creates[0].createdAt).toBe("2026-01-14T09:30:00.000Z");
    expect(plan.creates[0].lastActivityAt).toBe("2026-06-02T16:05:00.000Z");
  });
});

describe("planImport — never guess, never drop", () => {
  it("puts an unmappable stage in the unmapped bucket instead of importing it somewhere", () => {
    const plan = planImport(
      [source({ stageName: "Discovery Call No Show" })],
      stages,
      [],
    );
    expect(plan.totals.create).toBe(0);
    expect(plan.unmapped).toHaveLength(1);
    expect(plan.unmapped[0]).toMatchObject({
      lawmaticsId: "4207",
      sourceStageName: "Discovery Call No Show",
      email: "marisol@verdantbloom.co",
    });
    expect(plan.unmapped[0].reason).toContain("Discovery Call No Show");
  });

  it("reports a record with no stage rather than parking it in stage one", () => {
    const plan = planImport([source({ stageName: null })], stages, []);
    expect(plan.creates).toHaveLength(0);
    expect(plan.unmapped).toHaveLength(1);
  });

  it("skips (and explains) a record with no usable email", () => {
    const plan = planImport([source({ email: null })], stages, []);
    expect(plan.skipped[0].reason).toMatch(/email/i);
    expect(plan.totals.create).toBe(0);
  });

  it("skips a record with no name at all", () => {
    const plan = planImport([source({ firstName: null, lastName: null })], stages, []);
    expect(plan.skipped[0].reason).toMatch(/name/i);
  });

  it("accounts for every input record in exactly one bucket", () => {
    const plan = planImport(
      [
        source({ lawmaticsId: "1" }),
        source({ lawmaticsId: "2", email: "theo@halloran.studio", stageName: "Nurture" }),
        source({ lawmaticsId: "3", email: null }),
      ],
      stages,
      [],
    );
    // divergences are informational and overlap the other buckets, so they are
    // deliberately excluded from this accounting.
    const { create, update, unchanged, unmapped, skipped } = plan.totals;
    expect(create + update + unchanged + unmapped + skipped).toBe(3);
    expect(plan.totals.sourceRecords).toBe(3);
  });
});

describe("planImport — idempotency", () => {
  it("re-running with unchanged data writes nothing", () => {
    const plan = planImport([source()], stages, [existing()]);
    expect(plan.totals).toMatchObject({ create: 0, update: 0, unchanged: 1 });
  });

  it("matches on lawmatics_id, not email — a changed email updates, never duplicates", () => {
    const args = [
      [source({ email: "hello@verdantbloom.co" })],
      stages,
      [existing()],
    ] as const;

    // The invariant this test exists for: matching is by lawmatics_id, so a
    // client whose email changed in Lawmatics is recognised as the SAME lead
    // and never imported a second time.
    const plan = planImport(...args);
    expect(plan.totals.create).toBe(0);

    // Under the default options the email write is withheld — the local value
    // is non-empty and may be a correction someone typed here — so the record
    // matches but writes nothing. The match is still visible, and still keyed
    // to the right lead.
    expect(plan.withheld).toEqual([
      {
        lawmaticsId: "4207",
        leadId: "lead-1",
        matterName: "Verdant Bloom Botanicals — VERDANT BLOOM",
        changes: [{ field: "email", from: "marisol@verdantbloom.co", to: "hello@verdantbloom.co" }],
      },
    ]);

    // Opting in applies it — and still as an update to lead-1, not a create.
    const optedIn = planImport(...args, OVERWRITE);
    expect(optedIn.totals.create).toBe(0);
    expect(optedIn.updates).toHaveLength(1);
    expect(optedIn.updates[0]).toMatchObject({ leadId: "lead-1", matchedBy: "lawmatics_id" });
    expect(optedIn.updates[0].changes).toEqual([
      { field: "email", from: "marisol@verdantbloom.co", to: "hello@verdantbloom.co" },
    ]);
  });

  it("adopts an unlinked local lead with the same email instead of cloning it", () => {
    const plan = planImport(
      [source()],
      stages,
      [existing({ lawmatics_id: null, phone: null })],
    );
    expect(plan.totals.create).toBe(0);
    expect(plan.updates[0]).toMatchObject({
      matchedBy: "email",
      linksRecord: true,
      leadId: "lead-1",
    });
  });

  it("links an identical unlinked lead even when no field would change", () => {
    const plan = planImport([source()], stages, [existing({ lawmatics_id: null })]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changes).toHaveLength(0);
    expect(plan.updates[0].linksRecord).toBe(true);
  });

  it("refuses to pick between two local leads sharing an email", () => {
    const plan = planImport([source()], stages, [
      existing({ id: "lead-1", lawmatics_id: null }),
      existing({ id: "lead-2", lawmatics_id: null }),
    ]);
    expect(plan.totals.create).toBe(0);
    expect(plan.totals.update).toBe(0);
    expect(plan.skipped[0].reason).toMatch(/share this email/i);
  });

  it("refuses to steal a lead already linked to a different Lawmatics record", () => {
    const plan = planImport([source()], stages, [existing({ lawmatics_id: "9999" })]);
    expect(plan.skipped[0].reason).toContain("9999");
    expect(plan.totals.create).toBe(0);
  });

  it("keeps the first of two Lawmatics records that claim the same email", () => {
    const plan = planImport(
      [source({ lawmaticsId: "1" }), source({ lawmaticsId: "2" })],
      stages,
      [],
    );
    expect(plan.totals.create).toBe(1);
    expect(plan.skipped[0]).toMatchObject({ lawmaticsId: "2" });
  });

  it("won't let two Lawmatics records both claim one existing lead", () => {
    // Both prospects resolve to lead-1 by email. Without a guard the second
    // update would overwrite the first one's lawmatics_id on the same row.
    const plan = planImport(
      [source({ lawmaticsId: "1" }), source({ lawmaticsId: "2" })],
      stages,
      [existing({ lawmatics_id: null })],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].lawmaticsId).toBe("1");
    expect(plan.skipped[0]).toMatchObject({ lawmaticsId: "2" });
    expect(plan.skipped[0].reason).toMatch(/already matches this lead/i);
  });

  it("reports a Lawmatics id repeated inside one response", () => {
    const plan = planImport([source(), source()], stages, []);
    expect(plan.totals.create).toBe(1);
    expect(plan.skipped[0].reason).toMatch(/duplicate/i);
  });
});

describe("planImport — field updates are conservative", () => {
  it("never blanks a local value just because Lawmatics has nothing", () => {
    const plan = planImport(
      [source({ phone: null, website: null, businessName: null })],
      stages,
      [existing()],
    );
    expect(plan.totals.update).toBe(0);
    expect(plan.totals.unchanged).toBe(1);
  });

  it("fills a local blank from Lawmatics", () => {
    const plan = planImport([source()], stages, [existing({ website: null })]);
    expect(plan.updates[0].changes).toEqual([
      { field: "website", from: null, to: "https://verdantbloom.co/" },
    ]);
  });
});

describe("planImport — stage moves are opt-in", () => {
  const moved = [source({ stageName: "Trademark Registered" })];
  const local = [existing({ current_stage_id: stageId("Application Filed") })];

  it("reports a divergence but leaves the stage alone — and writes nothing for it", () => {
    const plan = planImport(moved, stages, local);
    expect(plan.totals.update).toBe(0);
    expect(plan.totals.unchanged).toBe(1);
    expect(plan.divergences).toEqual([
      {
        lawmaticsId: "4207",
        leadId: "lead-1",
        matterName: "Verdant Bloom Botanicals — VERDANT BLOOM",
        sourceStageName: "Trademark Registered",
        targetStageName: "Trademark Registered",
      },
    ]);
  });

  it("moves the stage only when the operator opted in", () => {
    const plan = planImport(moved, stages, local, MOVE);
    expect(plan.updates[0].stageWillMove).toBe(true);
    expect(plan.updates[0].targetStageId).toBe(stageId("Trademark Registered"));
  });

  it("still updates the fields of a linked lead whose stage can't be mapped", () => {
    const plan = planImport(
      [source({ stageName: "Discovery Call Complete", phone: "+1 (305) 555-0199" })],
      stages,
      [existing()],
      { ...DEFAULT_PLAN_OPTIONS, moveExistingStages: true, overwriteEditedFields: true },
    );
    expect(plan.unmapped).toHaveLength(0);
    expect(plan.updates[0].stageWillMove).toBe(false);
    expect(plan.updates[0].stageNote).toContain("Discovery Call Complete");
    // overwriteEditedFields is on here so this still asserts what it always
    // did — that an unmappable stage does not block the field write.
    expect(plan.updates[0].changes).toHaveLength(1);
  });
});

describe("planImport — fingerprint", () => {
  it("is stable across identical runs", () => {
    const a = planImport([source()], stages, []);
    const b = planImport([source()], stages, []);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("ignores the order records arrive in", () => {
    const one = source({ lawmaticsId: "1" });
    const two = source({ lawmaticsId: "2", email: "theo@halloran.studio" });
    expect(planImport([one, two], stages, []).fingerprint).toBe(
      planImport([two, one], stages, []).fingerprint,
    );
  });

  it("changes when any field, stage, or option changes", () => {
    const base = planImport([source()], stages, []).fingerprint;
    expect(planImport([source({ phone: "+1 305 555 0000" })], stages, []).fingerprint).not.toBe(
      base,
    );
    expect(
      planImport([source({ stageName: "Trademark Registered" })], stages, []).fingerprint,
    ).not.toBe(base);
    expect(planImport([source()], stages, [], MOVE).fingerprint).not.toBe(base);
  });

  it("changes when a record moves between buckets", () => {
    const create = planImport([source()], stages, []).fingerprint;
    const unmapped = planImport([source({ stageName: "Nurture" })], stages, []).fingerprint;
    expect(create).not.toBe(unmapped);
  });
});

describe("planImport — a re-run must not revert edits a human made in Lectual", () => {
  // The stage was protected from the start; the other fields were not, so a
  // re-import silently reverted every correction staff had typed into the
  // dashboard back to whatever Lawmatics still held. Destroyed work, and
  // invisible, because the row still looks populated afterwards.
  it("holds back a change that would overwrite a corrected local value", () => {
    const plan = planImport(
      [source({ phone: "+1 (305) 555-0134" })],
      stages,
      [existing({ phone: "+1 (305) 555-9999" })], // someone fixed the number here
    );

    expect(plan.updates.flatMap((u) => u.changes.map((c) => c.field))).not.toContain("phone");
    expect(plan.totals.withheld).toBe(1);
    expect(plan.withheld[0].changes).toEqual([
      { field: "phone", from: "+1 (305) 555-9999", to: "+1 (305) 555-0134" },
    ]);
  });

  it("still FILLS a blank — there is no local edit to lose", () => {
    const plan = planImport([source()], stages, [existing({ phone: null })]);
    const changed = plan.updates.flatMap((u) => u.changes.map((c) => c.field));
    expect(changed).toContain("phone");
    expect(plan.totals.withheld).toBe(0);
  });

  it("writes the overwrite only when the operator explicitly opts in", () => {
    const plan = planImport(
      [source({ phone: "+1 (305) 555-0134" })],
      stages,
      [existing({ phone: "+1 (305) 555-9999" })],
      OVERWRITE,
    );
    expect(plan.updates[0].changes).toEqual([
      { field: "phone", from: "+1 (305) 555-9999", to: "+1 (305) 555-0134" },
    ]);
    expect(plan.totals.withheld).toBe(0);
  });

  // A record whose ONLY differences are withheld writes nothing, so it lands in
  // `unchanged` — the disagreement has to survive somewhere or it is invisible.
  it("reports a withheld-only record even though it writes nothing", () => {
    const plan = planImport(
      [source({ phone: "+1 (305) 555-0134" })],
      stages,
      [existing({ phone: "+1 (305) 555-9999" })],
    );
    expect(plan.totals.update).toBe(0);
    expect(plan.totals.unchanged).toBe(1);
    expect(plan.withheld).toHaveLength(1);
  });

  it("flipping the overwrite option changes the fingerprint", () => {
    const args = [
      [source({ phone: "+1 (305) 555-0134" })],
      stages,
      [existing({ phone: "+1 (305) 555-9999" })],
    ] as const;
    const held = planImport(...args);
    const written = planImport(...args, OVERWRITE);
    expect(held.fingerprint).not.toBe(written.fingerprint);
  });
});

describe("planImport — an email address is not an identity", () => {
  // Shared business inboxes (info@, hello@) are routine in a trademark
  // practice, and Lectual's leads arrive from self-service Pathset
  // assessments where they are normal. Adopting on email alone let a
  // Lawmatics prospect take over a DIFFERENT person's row — keeping that
  // row's id, activity timeline, voice notes and matters, under a new name.
  it("refuses to adopt a local lead whose name contradicts the incoming record", () => {
    const plan = planImport(
      [source({ lawmaticsId: "9001", firstName: "Jane", lastName: "Doe", email: "info@acme.com" })],
      stages,
      [existing({ id: "lead-bob", email: "info@acme.com", first_name: "Bob", last_name: "Smith", lawmatics_id: null })],
    );

    expect(plan.totals.update).toBe(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toMatch(/shared inboxes/i);
  });

  it("still adopts when the names agree", () => {
    const plan = planImport(
      [source({ lawmaticsId: "9002", email: "info@acme.com" })],
      stages,
      [existing({ id: "lead-m", email: "info@acme.com", lawmatics_id: null })],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ leadId: "lead-m", matchedBy: "email", linksRecord: true });
  });

  it("adopts a nameless local lead — nothing there to contradict", () => {
    const plan = planImport(
      [source({ lawmaticsId: "9003", email: "info@acme.com" })],
      stages,
      [existing({ id: "lead-blank", email: "info@acme.com", first_name: "", last_name: "", lawmatics_id: null })],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].leadId).toBe("lead-blank");
  });
});

describe("planImport — practiceAreaFilter (§6, blueprint intake-only import)", () => {
  it("imports every practice area when the filter is off (the default)", () => {
    const plan = planImport([source({ practiceArea: "Copyright" })], stages, []);
    expect(plan.totals.create).toBe(1);
    expect(plan.totals.skipped).toBe(0);
  });

  it("skips a non-matching practice area, with the exact reason string", () => {
    const plan = planImport(
      [source({ practiceArea: "Copyright" })],
      stages,
      [],
      TRADEMARK_ONLY,
    );
    expect(plan.totals.create).toBe(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe(
      'practice area "Copyright" excluded by filter "Trademark"',
    );
  });

  it("matches case-insensitively and by substring", () => {
    const plan = planImport(
      [source({ practiceArea: "trademarks & copyright" })],
      stages,
      [],
      TRADEMARK_ONLY,
    );
    expect(plan.totals.create).toBe(1);
  });

  it("skips a record with no practice area at all, with its own distinct reason", () => {
    const plan = planImport([source({ practiceArea: null })], stages, [], TRADEMARK_ONLY);
    expect(plan.totals.create).toBe(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe(
      'no practice area on record — excluded by filter "Trademark"',
    );
  });

  it("also filters an already-linked record, not just new creates", () => {
    const plan = planImport(
      [source({ practiceArea: "Copyright" })],
      stages,
      [existing()],
      TRADEMARK_ONLY,
    );
    expect(plan.totals.update).toBe(0);
    expect(plan.totals.unchanged).toBe(0);
    expect(plan.skipped).toHaveLength(1);
  });

  it("changes the fingerprint — an operator can only approve the plan they were shown", () => {
    const off = planImport([source()], stages, []).fingerprint;
    const on = planImport([source()], stages, [], TRADEMARK_ONLY).fingerprint;
    expect(off).not.toBe(on);
  });
});

describe("planImport — practice_area / referral_source / referral_detail on create", () => {
  it("carries practice_area and referral_detail straight from the record", () => {
    const plan = planImport(
      [source({ practiceArea: "Trademark", referralSource: "Instagram" })],
      stages,
      [],
    );
    expect(plan.creates[0].fields).toMatchObject({
      practice_area: "Trademark",
      referral_source: "Instagram",
      referral_detail: "Instagram",
    });
  });

  it("classifies referral_source through classifyReferralSource, keeping the verbatim text as detail", () => {
    const plan = planImport(
      [source({ referralSource: "Referral (Dean)" })],
      stages,
      [],
    );
    expect(plan.creates[0].fields.referral_source).toBe("Referral");
    expect(plan.creates[0].fields.referral_detail).toBe("Referral (Dean)");
  });

  it("never stamps a referral bucket when the source record simply doesn't expose one", () => {
    const plan = planImport([source({ referralSource: null })], stages, []);
    expect(plan.creates[0].fields.referral_source).toBeNull();
    expect(plan.creates[0].fields.referral_detail).toBeNull();
  });
});

describe("planImport — practice_area / referral_source / referral_detail on update", () => {
  it("fills all three blanks from Lawmatics", () => {
    const plan = planImport(
      [source({ practiceArea: "Trademark", referralSource: "UGW" })],
      stages,
      [existing({ practice_area: null, referral_source: null, referral_detail: null })],
    );
    expect(plan.updates[0].changes).toEqual(
      expect.arrayContaining([
        { field: "practice_area", from: null, to: "Trademark" },
        { field: "referral_source", from: null, to: "UGW" },
        { field: "referral_detail", from: null, to: "UGW" },
      ]),
    );
  });

  it("holds back a differing non-empty value under the default options, same as any other field", () => {
    const plan = planImport(
      [source({ practiceArea: "Trademark" })],
      stages,
      [existing({ practice_area: "Copyright" })],
    );
    const heldFields = plan.withheld.flatMap((w) => w.changes.map((c) => c.field));
    expect(heldFields).toContain("practice_area");
  });

  it("writes the overwrite only when the operator opts in", () => {
    const plan = planImport(
      [source({ practiceArea: "Trademark" })],
      stages,
      [existing({ practice_area: "Copyright" })],
      OVERWRITE,
    );
    expect(plan.updates[0].changes).toEqual(
      expect.arrayContaining([{ field: "practice_area", from: "Copyright", to: "Trademark" }]),
    );
  });
});
