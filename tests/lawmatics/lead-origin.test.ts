import { describe, it, expect } from "vitest";

import { leadOriginFromProspect, originAsMatterSource, prospectTagNames } from "@/lib/lawmatics/lead-origin";
import { normalizeProspect } from "@/lib/lawmatics/normalize";

type Raw = Record<string, unknown>;
const cfv = (o: { how?: string; by?: string; spec?: string }, named = true): Raw => {
  const v: Record<string, Raw> = {};
  if (o.how !== undefined) v["589386"] = { ...(named ? { name: "How did you hear about us?" } : {}), formatted_value: o.how };
  if (o.by !== undefined) v["491217"] = { ...(named ? { name: "Referred By" } : {}), formatted_value: o.by };
  if (o.spec !== undefined) v["491218"] = { ...(named ? { name: "Specify Source" } : {}), formatted_value: o.spec };
  return v;
};
const prospect = (o: { how?: string; by?: string; spec?: string; tags?: string[] } = {}, named = true): Raw => ({
  id: "1",
  attributes: { custom_field_values: cfv(o, named) },
  relationships: { tags: { data: (o.tags ?? []).map((_, i) => ({ type: "tags", id: `t${i}` })) } },
});
const tagMap = (tags: string[] = []) => new Map(tags.map((t, i) => [`t${i}`, t]));
const origin = (o: Parameters<typeof prospect>[0] = {}, named = true) => leadOriginFromProspect(prospect(o, named), tagMap(o.tags));

