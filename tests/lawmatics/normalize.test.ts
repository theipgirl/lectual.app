import { describe, it, expect } from "vitest";

import {
  bag,
  field,
  idOf,
  includedIndex,
  metaTotalPages,
  records,
  relatedName,
} from "@/lib/lawmatics/jsonapi";
import {
  cleanEmail,
  cleanPhone,
  cleanText,
  cleanTimestamp,
  cleanWebsite,
  mergeContact,
  normalizeContact,
  normalizeProspect,
  splitName,
} from "@/lib/lawmatics/normalize";

import { contactRecord, prospectsPayload } from "../__fixtures__/lawmatics.fixture";

describe("jsonapi envelope readers", () => {
  it("pulls records out of a { data } envelope and a bare array alike", () => {
    const payload = prospectsPayload([{ id: "p1", matterName: "Verdant Bloom — Wordmark" }]);
    expect(records(payload)).toHaveLength(1);
    expect(records([{ id: "x" }])).toHaveLength(1);
    expect(records({ nope: true })).toEqual([]);
    expect(records(null)).toEqual([]);
  });

  it("reads attributes and flat records with the same accessor", () => {
    const enveloped = { id: "1", attributes: { name: "Enveloped" } };
    const flat = { id: "2", name: "Flat" };
    expect(field(enveloped, "name")).toBe("Enveloped");
    expect(field(flat, "name")).toBe("Flat");
    expect(bag(flat)).toBe(flat);
  });

  it("stringifies numeric ids so they can be used as a stable key", () => {
    expect(idOf({ id: 4207 })).toBe("4207");
    expect(idOf({ id: "  p-9 " })).toBe("p-9");
    expect(idOf({})).toBeNull();
  });

  it("resolves a relationship through `included` (the only way stage is exposed)", () => {
    const payload = prospectsPayload([
      { id: "p1", matterName: "Verdant Bloom — Wordmark", stage: "Application Filed" },
    ]);
    const index = includedIndex(payload);
    const [rec] = records(payload);
    expect(relatedName(rec, "stage", index)).toBe("Application Filed");
    // Without the sideload index there is simply nothing to read — null, never a guess.
    expect(relatedName(rec, "stage", new Map())).toBeNull();
  });

  it("reads a total page count in any of the spellings the API has used", () => {
    expect(metaTotalPages({ meta: { total_pages: 3 } })).toBe(3);
    expect(metaTotalPages({ meta: { page_count: "7" } })).toBe(7);
    expect(metaTotalPages({ meta: {} })).toBeNull();
    expect(metaTotalPages({})).toBeNull();
  });
});

describe("sanitizers — every imported field is untrusted", () => {
  it("strips control characters and collapses whitespace", () => {
    expect(cleanText("Marisol\u0000\tVega\n", 100)).toBe("Marisol Vega");
  });

  it("strips zero-width and bidi-override characters", () => {
    expect(cleanText("Ma\u200Bri\u202Esol", 100)).toBe("Marisol");
  });

  it("caps length so a hostile payload can't bloat a row", () => {
    expect(cleanText("x".repeat(5000), 120)).toHaveLength(120);
  });

  it("returns null rather than an empty string", () => {
    expect(cleanText("   ", 20)).toBeNull();
    expect(cleanText(undefined, 20)).toBeNull();
    expect(cleanText({}, 20)).toBeNull();
  });

  it("accepts real emails, lowercases them, and rejects everything else", () => {
    expect(cleanEmail(" Marisol@Verdant-Bloom.CO ")).toBe("marisol@verdant-bloom.co");
    expect(cleanEmail("not an email")).toBeNull();
    expect(cleanEmail("two@@at.com")).toBeNull();
    expect(cleanEmail("no-domain@localhost")).toBeNull();
    expect(cleanEmail("a@b.com, c@d.com")).toBeNull();
  });

  it("keeps only phone-shaped characters and requires at least one digit", () => {
    expect(cleanPhone("+1 (305) 555-0134 x22")).toBe("+1 (305) 555-0134 x22");
    expect(cleanPhone("call me")).toBeNull();
  });

  it("rejects non-http(s) 'websites' outright — a javascript: URL must never become a link", () => {
    expect(cleanWebsite("javascript:alert(1)")).toBeNull();
    expect(cleanWebsite("data:text/html,<script>")).toBeNull();
    expect(cleanWebsite("file:///etc/passwd")).toBeNull();
  });

  it("upgrades a bare domain to https and keeps absolute URLs", () => {
    expect(cleanWebsite("verdantbloom.co")).toBe("https://verdantbloom.co/");
    expect(cleanWebsite("http://verdantbloom.co/shop")).toBe("http://verdantbloom.co/shop");
    expect(cleanWebsite("notadomain")).toBeNull();
  });

  it("normalizes timestamps and never fabricates one", () => {
    expect(cleanTimestamp("2026-01-14T09:30:00Z")).toBe("2026-01-14T09:30:00.000Z");
    expect(cleanTimestamp("whenever")).toBeNull();
    expect(cleanTimestamp(null)).toBeNull();
  });

  it("splits a single display name, treating a mononym as the surname", () => {
    expect(splitName("Marisol Vega")).toEqual({ first: "Marisol", last: "Vega" });
    expect(splitName("Ana Lucia Reyes Ortiz")).toEqual({
      first: "Ana Lucia Reyes",
      last: "Ortiz",
    });
    expect(splitName("Bjornsson")).toEqual({ first: null, last: "Bjornsson" });
  });
});

