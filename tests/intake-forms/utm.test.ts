import { describe, expect, it } from "vitest";
import { CHANNEL_PRESETS, campaignFromSourceTag, channelLinks, hasUtm, parseUtm, sourceLabel, utmFromContact, utmReferralPart, utmTags } from "@/lib/intake-forms/utm";

describe("parseUtm", () => {
  it("keeps the four keys and trims them", () => {
    expect(parseUtm({ utm_source: " ig ", utm_medium: "social", utm_campaign: "UGW-2026", utm_content: "link_in_bio" })).toEqual({
      source: "ig",
      medium: "social",
      campaign: "UGW-2026",
      content: "link_in_bio",
    });
  });

  it("ignores fbclid, gclid and every other key", () => {
    expect(parseUtm({ utm_source: "fb", fbclid: "abc", gclid: "def", utm_term: "x", embed: "1" })).toEqual({ source: "fb" });
  });

  it("drops a value whole when it is over 64 characters or outside [A-Za-z0-9_.-]", () => {
    expect(parseUtm({ utm_source: "a".repeat(64) })).toEqual({ source: "a".repeat(64) });
    expect(parseUtm({ utm_source: "a".repeat(65) })).toEqual({});
    for (const bad of ["two words", "<script>", "50%", 'q"uote', "it's", "café", "a/b", "", "   "]) {
      expect(parseUtm({ utm_campaign: bad })).toEqual({});
    }
  });

  it("takes the first of a string array, and the clean ones beside a dirty one", () => {
    expect(parseUtm({ utm_source: ["ig", "li"], utm_medium: "bad value" })).toEqual({ source: "ig" });
  });

  it("returns {} for junk", () => {
    for (const junk of [null, undefined, 7, "utm_source=ig", ["utm_source"], true]) expect(parseUtm(junk)).toEqual({});
    expect(parseUtm({ utm_source: 5, utm_medium: { a: 1 } })).toEqual({});
  });

  it("round-trips its own output (a stored or posted { source, ... })", () => {
    const u = { source: "ig", medium: "social", campaign: "UGW-2026" };
    expect(parseUtm(u)).toEqual(u);
    expect(utmFromContact({ name: "A", utm: u })).toEqual(u);
    expect(utmFromContact({ name: "A" })).toEqual({});
    expect(utmFromContact("nope")).toEqual({});
  });
});

describe("utm text", () => {
  it("builds the referral part in source / medium / content / campaign order, leaving absent parts out", () => {
    expect(utmReferralPart({ source: "ig", medium: "social", content: "link_in_bio", campaign: "UGW-2026" })).toBe("ig / social / link_in_bio / UGW-2026");
    expect(utmReferralPart({ source: "li" })).toBe("li");
    expect(utmReferralPart({})).toBeNull();
    expect(hasUtm({})).toBe(false);
    expect(hasUtm({ campaign: "x" })).toBe(true);
  });

  it("makes Lawmatics tags", () => {
    expect(utmTags({ source: "ig", campaign: "UGW-2026", medium: "social" })).toEqual(["UTM: ig", "Campaign: UGW-2026"]);
    expect(utmTags({ medium: "social" })).toEqual([]);
  });
});

describe("channel links", () => {
  const ORIGIN = "https://app.lectual.app/";
  const links = channelLinks("ugw-2026", "UGW 2026", ORIGIN);

  it("has the seven presets with their source and medium", () => {
    expect(links.map((l) => [l.label, l.utm.source, l.utm.medium])).toEqual([
      ["Instagram bio", "ig", "social"],
      ["LinkedIn", "li", "social"],
      ["Facebook", "fb", "social"],
      ["TikTok", "tt", "social"],
      ["Website", "web", "website"],
      ["Email signature", "email", "website"],
      ["Event QR", "event", "event"],
    ]);
    expect(CHANNEL_PRESETS).toHaveLength(7);
  });

  it("builds /i/<slug> URLs that parse back to exactly the intended values", () => {
    for (const l of links) {
      const url = new URL(l.url);
      expect(url.origin + url.pathname).toBe("https://app.lectual.app/i/ugw-2026");
      expect(parseUtm(Object.fromEntries(url.searchParams))).toEqual(l.utm);
      expect(l.utm.campaign).toBe("UGW-2026");
    }
    expect(links[0].utm.content).toBe("link_in_bio");
    expect(links[1].utm.content).toBeUndefined();
  });

  it("converts a source tag into a campaign that survives parsing, and omits it with no tag", () => {
    expect(campaignFromSourceTag("UGW 2026")).toBe("UGW-2026");
    expect(campaignFromSourceTag("  Booth: Miami #1 ")).toBe("Booth-Miami-1");
    expect(campaignFromSourceTag("x".repeat(100))).toHaveLength(64);
    expect(campaignFromSourceTag("###")).toBeNull();
    expect(campaignFromSourceTag(null)).toBeNull();
    for (const l of channelLinks("ugw-2026", null, ORIGIN)) {
      expect(l.url).not.toContain("utm_campaign");
      expect(l.utm.campaign).toBeUndefined();
    }
  });

  it("names a known source and shows an unknown one as typed", () => {
    expect(sourceLabel("ig")).toBe("Instagram bio");
    expect(sourceLabel("newsletter")).toBe("newsletter");
  });
});
