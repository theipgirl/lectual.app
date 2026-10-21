import { describe, expect, it, vi } from "vitest";
import { calculateBoothScore } from "@/lib/assessment-card/score";
import {
  DEFAULT_ASSESSMENT,
  assessmentQuestions,
  parseAssessmentSettings,
  publicAssessment,
  scoreAssessmentAnswers,
  validateAssessmentSettings,
} from "@/lib/intake-forms/assessment";
import { defaultIntakeConfig, parseIntakeConfig, publicConfig, validateIntakeConfig } from "@/lib/intake-forms/config";
import { goLiveChecklist } from "@/lib/intake-forms/checklist";
import { intakeTags } from "@/lib/intake-forms/lawmatics-sync";
import { attachTags, createProspect, updateProspect, type FetchLike } from "@/lib/lawmatics/writes";

vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));

/**
 * The event assessment as an intake kind (lectual 0095): the card's settings,
 * server-side scoring, what reaches the browser, and the Lawmatics calls.
 */

// A complete, hot Brand & Business card: business, no entity, $500k–1M, wants help now.
const HOT = { "1": "business", "2": "no", "3": "4_10", "4": "500k_1m", "5": "no", "6": "no", "7": "none", "8": "right_away" };

describe("assessment settings", () => {
  it("defaults to the Brand & Business card with the score shown", () => {
    expect(parseAssessmentSettings(undefined)).toEqual(DEFAULT_ASSESSMENT);
    expect(defaultIntakeConfig().assessment.variant).toBe("business");
  });

  it("keeps wording only for questions on the chosen card", () => {
    const s = parseAssessmentSettings({ variant: "business", showScore: false, wording: { "2": { question: " Do you have an LLC? ", subtext: "" }, "999": { question: "x" } } });
    expect(s).toEqual({ variant: "business", showScore: false, wording: { "2": { question: "Do you have an LLC?", subtext: "" } } });
    expect(assessmentQuestions(s, "business").find((q) => q.id === 2)!.question).toBe("Do you have an LLC?");
  });

  it("refuses an unknown card, a foreign question id and over-long wording on save", () => {
    expect(validateAssessmentSettings({ variant: "nope", showScore: true })).toContain("Choose which assessment to run.");
    expect(validateAssessmentSettings({ variant: "business", showScore: true, wording: { "101": { question: "x" } } })).toHaveLength(1);
    expect(validateAssessmentSettings({ variant: "business", showScore: true, wording: { "2": { question: "x".repeat(201) } } })).toHaveLength(1);
    expect(validateAssessmentSettings(undefined)).toEqual([]);
  });

  it("round-trips through the intake config's own validation", () => {
    const cfg = { ...defaultIntakeConfig(), assessment: { variant: "ip", showScore: true, wording: {} } };
    const v = validateIntakeConfig(cfg);
    expect(v.ok && v.config.assessment.variant).toBe("ip");
    expect(parseIntakeConfig(JSON.parse(JSON.stringify(cfg))).assessment.variant).toBe("ip");
  });

  it("only asks an assessment's go-live item that makes sense for it", () => {
    const cfg = { ...defaultIntakeConfig(), fitText: "", questions: [] };
    const keys = goLiveChecklist(cfg, { receivesReferrals: false, agreementSigned: false, kind: "assessment" }).map((i) => i.key);
    expect(keys).toEqual(["closing"]);
    expect(goLiveChecklist(cfg, { receivesReferrals: false, agreementSigned: false }).map((i) => i.key)).toEqual(["fit", "closing", "questions"]);
  });
});

describe("what reaches the browser", () => {
  it("sends wording and choices but never points or categories", () => {
    const pub = publicAssessment(DEFAULT_ASSESSMENT);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("points");
    expect(json).not.toContain("category");
    expect(pub.business.length).toBeGreaterThan(5);
    expect(pub.trackQuestionId).toBe(1);
  });
});

describe("server scoring", () => {
  it("scores exactly as the booth card does, and keeps the temperature off the person's view", () => {
    const r = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, HOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const booth = calculateBoothScore({ 1: "business", 2: "no", 3: "4_10", 4: "500k_1m", 5: "no", 6: "no", 7: "none", 8: "right_away" });
    expect(r.value.score.score).toBe(booth.score);
    expect(r.value.score.temperature).toBe(booth.temperature);
    expect(Object.keys(r.value.view).sort()).toEqual(["band", "gaps", "nextStep", "score"]);
    expect(JSON.stringify(r.value.view)).not.toMatch(/hot|warm|cold/i);
    expect(r.value.answerList.find((a) => a.id === "2")?.answer).toBe("No");
  });

  it("refuses a missing answer or a choice the card doesn't offer", () => {
    const missing = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, { ...HOT, "5": undefined });
    expect(missing.ok).toBe(false);
    const forged = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, { ...HOT, "2": "yes-please" });
    expect(forged.ok).toBe(false);
    const multi = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, { ...HOT, "2": ["yes", "no"] });
    expect(multi.ok).toBe(false);
  });

  it("drops answers to questions the card wouldn't ask, and ignores a browser-sent score", () => {
    const r = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, { ...HOT, "999": "x", score: 100, temperature: "cold" });
    expect(r.ok && r.value.score.score).not.toBe(100);
    expect(r.ok && r.value.answerList.some((a) => a.id === "999")).toBe(false);
  });
});