describe("normalizeProspect", () => {
  const payload = prospectsPayload(
    [
      {
        id: "4207",
        matterName: "Verdant Bloom Botanicals — VERDANT BLOOM (Wordmark)",
        firstName: "Marisol",
        lastName: "Vega",
        stage: "Application Filed",
        practiceArea: "Trademark",
        contactId: "c-88",
        createdAt: "2026-01-14T09:30:00Z",
        updatedAt: "2026-06-02T16:05:00Z",
      },
    ],
    {
      contacts: [
        {
          id: "c-88",
          email: "marisol@verdantbloom.co",
          phone: "+1 (305) 555-0134",
          company: "Verdant Bloom Botanicals",
          website: "verdantbloom.co",
        },
      ],
    },
  );

  it("flattens a JSON:API prospect, pulling stage and contact out of relationships", () => {
    const [rec] = records(payload);
    const p = normalizeProspect(rec, includedIndex(payload));
    expect(p).not.toBeNull();
    expect(p).toMatchObject({
      lawmaticsId: "4207",
      firstName: "Marisol",
      lastName: "Vega",
      email: "marisol@verdantbloom.co",
      phone: "+1 (305) 555-0134",
      businessName: "Verdant Bloom Botanicals",
      website: "https://verdantbloom.co/",
      stageName: "Application Filed",
      practiceArea: "Trademark",
      contactId: "c-88",
    });
  });

  it("returns null for a record with no id — it could never be re-synced", () => {
    expect(normalizeProspect({ attributes: { name: "Nameless" } })).toBeNull();
  });

  it("leaves the stage null when the relationship isn't sideloaded", () => {
    const [rec] = records(payload);
    expect(normalizeProspect(rec, new Map())?.stageName).toBeNull();
  });

  it("falls back to splitting the matter name when there are no name attributes", () => {
    const bare = prospectsPayload([{ id: "9", matterName: "Dashiell Okonkwo" }]);
    const p = normalizeProspect(records(bare)[0], includedIndex(bare));
    expect(p?.firstName).toBe("Dashiell");
    expect(p?.lastName).toBe("Okonkwo");
  });
});

describe("normalizeContact + mergeContact", () => {
  it("sanitizes a contact record", () => {
    const c = normalizeContact(
      contactRecord({
        id: "c-2",
        firstName: "Theo",
        lastName: "Halloran",
        email: "THEO@Halloran.Studio",
        phone: "3055550188",
        company: "Halloran Studio",
      }),
    );
    expect(c).toMatchObject({
      lawmaticsId: "c-2",
      firstName: "Theo",
      email: "theo@halloran.studio",
      businessName: "Halloran Studio",
    });
  });

  it("only ever fills blanks — a contact can never overwrite or erase a prospect value", () => {
    const base = {
      lawmaticsId: "1",
      matterName: "M",
      firstName: "Marisol",
      lastName: null,
      email: null,
      phone: null,
      businessName: null,
      website: null,
      stageName: null,
      practiceArea: null,
      createdAt: null,
      updatedAt: null,
      contactId: "c-1",
      referralSource: null,
    };
    const merged = mergeContact(base, {
      lawmaticsId: "c-1",
      firstName: "OVERWRITE ME",
      lastName: "Vega",
      email: "marisol@verdantbloom.co",
      phone: null,
      businessName: null,
      website: null,
    });
    expect(merged.firstName).toBe("Marisol");
    expect(merged.lastName).toBe("Vega");
    expect(merged.email).toBe("marisol@verdantbloom.co");
  });

  it("is a no-op when there is no matching contact", () => {
    const base = normalizeProspect({ id: "5", attributes: { name: "Solo Matter" } })!;
    expect(mergeContact(base, undefined)).toBe(base);
  });
});

describe("normalizeProspect — referralSource (§4.2/§6)", () => {
  // prospectsPayload's FixtureProspect has no slot for an arbitrary attribute
  // like referral_source, so these build the raw JSON:API record by hand
  // rather than editing the shared fixture (owned by a sibling task).
  function prospectRaw(attrs: Record<string, unknown>): Record<string, unknown> {
    return { type: "prospect", id: "9500", attributes: { name: "Solo Matter", ...attrs } };
  }

  it("reads referral_source when present", () => {
    const p = normalizeProspect(prospectRaw({ referral_source: "Instagram" }));
    expect(p?.referralSource).toBe("Instagram");
  });

  it("falls back through source, lead_source, referred_by in order", () => {
    expect(normalizeProspect(prospectRaw({ source: "UGW" }))?.referralSource).toBe("UGW");
    expect(normalizeProspect(prospectRaw({ lead_source: "Event (Render ATL)" }))?.referralSource).toBe(
      "Event (Render ATL)",
    );
    expect(normalizeProspect(prospectRaw({ referred_by: "Friend/PDM" }))?.referralSource).toBe(
      "Friend/PDM",
    );
  });

  it("prefers referral_source over the other spellings when more than one is present", () => {
    const p = normalizeProspect(prospectRaw({ referral_source: "Instagram", source: "UGW" }));
    expect(p?.referralSource).toBe("Instagram");
  });

  it("is null, not empty, when Lawmatics exposes none of these attributes", () => {
    expect(normalizeProspect(prospectRaw({}))?.referralSource).toBeNull();
  });

  it("sanitizes referralSource the same way every other text field is sanitized", () => {
    const p = normalizeProspect(prospectRaw({ referral_source: "  UGW  2026  " }));
    expect(p?.referralSource).toBe("UGW 2026");
  });

  it("mergeContact leaves referralSource untouched — a contact has no notion of it", () => {
    const base = normalizeProspect(prospectRaw({ referral_source: "Instagram" }))!;
    const merged = mergeContact(base, {
      lawmaticsId: "c-1",
      firstName: null,
      lastName: null,
      email: "x@example.com",
      phone: null,
      businessName: null,
      website: null,
    });
    expect(merged.referralSource).toBe("Instagram");
  });
});
