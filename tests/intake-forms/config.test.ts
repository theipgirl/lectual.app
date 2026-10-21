import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOSING,
  INTRO_DEFAULTS,
  LIMITS,
  PACKS,
  defaultIntakeConfig,
  moveQuestion,
  normalizeDomain,
  parseIntakeConfig,
  publicConfig,
  reorderQuestion,
  togglePack,
  validateAllowedDomains,
  validateIntakeConfig,
} from "@/lib/intake-forms/config";

const UUID = "5b1f7c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("defaultIntakeConfig", () => {
  it("starts from the design: conversation, the Trademark pack plus a timing question, US federal trademark fit", () => {
    const c = defaultIntakeConfig([UUID]);
    expect(c.mode).toBe("conversation");
    expect(c.packs).toEqual(["Trademark"]);
    expect(c.questions.map((q) => q.text)).toEqual([...PACKS.Trademark, "When do you hope to launch or file?"]);
    expect(c.questions.slice(0, 3).every((q) => q.required && q.pack === "Trademark")).toBe(true);
    expect(c.fitIp).toEqual(["Trademark"]);
    expect(c.fitJur).toEqual(["US federal"]);
    expect(c.fitText).toBe("");
    expect(c.closing).toBe(DEFAULT_CLOSING);
    expect(c.visiblePackageIds).toEqual([UUID]);
    expect(new Set(c.questions.map((q) => q.id)).size).toBe(c.questions.length);
  });

  it("names no firm: the knows notes and firm name start blank", () => {
    const c = defaultIntakeConfig();
    expect(c.knows).toBe("");
    expect(c.firmName).toBe("");
    expect(JSON.stringify(c)).not.toMatch(/RPB/);
  });
});

describe("parseIntakeConfig", () => {
  it("fills a stored {} (0079's column default) with defaults", () => {
    const c = parseIntakeConfig({});
    expect(c.mode).toBe("conversation");
    expect(c.questions.length).toBe(4);
  });

  it("never throws on junk, and drops what it can't read", () => {
    expect(() => parseIntakeConfig(null)).not.toThrow();
    expect(() => parseIntakeConfig("x")).not.toThrow();
    const c = parseIntakeConfig({
      mode: "chat",
      theme: 7,
      fitIp: ["Trademark", "Nope"],
      colors: { lightBg: "red" },
      visiblePackageIds: [UUID, "not-a-uuid", UUID],
      questions: [{ id: "a", text: "Q" }, "bad", { id: "a", text: "dup" }],
    });
    expect(c.mode).toBe("conversation");
    expect(c.theme).toBe("auto");
    expect(c.fitIp).toEqual(["Trademark"]);
    expect(c.colors.lightBg).toBe("#FFFDF7");
    expect(c.visiblePackageIds).toEqual([UUID]);
    expect(c.questions).toEqual([{ id: "a", text: "Q", required: false, pack: null, edited: false }]);
  });

  it("keeps an explicitly empty question list empty", () => {
    expect(parseIntakeConfig({ questions: [] }).questions).toEqual([]);
  });
});

