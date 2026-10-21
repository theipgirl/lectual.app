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
import { defaultIntakeConfig, parseIntakeConfig, validateIntakeConfig } from "@/lib/intake-forms/config";
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
