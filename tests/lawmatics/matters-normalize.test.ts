import { describe, it, expect } from "vitest";

import { normalizeMatterProspect } from "@/lib/lawmatics/matters-normalize";

/**
 * Mirrors tests/lawmatics/normalize.test.ts's structure. This module is a
 * deliberately smaller sibling of normalizeProspect — flat attributes only,
 * no `included` sideload — so these fixtures are built by hand rather than
 * reusing prospectsPayload's relationship scaffolding.
 */

type Raw = Record<string, unknown>;

function prospect(attrs: Raw, id: string | number = "4207"): Raw {
  return { type: "prospect", id, attributes: attrs };
}

describe("normalizeMatterProspect", () => {
  it("flattens the flat prospect attributes it needs", () => {
    const rec = prospect({
      name: "Verdant Bloom Botanicals — VERDANT BLOOM (Wordmark)",
      referral_source: "Google search",
      notes: "Client prefers email over phone.",
      created_at: "2026-01-14T09:30:00Z",
    });
    const p = normalizeMatterProspect(rec);
    expect(p).toEqual({
      lawmaticsId: "4207",
      matterName: "Verdant Bloom Botanicals — VERDANT BLOOM (Wordmark)",
      referralSource: "Google search",
      notes: "Client prefers email over phone.",
      createdAt: "2026-01-14T09:30:00.000Z",
    });
  });

  it("tries fallback key spellings for referral source", () => {
    expect(normalizeMatterProspect(prospect({ referralSource: "Referral" }))?.referralSource).toBe(
      "Referral",
    );
    expect(normalizeMatterProspect(prospect({ source: "Instagram" }))?.referralSource).toBe(
      "Instagram",
    );
    expect(normalizeMatterProspect(prospect({ lead_source: "Word of mouth" }))?.referralSource).toBe(
      "Word of mouth",
    );
  });

  it("tries fallback key spellings for notes", () => {
    expect(normalizeMatterProspect(prospect({ note: "Single note field" }))?.notes).toBe(
      "Single note field",
    );
    expect(normalizeMatterProspect(prospect({ description: "Description field" }))?.notes).toBe(
      "Description field",
    );
  });

  it("tries fallback key spellings for the matter name", () => {
    expect(normalizeMatterProspect(prospect({ matter_name: "Fallback Matter Name" }))?.matterName).toBe(
      "Fallback Matter Name",
    );
    expect(normalizeMatterProspect(prospect({ title: "Fallback Title" }))?.matterName).toBe(
      "Fallback Title",
    );
  });

  it("returns null for a record with no id — it could never be re-synced", () => {
    expect(normalizeMatterProspect({ attributes: { name: "Nameless" } })).toBeNull();
  });

  it("leaves referral_source, notes, and matterName null when absent, never invented", () => {
    const p = normalizeMatterProspect(prospect({}));
    expect(p).toMatchObject({ lawmaticsId: "4207", matterName: null, referralSource: null, notes: null });
  });

  it("wires sanitization through: control characters are stripped, whitespace collapsed", () => {
    const p = normalizeMatterProspect(
      prospect({ notes: "Client\x00 called\tabout   status" }),
    );
    expect(p?.notes).toBe("Client called about status");
  });

  it("caps notes length so a hostile payload can't bloat the row", () => {
    const p = normalizeMatterProspect(prospect({ notes: "x".repeat(20_000) }));
    expect(p?.notes?.length).toBeLessThanOrEqual(8000);
  });

  it("never fabricates a created_at — an unparseable date becomes null", () => {
    const p = normalizeMatterProspect(prospect({ created_at: "whenever" }));
    expect(p?.createdAt).toBeNull();
  });

  it("also accepts a flat (non-JSON:API-enveloped) record shape", () => {
    const p = normalizeMatterProspect({ id: "9", name: "Flat Shape Matter" });
    expect(p).toMatchObject({ lawmaticsId: "9", matterName: "Flat Shape Matter" });
  });
});