describe("Lawmatics", () => {
  it("tags with the intake's source tag, plus the temperature once known, in the automation's exact words", () => {
    expect(intakeTags("UGW 2026")).toEqual(["UGW 2026"]);
    expect(intakeTags("UGW 2026", "hot")).toEqual(["UGW 2026", "Hot Lead"]);
    expect(intakeTags(null, "cold")).toEqual(["Cold Lead"]);
    expect(intakeTags("  ")).toEqual([]);
  });

  function fakeFetch(responses: { ok: boolean; status: number; body?: unknown }[]) {
    const calls: { url: string; method: string; body: unknown; auth: string }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init.method, body: JSON.parse(init.body), auth: init.headers.Authorization });
      const r = responses.shift() ?? { ok: true, status: 200, body: {} };
      return { ok: r.ok, status: r.status, json: async () => r.body ?? {}, text: async () => "" };
    };
    return { calls, fetchImpl };
  }

  it("creates the prospect with the firm's own token and reads its id", async () => {
    const { calls, fetchImpl } = fakeFetch([{ ok: true, status: 201, body: { data: { id: "19012877" } } }]);
    const r = await createProspect("firm-token", { firstName: "Ana", lastName: "Ruiz", email: "ana@example.com", source: "Intake — UGW 2026" }, fetchImpl);
    expect(r).toEqual({ ok: true, contactId: "19012877" });
    expect(calls[0]).toMatchObject({ method: "POST", auth: "Bearer firm-token", body: { first_name: "Ana", email: "ana@example.com", source: "Intake — UGW 2026" } });
    expect(calls[0].url).toMatch(/\/prospects$/);
  });

  it("attaches tags by name and updates the prospect with tags and the note", async () => {
    const { calls, fetchImpl } = fakeFetch([]);
    await attachTags("t", "19012877", ["UGW 2026", "Hot Lead"], fetchImpl);
    await updateProspect("t", "19012877", { tags: ["UGW 2026", "Hot Lead"], notes: [{ name: "Assessment", body: "…" }] }, fetchImpl);
    expect(calls[0]).toMatchObject({ method: "POST", body: { matter_id: 19012877, tags: ["UGW 2026", "Hot Lead"] } });
    expect(calls[0].url).toMatch(/\/tags\/attach$/);
    expect(calls[1]).toMatchObject({ method: "PUT", body: { tags: ["UGW 2026", "Hot Lead"], notes: [{ name: "Assessment", body: "…" }] } });
    expect(calls[1].url).toMatch(/\/prospects\/19012877$/);
  });

  it("never throws, and says whether a failure is worth retrying", async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, status: 503 }, { ok: false, status: 422 }]);
    expect(await attachTags("t", "1", ["x"], fetchImpl)).toMatchObject({ ok: false, retryable: true });
    expect(await attachTags("t", "1", ["x"], fetchImpl)).toMatchObject({ ok: false, retryable: false });
    const boom: FetchLike = async () => {
      throw new Error("network down");
    };
    expect(await createProspect("t", { firstName: "a", lastName: "b", email: "c@d.co" }, boom)).toMatchObject({ ok: false, retryable: true });
  });
});

// ── Sprint 10: the firm's own questions and hidden card questions (F7, F11) ───

