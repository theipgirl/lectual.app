import { describe, it, expect } from "vitest";

import {
  planMattersImport,
  type ExistingMatter,
} from "@/lib/lawmatics/matters-import-plan";
import type { LawmaticsMatterSourceRecord } from "@/lib/lawmatics/matters-normalize";

/** Mirrors tests/lawmatics/import-plan.test.ts's builder-function structure. */
function source(overrides: Partial<LawmaticsMatterSourceRecord> = {}): LawmaticsMatterSourceRecord {
  return {
    lawmaticsId: "4207",
    matterName: "Verdant Bloom Botanicals — VERDANT BLOOM",
    referralSource: "Google search",
    notes: "Wants an expedited filing.",
    createdAt: "2026-01-14T09:30:00.000Z",
    ...overrides,
  };
}

function matter(overrides: Partial<ExistingMatter> = {}): ExistingMatter {
  return {
    id: "matter-1",
    matter_number: "TM-2026-0001",
    title: "Verdant Bloom Botanicals — VERDANT BLOOM",
    mark_text: "VERDANT BLOOM",
    notes: null,
    referral_source: null,
    lawmatics_id: null,
    // Realistic default: crm_matter.opened_at is NOT NULL in the live schema
    // (see ExistingMatter's doc comment). Tests exercising the opened_at
    // null-only guard override this explicitly.
    opened_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("planMattersImport — primary match: lawmatics_id", () => {
  it("matches an already-linked matter by lawmatics_id", () => {
    const plan = planMattersImport([source()], [matter({ lawmatics_id: "4207" })]);
    expect(plan.totals.update).toBe(1);
    expect(plan.updates[0]).toMatchObject({ matterId: "matter-1", matchedBy: "lawmatics_id" });
  });

  it("linked but nothing blank to fill lands in unchanged, not update", () => {
    const plan = planMattersImport(
      [source()],
      [
        matter({
          lawmatics_id: "4207",
          referral_source: "Google search",
          notes: "Wants an expedited filing.",
        }),
      ],
    );
    expect(plan.totals.update).toBe(0);
    expect(plan.totals.unchanged).toBe(1);
  });
});

describe("planMattersImport — fallback match: name-based, unlinked matters only", () => {
  it("matches by normalized title when unlinked and unambiguous", () => {
    const plan = planMattersImport(
      [source({ matterName: "verdant bloom botanicals verdant bloom" })],
      [matter()],
    );
    expect(plan.totals.update).toBe(1);
    expect(plan.updates[0]).toMatchObject({ matterId: "matter-1", matchedBy: "title", linksRecord: true });
  });

  it("falls back to normalized mark_text when title doesn't match", () => {
    const plan = planMattersImport(
      [source({ matterName: "VERDANT BLOOM" })],
      [matter({ title: "Something Else Entirely" })],
    );
    expect(plan.totals.update).toBe(1);
    expect(plan.updates[0]).toMatchObject({ matchedBy: "mark_text" });
  });

  it("falls back to normalized matter_number as a last resort", () => {
    const plan = planMattersImport(
      [source({ matterName: "TM-2026-0001" })],
      [matter({ title: "Something Else", mark_text: "Something Else Mark" })],
    );
    expect(plan.totals.update).toBe(1);
    expect(plan.updates[0]).toMatchObject({ matchedBy: "matter_number" });
  });

  it("an ambiguous title match (2+ unlinked candidates) is unmapped, never guessed", () => {
    const plan = planMattersImport(
      [source()],
      [
        matter({ id: "matter-1", title: "Verdant Bloom Botanicals — VERDANT BLOOM" }),
        matter({ id: "matter-2", title: "Verdant Bloom Botanicals — VERDANT BLOOM" }),
      ],
    );
    expect(plan.totals.update).toBe(0);
    expect(plan.unmapped).toHaveLength(1);
    expect(plan.unmapped[0].reason).toMatch(/ambiguous/i);
  });

  it("stops at the first ambiguous bucket rather than trying mark_text next", () => {
    // Two candidates share the title AND one of them also uniquely matches
    // mark_text — the ambiguity in bucket 1 (title) must still win; falling
    // through to a false "unique" match in bucket 2 would be worse than not
    // matching at all.
    const plan = planMattersImport(
      [source({ matterName: "Shared Title" })],
      [
        matter({ id: "matter-1", title: "Shared Title", mark_text: "UNIQUE MARK" }),
        matter({ id: "matter-2", title: "Shared Title", mark_text: "Other Mark" }),
      ],
    );
    expect(plan.unmapped).toHaveLength(1);
    expect(plan.unmapped[0].reason).toMatch(/title/i);
  });

  it("no match at all is unmapped, with a manual-review reason", () => {
    const plan = planMattersImport(
      [source({ matterName: "Nothing Like This Exists" })],
      [matter({ title: "Totally Different", mark_text: "ALSO DIFFERENT", matter_number: "TM-2026-9999" })],
    );
    expect(plan.unmapped).toHaveLength(1);
    expect(plan.unmapped[0].reason).toMatch(/never creates matters/i);
  });

  it("no matterName on the incoming record is also unmapped (nothing to compare)", () => {
    const plan = planMattersImport([source({ matterName: null })], [matter()]);
    expect(plan.unmapped).toHaveLength(1);
  });

  it("a matter already linked to a DIFFERENT lawmatics_id is never touched by name-matching", () => {
    const plan = planMattersImport(
      [source({ lawmaticsId: "9999" })],
      [matter({ lawmatics_id: "1111" })], // linked to someone else, name would otherwise match
    );
    expect(plan.totals.update).toBe(0);
    expect(plan.unmapped).toHaveLength(1);
  });
});

describe("planMattersImport — never creates, claim tracking within one pull", () => {
  it("two incoming records both matching the same existing matter: the second is skipped", () => {
    const plan = planMattersImport(
      [source({ lawmaticsId: "1" }), source({ lawmaticsId: "2" })],
      [matter()],
    );
    expect(plan.totals.update).toBe(1);
    expect(plan.updates[0].lawmaticsId).toBe("1");
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({ lawmaticsId: "2" });
    expect(plan.skipped[0].reason).toMatch(/already matches this matter/i);
  });

  it("a duplicate lawmaticsId within one pull is skipped", () => {
    const plan = planMattersImport([source(), source()], [matter({ lawmatics_id: "4207" })]);
    expect(plan.totals.update).toBe(1);
    expect(plan.skipped[0].reason).toMatch(/duplicate/i);
  });

  it("a record with no lawmaticsId is skipped", () => {
    const plan = planMattersImport([source({ lawmaticsId: "" })], [matter()]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toMatch(/no id/i);
  });
});

describe("planMattersImport — null-only field guards", () => {
  it("fills a blank referral_source, never overwrites a non-blank one", () => {
    const filled = planMattersImport(
      [source({ referralSource: "Google search" })],
      [matter({ lawmatics_id: "4207", referral_source: null })],
    );
    expect(filled.updates[0].changes).toContainEqual({
      field: "referral_source",
      from: null,
      to: "Google search",
    });

    const withheld = planMattersImport(
      [source({ referralSource: "Google search" })],
      [matter({ lawmatics_id: "4207", referral_source: "Referred by existing client" })],
    );
    const fields = withheld.updates.flatMap((u) => u.changes.map((c) => c.field));
    expect(fields).not.toContain("referral_source");
  });

  it("fills a blank notes, never overwrites a non-blank one", () => {
    const filled = planMattersImport(
      [source({ notes: "Wants expedited filing" })],
      [matter({ lawmatics_id: "4207", notes: null })],
    );
    expect(filled.updates[0].changes).toContainEqual({
      field: "notes",
      from: null,
      to: "Wants expedited filing",
    });

    const withheld = planMattersImport(
      [source({ notes: "Wants expedited filing" })],
      [matter({ lawmatics_id: "4207", notes: "Staff-entered note already here" })],
    );
    const fields = withheld.updates.flatMap((u) => u.changes.map((c) => c.field));
    expect(fields).not.toContain("notes");
  });

  it("fills a blank opened_at, never overwrites a non-blank one — presently unreachable against the live NOT-NULL column, tested via the widened nullable type", () => {
    const filled = planMattersImport(
      [source({ createdAt: "2026-01-14T09:30:00.000Z" })],
      [matter({ lawmatics_id: "4207", opened_at: null })],
    );
    expect(filled.updates[0].changes).toContainEqual({
      field: "opened_at",
      from: null,
      to: "2026-01-14T09:30:00.000Z",
    });

    const withheld = planMattersImport(
      [source({ createdAt: "2026-01-14T09:30:00.000Z" })],
      [matter({ lawmatics_id: "4207", opened_at: "2025-06-01T00:00:00.000Z" })],
    );
    const fields = withheld.updates.flatMap((u) => u.changes.map((c) => c.field));
    expect(fields).not.toContain("opened_at");
  });

  it("writes lawmatics_id (and marks linksRecord) only on the first link, when it's currently null", () => {
    const plan = planMattersImport(
      [source({ matterName: "verdant bloom botanicals verdant bloom" })],
      [matter({ lawmatics_id: null })],
    );
    expect(plan.updates[0].changes).toContainEqual({
      field: "lawmatics_id",
      from: null,
      to: "4207",
    });
    expect(plan.updates[0].linksRecord).toBe(true);
  });
});

describe("planMattersImport — accounting and fingerprint", () => {
  it("every input record lands in exactly one bucket", () => {
    const plan = planMattersImport(
      [
        source({ lawmaticsId: "1" }),
        source({ lawmaticsId: "2", matterName: "Nothing Matches Anything" }),
        source({ lawmaticsId: "" }),
      ],
      [matter({ lawmatics_id: "1" })],
    );
    const { update, unchanged, unmapped, skipped } = plan.totals;
    expect(update + unchanged + unmapped + skipped).toBe(3);
    expect(plan.totals.sourceRecords).toBe(3);
  });

  it("fingerprint changes when a matched field's value changes", () => {
    const base = planMattersImport(
      [source({ referralSource: "Google search" })],
      [matter({ lawmatics_id: "4207" })],
    ).fingerprint;
    const changed = planMattersImport(
      [source({ referralSource: "Referral" })],
      [matter({ lawmatics_id: "4207" })],
    ).fingerprint;
    expect(base).not.toBe(changed);
  });

  it("fingerprint is stable under input reordering", () => {
    const one = source({ lawmaticsId: "1" });
    const two = source({ lawmaticsId: "2", matterName: "Different Matter Name" });
    const existing = [matter({ id: "matter-1", lawmatics_id: "1" }), matter({ id: "matter-2" })];
    const a = planMattersImport([one, two], existing).fingerprint;
    const b = planMattersImport([two, one], existing).fingerprint;
    expect(a).toBe(b);
  });
});
