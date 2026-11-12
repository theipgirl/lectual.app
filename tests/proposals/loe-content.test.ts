import { describe, it, expect } from "vitest";
import { publicContent } from "@/lib/proposals/public";
import { validateContent } from "@/lib/proposals/validate";
import { loeIsCurrent, withLoeSnapshot, type ApprovedLetter } from "@/lib/proposals/loe-snapshot";
import type { ProposalContent } from "@/lib/proposals/types";
import { faithe } from "./general-fixture";
import { sevetri } from "./fixture";

const LETTER: ApprovedLetter = { id: "11111111-1111-4111-8111-111111111111", kind: "trademark", version: 3, title: "Engagement letter", body: "Dear {{client_name}},\n\nSigned {{signed_date}}." };
const GENERAL: ApprovedLetter = { ...LETTER, id: "22222222-2222-4222-8222-222222222222", kind: "general" };

const withLoe = (c: ProposalContent, loe: unknown) => ({ ...c, loe }) as unknown as ProposalContent;
const errors = (c: unknown) => validateContent(c).filter((i) => i.level === "error");

describe("validateContent: the loe block", () => {
  it("accepts a well-formed block on a trademark and on a general proposal", () => {
    const tm = withLoeSnapshot(sevetri(), LETTER, true);
    expect(errors(tm).filter((i) => i.path.startsWith("loe"))).toEqual([]);
    const gen = withLoeSnapshot(faithe(), GENERAL, true);
    expect(errors(gen).filter((i) => i.path.startsWith("loe"))).toEqual([]);
  });

  it("the kind must equal the proposal's kind", () => {
    const bad = withLoe(sevetri(), { kind: "general", template_id: null, template_version: 1, title: "T", body: "b" });
    expect(errors(bad).map((i) => i.path)).toContain("loe.kind");
    const badGeneral = withLoe(faithe(), { kind: "trademark", template_id: null, template_version: 1, title: "T", body: "b" });
    expect(errors(badGeneral).map((i) => i.path)).toContain("loe.kind");
  });

  it("the body is 1 to 60,000 characters", () => {
    const mk = (body: unknown) => withLoe(sevetri(), { kind: "trademark", template_id: null, template_version: 1, title: "T", body });
    expect(errors(mk("")).map((i) => i.path)).toContain("loe.body");
    expect(errors(mk("a".repeat(60_001))).map((i) => i.path)).toContain("loe.body");
    expect(errors(mk("a")).filter((i) => i.path === "loe.body")).toEqual([]);
    expect(errors(mk("a".repeat(60_000))).filter((i) => i.path === "loe.body")).toEqual([]);
    expect(errors(mk(undefined)).map((i) => i.path)).toContain("loe.body");
  });

  it("a malformed block is an error", () => {
    for (const loe of ["a letter", 7, null, [], { kind: "trademark" }]) {
      expect(errors(withLoe(sevetri(), loe)).some((i) => i.path.startsWith("loe")), JSON.stringify(loe)).toBe(true);
    }
  });

  it("a body with an unknown merge field is an error", () => {
    const bad = withLoe(sevetri(), { kind: "trademark", template_id: null, template_version: 1, title: "T", body: "Dear {{nope}}" });
    expect(errors(bad).map((i) => i.path)).toContain("loe.body");
  });

  it("old content, with no loe key, validates with identical issues", () => {
    for (const make of [sevetri, faithe]) {
      const c = make();
      expect("loe" in c).toBe(false);
      expect(validateContent(c)).toEqual(validateContent(JSON.parse(JSON.stringify(c))));
    }
  });
});

describe("publicContent: the loe allow-list", () => {
  it("returns exactly title, body and kind, and drops template ids and any extra key", () => {
    const c = withLoe(sevetri(), {
      kind: "trademark",
      template_id: LETTER.id,
      template_version: 3,
      title: LETTER.title,
      body: LETTER.body,
      approved_by: "someone",
      internal_note: "staff only",
    });
    expect(publicContent(c).loe).toEqual({ title: LETTER.title, body: LETTER.body, kind: "trademark" });
  });

  it("returns exactly those keys for a general proposal too", () => {
    const c = withLoe(faithe(), { kind: "general", template_id: GENERAL.id, template_version: 1, title: "T", body: "B" });
    expect(Object.keys(publicContent(c).loe ?? {}).sort()).toEqual(["body", "kind", "title"]);
  });

  it("content without loe yields the same object as before", () => {
    for (const make of [sevetri, faithe]) {
      const out = publicContent(make());
      expect("loe" in out).toBe(false);
    }
    const withNoise = { ...sevetri(), loe: "not an object" } as unknown;
    expect("loe" in publicContent(withNoise)).toBe(false);
  });
});

describe("withLoeSnapshot", () => {
  it("attaches a copy from the approved template", () => {
    const out = withLoeSnapshot(sevetri(), LETTER, true);
    expect(out.loe).toEqual({ kind: "trademark", template_id: LETTER.id, template_version: 3, title: LETTER.title, body: LETTER.body });
    expect(errors(out).filter((i) => i.path.startsWith("loe"))).toEqual([]);
  });

  it("refreshes a stale copy", () => {
    const stale = withLoe(sevetri(), { kind: "trademark", template_id: "old", template_version: 1, title: "Old", body: "Old text" });
    const out = withLoeSnapshot(stale, LETTER, true);
    expect(out.loe?.template_version).toBe(3);
    expect(out.loe?.body).toBe(LETTER.body);
    expect(loeIsCurrent(out, LETTER)).toBe(true);
    expect(loeIsCurrent(stale, LETTER)).toBe(false);
  });

  it("removes the copy when not wanted, when there is no template, or when the template is the other kind", () => {
    const has = withLoeSnapshot(sevetri(), LETTER, true);
    expect("loe" in withLoeSnapshot(has, LETTER, false)).toBe(false);
    expect("loe" in withLoeSnapshot(has, null, true)).toBe(false);
    expect("loe" in withLoeSnapshot(has, GENERAL, true)).toBe(false);
    expect("loe" in withLoeSnapshot(withLoeSnapshot(faithe(), GENERAL, true), LETTER, true)).toBe(false);
  });

  it("never mutates its input", () => {
    const input = withLoe(sevetri(), { kind: "trademark", template_id: "x", template_version: 1, title: "T", body: "B" });
    const before = JSON.stringify(input);
    withLoeSnapshot(input, LETTER, true);
    withLoeSnapshot(input, LETTER, false);
    withLoeSnapshot(input, null, true);
    expect(JSON.stringify(input)).toBe(before);
    const plain = sevetri();
    const plainBefore = JSON.stringify(plain);
    const out = withLoeSnapshot(plain, LETTER, true);
    expect(JSON.stringify(plain)).toBe(plainBefore);
    expect(out).not.toBe(plain);
  });

  it("changes nothing but the loe key", () => {
    const plain = sevetri();
    const { loe, ...rest } = withLoeSnapshot(plain, LETTER, true);
    expect(loe).toBeDefined();
    expect(rest).toEqual(plain);
  });
});