describe("extra questions and hidden card questions on save (F11)", () => {
  const text = { id: "qtext1", text: "Where did you hear about us?", required: false, type: "text" as const };
  const single = { id: "qsingle1", text: "Do you have a logo?", required: true, type: "single" as const, options: ["Yes", "No"] };
  const multi = { id: "qmulti1", text: "What do you sell?", required: false, type: "multi" as const, options: ["Goods", "Services", "Software, apps"] };
  const settings = (over: Record<string, unknown> = {}) => ({ variant: "business", showScore: true, wording: {}, ...over });

  it("validates, stores and parses back an assessment with three extras and a hidden question", () => {
    const raw = settings({ extras: [text, single, multi], hidden: ["3"] });
    expect(validateAssessmentSettings(raw)).toEqual([]);
    const cfg = { ...defaultIntakeConfig(), assessment: raw };
    const saved = validateIntakeConfig(JSON.parse(JSON.stringify(cfg)));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.config.assessment).toEqual(raw);
    expect(parseIntakeConfig(JSON.parse(JSON.stringify(saved.config))).assessment).toEqual(raw);
  });

  it("parses old settings as no extras and nothing hidden, with no new keys", () => {
    const s = parseAssessmentSettings({ variant: "ip", showScore: false, wording: {} });
    expect(s).toEqual({ variant: "ip", showScore: false, wording: {} });
    expect("extras" in s || "hidden" in s).toBe(false);
  });

  it("refuses more than 10 extras", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ ...text, id: `qx${i}` }));
    expect(validateAssessmentSettings(settings({ extras: eleven }))).toContain("Keep your own questions to 10.");
  });

  it("refuses an extra id that is numeric, or duplicated, or unreadable", () => {
    expect(validateAssessmentSettings(settings({ extras: [{ ...text, id: "7" }] }))).toContain("Your question 1 was not readable.");
    expect(validateAssessmentSettings(settings({ extras: [{ ...text, id: "101" }] }))).toContain("Your question 1 was not readable.");
    expect(validateAssessmentSettings(settings({ extras: [text, { ...single, id: text.id }] }))).toContain("Your question 2 is a duplicate.");
    expect(validateAssessmentSettings(settings({ extras: [{ ...text, id: undefined }] }))).toContain("Your question 1 was not readable.");
  });

  it("refuses a choice extra with one option, an unknown type, or options on a text extra", () => {
    expect(validateAssessmentSettings(settings({ extras: [{ ...single, options: ["Only"] }] }))).toContain("Your question 1 needs at least 2 options.");
    expect(validateAssessmentSettings(settings({ extras: [{ ...text, type: "radio" }] })).join(" ")).toMatch(/type we don't know/);
    expect(validateAssessmentSettings(settings({ extras: [{ ...text, options: ["a", "b"] }] }))).toContain("Your question 1 is a text question, so it can't have options.");
  });

  it("drops a blank scratch extra on read and does not judge it on save", () => {
    const blank = { id: "qblank", text: "   ", required: false, type: "single" as const, options: [] };
    expect(validateAssessmentSettings(settings({ extras: [blank, text] }))).toEqual([]);
    expect(parseAssessmentSettings(settings({ extras: [blank, text] })).extras).toEqual([text]);
  });

  it("refuses to hide a scored question, an unscored one the score reads, or one that isn't on the card", () => {
    for (const id of ["1", "2", "4", "5", "6", "7", "8"]) {
      expect(validateAssessmentSettings(settings({ hidden: [id] })).join(" ")).toMatch(/That question affects the score and can't be hidden\./);
    }
    expect(validateAssessmentSettings(settings({ hidden: ["101"] }))).toContain("A hidden question isn't on this assessment.");
    expect(validateAssessmentSettings(settings({ hidden: [3] }))).toContain("The hidden questions were not readable.");
  });

  it("refuses to hide anything on the Trademark & Copyright card", () => {
    for (const id of ["101", "102", "103", "104", "105", "106", "107", "108", "109"]) {
      expect(validateAssessmentSettings(settings({ variant: "ip", hidden: [id] })).join(" ")).toMatch(/can't be hidden/);
    }
  });

  it("a changed card refuses or clears the old card's hidden list", () => {
    // Saved with the other card's hidden id: refused. Read back: cleared.
    expect(validateAssessmentSettings(settings({ variant: "ip", hidden: ["3"] }))).toContain("A hidden question isn't on this assessment.");
    expect(parseAssessmentSettings(settings({ variant: "ip", hidden: ["3"] })).hidden).toBeUndefined();
    expect(parseAssessmentSettings(settings({ hidden: ["3", "2", "999", 3] })).hidden).toEqual(["3"]);
  });
});

describe("what reaches the browser, extended (F7)", () => {
  const withExtras = { ...DEFAULT_ASSESSMENT, hidden: ["3"], extras: [{ id: "qx1", text: "Which event?", required: true, type: "single" as const, options: ["UGW", "Other"] }] };

  it("sends the extras and the card without the hidden question", () => {
    const pub = publicAssessment(withExtras);
    expect(pub.business.some((q) => q.id === 3)).toBe(false);
    expect(pub.brand.some((q) => q.id === 3)).toBe(false);
    expect(pub.business.some((q) => q.id === 4)).toBe(true);
    expect(pub.extras).toEqual([{ id: "qx1", text: "Which event?", required: true, type: "single", options: ["UGW", "Other"] }]);
  });

  it("still sends no points, categories, knows, fit criteria, pack or edited flags", () => {
    const cfg = { ...defaultIntakeConfig(), knows: "SECRET-NOTES", fitText: "SECRET-FIT", assessment: withExtras };
    const view = publicConfig(cfg, { orgName: "Hartwell", receivesReferrals: false });
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/points|category|SECRET|"knows"|"fitIp"|"fitText"|"pack"|"edited"|"hidden"|temperature/);
    expect(view.assessment.extras).toHaveLength(1);
  });

  it("sends an assessment with no extras an empty list", () => {
    expect(publicAssessment(DEFAULT_ASSESSMENT).extras).toEqual([]);
  });
});