describe("validateIntakeConfig", () => {
  it("accepts the default config and drops blank question rows", () => {
    const c = defaultIntakeConfig();
    c.questions.push({ id: "blank1", text: "   ", required: false, pack: null, edited: true });
    const r = validateIntakeConfig(JSON.parse(JSON.stringify(c)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.questions.some((q) => q.id === "blank1")).toBe(false);
  });

  it("refuses over-long text rather than trimming it", () => {
    const c = { ...defaultIntakeConfig(), closing: "x".repeat(LIMITS.closing + 1) };
    const r = validateIntakeConfig(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/closing message/);
  });

  it("refuses bad colours, unknown modes, too many questions and bad package ids", () => {
    const base = defaultIntakeConfig();
    expect(validateIntakeConfig({ ...base, colors: { ...base.colors, darkAcc: "#12" } }).ok).toBe(false);
    expect(validateIntakeConfig({ ...base, mode: "ai-chat" }).ok).toBe(false);
    const many = Array.from({ length: LIMITS.questions + 1 }, (_, i) => ({ id: `q${i}`, text: "Q", required: false, pack: null, edited: false }));
    expect(validateIntakeConfig({ ...base, questions: many }).ok).toBe(false);
    expect(validateIntakeConfig({ ...base, visiblePackageIds: ["x"] }).ok).toBe(false);
    expect(validateIntakeConfig("nope").ok).toBe(false);
  });
});

describe("domains", () => {
  it("normalises URLs to hosts and keeps wildcards", () => {
    expect(normalizeDomain("https://www.Example.com/contact?x=1")).toBe("www.example.com");
    expect(normalizeDomain("*.example.com")).toBe("*.example.com");
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });
  it("rejects things that aren't domains", () => {
    for (const bad of ["", "localhost", "exa mple.com", "*.com", "-bad.com", "a.*.com", "javascript:alert(1)"]) {
      expect(normalizeDomain(bad)).toBeNull();
    }
  });
  it("caps the list at 0079's 25 and de-duplicates", () => {
    expect(validateAllowedDomains(["a.com", "A.com"])).toEqual({ ok: true, domains: ["a.com"] });
    expect(validateAllowedDomains(Array.from({ length: 26 }, (_, i) => `d${i}.com`)).ok).toBe(false);
    expect(validateAllowedDomains(["not a domain"]).ok).toBe(false);
  });
});

describe("question editing", () => {
  it("turning a pack on adds only questions not already asked", () => {
    const c = defaultIntakeConfig();
    const r = togglePack(c, "Patent");
    expect(r.added.length).toBe(PACKS.Patent.length);
    expect(r.config.packs).toEqual(["Trademark", "Patent"]);
    const again = togglePack({ ...r.config, packs: ["Trademark"] }, "Patent");
    expect(again.added.length).toBe(0);
  });

  it("turning a pack off removes its questions but keeps edited ones as the firm's own", () => {
    const c = defaultIntakeConfig();
    const edited = { ...c, questions: c.questions.map((q, i) => (i === 0 ? { ...q, text: "Mine now", edited: true } : q)) };
    const r = togglePack(edited, "Trademark");
    expect(r.removed).toBe(2);
    expect(r.kept).toBe(1);
    expect(r.config.packs).toEqual([]);
    expect(r.config.questions.map((q) => [q.text, q.pack])).toEqual([
      ["Mine now", null],
      ["When do you hope to launch or file?", null],
    ]);
  });

  it("moves and reorders", () => {
    const qs = defaultIntakeConfig().questions;
    expect(moveQuestion(qs, 0, -1)).toBe(qs);
    expect(moveQuestion(qs, 0, 1).map((q) => q.id)).toEqual([qs[1].id, qs[0].id, qs[2].id, qs[3].id]);
    expect(reorderQuestion(qs, qs[3].id, qs[0].id).map((q) => q.id)).toEqual([qs[3].id, qs[0].id, qs[1].id, qs[2].id]);
    expect(reorderQuestion(qs, "missing", qs[0].id)).toBe(qs);
  });
});

describe("publicConfig", () => {
  const config = {
    ...defaultIntakeConfig([UUID]),
    knows: "SECRET-NOTES our rates are negotiable",
    fitText: "SECRET-FIT no patents",
    office: "1 Main St, Miami, FL",
  };

  it("never carries the firm's private notes or fit criteria", () => {
    const p = publicConfig(config, { orgName: "Hartwell IP", receivesReferrals: true });
    const json = JSON.stringify(p);
    expect(json).not.toContain("SECRET");
    for (const key of ["knows", "fitIp", "fitJur", "fitText", "packs", "visiblePackageIds"]) expect(p).not.toHaveProperty(key);
    expect(json).not.toContain(UUID);
    for (const q of p.questions) expect(Object.keys(q).sort()).toEqual(["id", "required", "text"]);
  });

  it("fills blank intro copy from the standard wording and the firm's own name", () => {
    const p = publicConfig(config, { orgName: "Hartwell IP", receivesReferrals: false });
    expect(p.firmName).toBe("Hartwell IP");
    expect(p.headline).toBe(INTRO_DEFAULTS.headline);
    expect(p.disclaimer).toBe(INTRO_DEFAULTS.disclaimer);
    expect(p.referral).toBeNull();
  });

  it("adds the office and 4-7.22 disclosure only for referral firms", () => {
    const p = publicConfig({ ...config, firmName: "Hartwell" }, { orgName: "Hartwell IP", receivesReferrals: true });
    expect(p.referral?.office).toBe("1 Main St, Miami, FL");
    expect(p.referral?.disclosure).toMatch(/^You were referred to Hartwell through Lectual/);
    expect(p.referral?.disclosure).toMatch(/Lectual is not a law firm/);
  });
});

// ── Sprint 10: choice questions (F1, F2, F7) ─────────────────────────────────

describe("choice questions on save (F1)", () => {
  const base = () => JSON.parse(JSON.stringify(defaultIntakeConfig([UUID])));
  const withQuestions = (questions: unknown[]) => ({ ...base(), questions });
  const q = (over: Record<string, unknown> = {}) => ({ id: "qa", text: "Which do you have?", required: false, pack: null, edited: true, ...over });
  const errorsFor = (questions: unknown[]) => {
    const r = validateIntakeConfig(withQuestions(questions));
    return r.ok ? [] : r.errors;
  };

  it("accepts a single and a multi question with 2 to 12 valid options", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `Option ${i + 1}`);
    const r = validateIntakeConfig(
      withQuestions([q({ id: "qa", type: "single", options: ["Yes", "No"] }), q({ id: "qb", type: "multi", options: twelve }), q({ id: "qc", text: "Plain" })]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.questions[0]).toMatchObject({ type: "single", options: ["Yes", "No"] });
    expect(r.config.questions[1].options).toEqual(twelve);
  });

  it("trims option labels it keeps", () => {
    const r = validateIntakeConfig(withQuestions([q({ type: "single", options: ["  Yes ", "No"] })]));
    expect(r.ok && r.config.questions[0].options).toEqual(["Yes", "No"]);
  });

  it.each([
    ["fewer than 2 options", { type: "single", options: ["Only one"] }, /Question 1 needs at least 2 options\./],
    ["no options at all", { type: "multi" }, /Question 1 needs at least 2 options\./],
    ["more than 12 options", { type: "multi", options: Array.from({ length: 13 }, (_, i) => `O${i}`) }, /Question 1 can have at most 12 options\./],
    ["an empty label", { type: "single", options: ["Yes", "  "] }, /Option 2 of Question 1 is empty\./],
    ["a label over 120 characters", { type: "single", options: ["Yes", "x".repeat(121)] }, /Option 2 of Question 1 is longer than 120 characters\./],
    ["a label with a line break", { type: "single", options: ["Yes", "No\nway"] }, /Option 2 of Question 1 must be on one line\./],
    ["a duplicate label in another case", { type: "single", options: ["Yes", "yes"] }, /Question 1 lists "yes" more than once\./],
    ["an unknown type", { type: "radio", options: ["a", "b"] }, /Question 1 has a type we don't know/],
    ["options on a text question", { type: "text", options: ["a", "b"] }, /Question 1 is a text question, so it can't have options\./],
    ["options on a question with no type", { options: ["a", "b"] }, /Question 1 is a text question, so it can't have options\./],
    ["an option that is not text", { type: "single", options: ["Yes", 7] }, /Option 2 of Question 1 was not readable\./],
  ])("refuses %s with a sentence naming the question", (_name, over, message) => {
    const errors = errorsFor([q(over)]);
    expect(errors.some((e) => message.test(e))).toBe(true);
  });

  it("names the right question when it is not the first", () => {
    const errors = errorsFor([q({ id: "qa" }), q({ id: "qb" }), q({ id: "qc", type: "single", options: ["x"] })]);
    expect(errors).toContain("Question 3 needs at least 2 options.");
  });

  it("an option at exactly 120 characters, and exactly 2 or 12 options, pass", () => {
    expect(errorsFor([q({ type: "single", options: ["x".repeat(120), "y"] })])).toEqual([]);
    expect(errorsFor([q({ type: "multi", options: Array.from({ length: 12 }, (_, i) => `O${i}`) })])).toEqual([]);
  });

  it("a blank scratch row is dropped without its options being judged", () => {
    const r = validateIntakeConfig(withQuestions([q({ id: "qa", text: "  ", type: "single", options: ["", ""] }), q({ id: "qb" })]));
    expect(r.ok && r.config.questions.map((x) => x.id)).toEqual(["qb"]);
  });

  it("the existing limits still apply: 40 questions and 200 characters", () => {
    const many = Array.from({ length: 41 }, (_, i) => q({ id: `q${i}` }));
    expect(errorsFor(many)).toContain(`Keep it to ${LIMITS.questions} questions.`);
    expect(errorsFor([q({ text: "x".repeat(201) })])).toContain("Question 1 is longer than 200 characters.");
  });

  it("a save with only text questions and no type field still passes, and adds no keys", () => {
    const r = validateIntakeConfig(withQuestions([q(), q({ id: "qb", text: "Another" })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const x of r.config.questions) expect(Object.keys(x).sort()).toEqual(["edited", "id", "pack", "required", "text"]);
  });
});

describe("choice questions on read (F2)", () => {
  it("parses a question with no type as text, with the same fields as before", () => {
    const c = parseIntakeConfig({ questions: [{ id: "a", text: "Q" }, { id: "b", text: "Q2", required: true, pack: "Patent", edited: true }] });
    expect(c.questions).toEqual([
      { id: "a", text: "Q", required: false, pack: null, edited: false },
      { id: "b", text: "Q2", required: true, pack: "Patent", edited: true },
    ]);
    expect(parseIntakeConfig({}).questions.every((x) => !("type" in x) && !("options" in x))).toBe(true);
  });

  it("round-trips a choice question through save and parse, with its options in order", () => {
    const cfg = {
      ...defaultIntakeConfig([UUID]),
      questions: [
        { id: "qm", text: "Which?", required: true, pack: null, edited: true, type: "multi" as const, options: ["Word mark", "Logo", "Yes, I have one"] },
      ],
    };
    const saved = validateIntakeConfig(JSON.parse(JSON.stringify(cfg)));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const reread = parseIntakeConfig(JSON.parse(JSON.stringify(saved.config)));
    expect(reread.questions).toEqual(cfg.questions);
  });

  it("cuts over-long or surplus options on read, and drops the options of a text question", () => {
    const c = parseIntakeConfig({
      questions: [
        { id: "a", text: "Q", type: "single", options: ["x".repeat(130), "x".repeat(130), ...Array.from({ length: 20 }, (_, i) => `o${i}`)] },
        { id: "b", text: "T", type: "text", options: ["a", "b"] },
        { id: "c", text: "Odd", type: "radio", options: ["a", "b"] },
      ],
    });
    expect(c.questions[0].options).toHaveLength(12);
    expect(c.questions[0].options?.[0]).toHaveLength(120);
    expect(c.questions[1]).toEqual({ id: "b", text: "T", required: false, pack: null, edited: false });
    expect(c.questions[2]).toEqual({ id: "c", text: "Odd", required: false, pack: null, edited: false });
  });
});

describe("what a choice question sends to the browser (F7)", () => {
  it("carries the type and the option labels, and nothing private", () => {
    const config = {
      ...defaultIntakeConfig([UUID]),
      knows: "SECRET-NOTES",
      fitText: "SECRET-FIT",
      questions: [
        { id: "qt", text: "Free", required: true, pack: "Trademark" as const, edited: false },
        { id: "qs", text: "One", required: false, pack: null, edited: true, type: "single" as const, options: ["Yes", "No"] },
        { id: "qm", text: "Many", required: false, pack: "Patent" as const, edited: true, type: "multi" as const, options: ["A", "B"] },
      ],
    };
    const p = publicConfig(config, { orgName: "Hartwell IP", receivesReferrals: false });
    expect(p.questions).toEqual([
      { id: "qt", text: "Free", required: true },
      { id: "qs", text: "One", required: false, type: "single", options: ["Yes", "No"] },
      { id: "qm", text: "Many", required: false, type: "multi", options: ["A", "B"] },
    ]);
    const json = JSON.stringify(p);
    expect(json).not.toContain("SECRET");
    expect(json).not.toMatch(/"pack"|"edited"/);
  });
});