describe("leadOriginFromProspect", () => {
  it("tags come first: UGW, then event-year, then webinar", () => {
    expect(origin({ tags: ["UGW 2026"], how: "Referral", by: "Dean" })).toEqual({ source: "UGW", detail: "UGW 2026" });
    expect(origin({ tags: ["Story2Profit 2026"] })).toEqual({ source: "Event", detail: "Story2Profit 2026" });
    expect(origin({ tags: ["Spring Webinar"] })).toEqual({ source: "Event", detail: "Webinar" });
    expect(origin({ tags: ["Story2Profit 2026", "UGW 2026"] }).source).toBe("UGW");
  });
  it("Referral and Current Client", () => {
    expect(origin({ how: "Referral", by: "Dean Smith", spec: "x" })).toEqual({ source: "Referral", detail: "Dean Smith" });
    expect(origin({ how: "Referral", spec: "a friend" })).toEqual({ source: "Referral", detail: "a friend" });
    expect(origin({ how: "Current Client", by: "Ada" })).toEqual({ source: "Referral", detail: "Current client: Ada" });
    expect(origin({ how: "Current Client" })).toEqual({ source: "Referral", detail: "Current client" });
  });
  it("Event, Social media, Search Engine", () => {
    expect(origin({ how: "Event", spec: "Render ATL", by: "z" })).toEqual({ source: "Event", detail: "Render ATL" });
    expect(origin({ how: "Event", by: "Host" })).toEqual({ source: "Event", detail: "Host" });
    expect(origin({ how: "Social media", spec: "IG reel" })).toEqual({ source: "Instagram", detail: "IG reel" });
    expect(origin({ how: "Social media", spec: "TikTok" })).toEqual({ source: "Social media", detail: "TikTok" });
    expect(origin({ how: "Search Engine", spec: "google" })).toEqual({ source: "Search engine", detail: "google" });
  });
  it("Other and unknown answers", () => {
    expect(origin({ how: "Other", spec: "saw her on instagram" })).toEqual({ source: "Instagram", detail: "saw her on instagram" });
    expect(origin({ how: "Other", by: "Pat" })).toEqual({ source: "Referral", detail: "Pat" });
    expect(origin({ how: "Other", spec: "podcast" })).toEqual({ source: "Other", detail: "podcast" });
    expect(origin({ how: "Billboard" })).toEqual({ source: "Other", detail: null });
  });
  it("a multi-pick uses the highest-priority pick", () => {
    expect(origin({ how: "Event, Other", spec: "UGW booth" })).toEqual({ source: "Event", detail: "UGW booth" });
    expect(origin({ how: "Other, Referral", by: "Sam" }).source).toBe("Referral");
  });
  it("no answer: referred-by, then specify, then Source: Direct, then unknown", () => {
    expect(origin({ by: "Sam" })).toEqual({ source: "Referral", detail: "Sam" });
    expect(origin({ spec: "found you on IG" }).source).toBe("Instagram");
    expect(origin({ spec: "my friend told me" }).source).toBe("Referral");
    expect(origin({ spec: "a podcast" })).toEqual({ source: "Other", detail: "a podcast" });
    expect(origin({ tags: ["Source: Direct"] })).toEqual({ source: "Inbound", detail: "Direct" });
    expect(origin({})).toEqual({ source: null, detail: null });
    expect(leadOriginFromProspect({ id: "9" })).toEqual({ source: null, detail: null });
  });
  it("matches fields by name, so another firm's ids work", () => {
    const rec: Raw = { id: "1", attributes: { custom_field_values: { "111": { name: "How did you hear about us?", formatted_value: "Referral" }, "222": { name: "referred by", formatted_value: "Lee" } } } };
    expect(leadOriginFromProspect(rec)).toEqual({ source: "Referral", detail: "Lee" });
  });
  it("matches by a field-name map when the value carries only an id", () => {
    const rec: Raw = { id: "1", attributes: { custom_field_values: { "777": { formatted_value: "Search Engine" } } } };
    expect(leadOriginFromProspect(rec, undefined, new Map([["777", "How did you hear about us"]]))).toEqual({ source: "Search engine", detail: null });
  });
  it("falls back to the RPB ids when an entry has no name", () => {
    expect(origin({ how: "Event", spec: "UGW" }, false).source).toBe("Event");
    expect(origin({ how: "Referral", by: "Dean" }, false)).toEqual({ source: "Referral", detail: "Dean" });
  });
  it("skips the tag rules when tag names can't be read", () => {
    expect(leadOriginFromProspect(prospect({ tags: ["UGW 2026"], how: "Referral", by: "Dean" }), undefined)).toEqual({ source: "Referral", detail: "Dean" });
    expect(leadOriginFromProspect(prospect({ tags: ["UGW 2026"] }), new Map())).toEqual({ source: null, detail: null });
  });
  it("caps and cleans detail", () => {
    const o = origin({ how: "Referral", by: `  <b>Dean</b>\u0000 ${"x".repeat(400)}` });
    expect(o.detail!.length).toBeLessThanOrEqual(200);
    expect(o.detail).not.toMatch(/[<>\u0000]/);
  });
  it("never says Lawmatics", () => {
    for (const o of [{}, { how: "Other" }, { spec: "z" }, { tags: ["Source: Direct"] }]) expect(origin(o).source).not.toBe("Lawmatics");
  });
});

describe("prospectTagNames", () => {
  it("reads relationship ids, inline names and objects", () => {
    expect(prospectTagNames({ id: "1", attributes: { tags: ["A", { name: "B" }] } })).toEqual(["A", "B"]);
    expect(prospectTagNames(prospect({ tags: ["X"] }), tagMap(["X"]))).toEqual(["X"]);
  });
});

describe("originAsMatterSource", () => {
  it("formats Source (detail), Source, or null", () => {
    expect(originAsMatterSource({ source: "Referral", detail: "Dean" })).toBe("Referral (Dean)");
    expect(originAsMatterSource({ source: "Inbound", detail: null })).toBe("Inbound");
    expect(originAsMatterSource({ source: null, detail: null })).toBeNull();
  });
});

describe("normalizeProspect carries the origin", () => {
  it("sets origin from the custom fields and tag lookups", () => {
    const rec = { ...prospect({ how: "Referral", by: "Dean", tags: ["UGW 2026"] }), attributes: { first_name: "A", last_name: "B", email: "a@b.co", custom_field_values: cfv({ how: "Referral", by: "Dean" }) } };
    expect(normalizeProspect(rec, new Map(), { tagNames: tagMap(["UGW 2026"]) })!.origin).toEqual({ source: "UGW", detail: "UGW 2026" });
    expect(normalizeProspect(rec)!.origin).toEqual({ source: "Referral", detail: "Dean" });
  });
});
