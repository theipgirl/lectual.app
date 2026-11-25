import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiOutputError } from "@/lib/ai/claude";
import type { StructuredCall } from "@/lib/ai/claude";
import { groundPlan, judgeConsult, judgmentConsistent, markIsGrounded, normalizeMark, packageNamesOf, planRoute, type JudgeDeps } from "@/lib/consult-prep/judge/judge";
import type { Judgment, RoutePlan } from "@/lib/consult-prep/judge/schemas";
import {
  DISPUTE_JUDGMENT,
  FIRM,
  GENERAL_JUDGMENT,
  GENERAL_PLAN,
  OTHER_PACKAGES,
  PACKAGES,
  TRADEMARK_FACTS,
  TRADEMARK_JUDGMENT,
  TRADEMARK_PLAN,
  llmReturning,
  llmThrowing,
  scriptedLlm,
} from "./fixtures";

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network is not allowed in judge tests");
  });
});
afterEach(() => vi.unstubAllGlobals());

const deps = (llm: StructuredCall, packages = PACKAGES): JudgeDeps => ({ llm, firm: FIRM, packages });
const PLAN = groundPlan(TRADEMARK_PLAN, TRADEMARK_FACTS);
const NAMES = packageNamesOf(PACKAGES);

const judge = (j: unknown, plan = PLAN, packages = PACKAGES) => judgeConsult(deps(llmReturning(j), packages), TRADEMARK_FACTS, plan, null);
const route = (p: unknown) => planRoute(deps(llmReturning(p)), TRADEMARK_FACTS);

function withPackage(over: Partial<NonNullable<Judgment["trademark"]>["package"]>): Judgment {
  return {
    ...TRADEMARK_JUDGMENT,
    trademark: { ...TRADEMARK_JUDGMENT.trademark!, package: { ...TRADEMARK_JUDGMENT.trademark!.package, ...over } },
  };
}

describe("planRoute", () => {
  it("a valid route plan parses, and goes through the injected llm as the consult-prep agent", async () => {
    const llm = scriptedLlm(TRADEMARK_PLAN, TRADEMARK_JUDGMENT);
    const r = await planRoute(deps(llm), TRADEMARK_FACTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ route: "TRADEMARK", markStatus: "confirmed", mark: "LegacyCon", stem: "legacy" });
    expect(r.value.variants).toEqual(["legacy con", "legacy conference"]);
    expect(r.value.likelyClasses.map((c) => c.classNumber)).toEqual([41, 35]);
    expect(r.diagnostics).toMatchObject({ status: "ok", model: "claude-sonnet-5-5", costUsd: 0.01 });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({ agent: "consult-prep", effort: "medium", maxTokens: 2_000, hasSignal: true });
  });

  it("an ungrounded mark is downgraded to tbd", async () => {
    const r = await route({ ...TRADEMARK_PLAN, mark: "NovaSphere", stem: "nova" });
    expect(r.ok && r.value).toMatchObject({ markStatus: "tbd", mark: null, stem: null, variants: [] });
    expect(r.ok && r.value.grounding.markDowngraded).toBe(true);
  });

  it("a grounded mark survives case, quotes, ™ and spacing differences", () => {
    expect(markIsGrounded("“legacycon™”", TRADEMARK_FACTS)).toBe(true);
    expect(normalizeMark('  "Legacy   Con"® ')).toBe("legacy con");
    expect(markIsGrounded("L", TRADEMARK_FACTS)).toBe(false);
    expect(markIsGrounded(null, TRADEMARK_FACTS)).toBe(false);
  });

  it("common words never ground a confirmed mark; whole tokens only", () => {
    for (const bad of ["the", "we", "The", "an", "my brand", "our", "Legacy", "gacyCo", "egacycon", "con", "tbd", "n/a"]) {
      expect(markIsGrounded(bad, TRADEMARK_FACTS), bad).toBe(false);
    }
    expect(markIsGrounded("LegacyCon", TRADEMARK_FACTS)).toBe(true);
    expect(markIsGrounded("Black Professionals", TRADEMARK_FACTS)).toBe(true);
    const short: typeof TRADEMARK_FACTS = {
      ...TRADEMARK_FACTS,
      mark: "AX",
      inquiry: "We want to protect our name.",
      intake: [{ label: "BRAND NAME you want to protect", value: "AX" }],
    };
    expect(markIsGrounded("ax", short)).toBe(true);
    expect(markIsGrounded("we", short)).toBe(false);
    expect(markIsGrounded("our name", short)).toBe(false);
    expect(markIsGrounded("TBD", { ...short, mark: "TBD", intake: [{ label: "Brand name", value: "TBD" }] })).toBe(false);
  });

  it("a stem outside the mark is dropped", async () => {
    for (const stem of ["summit", "leg acy", "legacy*"]) {
      const r = await route({ ...TRADEMARK_PLAN, stem });
      expect(r.ok && r.value.stem).toBeNull();
      expect(r.ok && r.value.grounding.stemDropped).toBe(true);
    }
  });

  it("variants and classes are trimmed and deduped", async () => {
    const p: RoutePlan = {
      ...TRADEMARK_PLAN,
      variants: ["legacy con", "Legacy Con", "a", "b", "c", "d", "e", "x".repeat(61)],
      likelyClasses: [41, 41, 35, 9, 25, 16].map((n) => ({ classNumber: n, rationale: "r" })),
    };
    const r = await route(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.variants).toEqual(["legacy con", "a", "b", "c", "d"]);
    expect(r.value.likelyClasses.map((c) => c.classNumber)).toEqual([41, 35, 9]);
    expect(r.value.grounding.classesTrimmed).toBe(3);
  });

  it("schema-failing plans are invalid, never a throw", async () => {
    expect(await planRoute(deps(llmReturning("Sure! Here is the plan: {")), TRADEMARK_FACTS)).toMatchObject({ ok: false, reason: "invalid" });
    for (const bad of [
      { ...TRADEMARK_PLAN, route: "FILING" },
      { ...TRADEMARK_PLAN, likelyClasses: [{ classNumber: 46, rationale: "x" }] },
      { ...TRADEMARK_PLAN, routeReason: "" },
      { ...TRADEMARK_PLAN, markStatus: undefined },
    ]) {
      expect(await route(bad)).toMatchObject({ ok: false, reason: "invalid" });
    }
  });
});

describe("judgeConsult", () => {
  it("a valid judgment parses, with effort high, and a package NAME from the list", async () => {
    const llm = scriptedLlm(TRADEMARK_PLAN, TRADEMARK_JUDGMENT);
    const r = await judgeConsult(deps(llm), TRADEMARK_FACTS, PLAN, "USPTO summary");
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.trademark?.package.choice).toBe("Enhanced");
    expect(llm.calls[0]).toMatchObject({ agent: "consult-prep", effort: "high", maxTokens: 6_000 });
  });

  const schemaFailures: Array<[string, unknown]> = [
    ["non-JSON", "not json"],
    ["missing questions", { ...TRADEMARK_JUDGMENT, questions: undefined }],
    ["2 questions", { ...TRADEMARK_JUDGMENT, questions: ["a?", "b?"] }],
    ["6 questions", { ...TRADEMARK_JUDGMENT, questions: ["1", "2", "3", "4", "5", "6"] }],
    ["a package not on the firm's list", withPackage({ choice: "Platinum" })],
    ["a price-shaped choice", withPackage({ choice: "$1,950" })],
    ["a package of another firm", withPackage({ choice: "Premier Plus" })],
    ["class 46", withPackage({ classesToFileNow: [46] })],
    ["an empty clientSnapshot", { ...TRADEMARK_JUDGMENT, clientSnapshot: "" }],
    ["9 flags", { ...TRADEMARK_JUDGMENT, flagsToProbe: Array.from({ length: 9 }, () => "f") }],
  ];
  for (const [name, bad] of schemaFailures) {
    it(`schema-failing output is invalid: ${name}`, async () => {
      expect(await judge(bad)).toMatchObject({ ok: false, reason: "invalid" });
    });
  }

  it("the same name is valid for the firm that has it, and another firm's list is judged on its own names", async () => {
    expect((await judge(withPackage({ choice: "Premier Plus", classesToFileNow: [41, 35] }), PLAN, OTHER_PACKAGES)).ok).toBe(true);
    expect(await judge(withPackage({ choice: "Enhanced" }), PLAN, OTHER_PACKAGES)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("the choice must be an exact name (the llm's own schema check), but HELD and NONE are always allowed", async () => {
    expect(await judge(withPackage({ choice: "enhanced" }))).toMatchObject({ ok: false, reason: "invalid" });
    expect((await judge(withPackage({ choice: "HELD", pending: "mark not chosen", classesToFileNow: [], priorityClass: null }))).ok).toBe(true);
    expect((await judge(withPackage({ choice: "NONE", classesToFileNow: [], priorityClass: null }))).ok).toBe(true);
  });

  const crossField: Array<[string, Judgment, typeof PLAN]> = [
    ["priorityClass not in classesToFileNow", withPackage({ priorityClass: 9 }), PLAN],
    ["HELD without pending", withPackage({ choice: "HELD", pending: null, classesToFileNow: [], priorityClass: null }), PLAN],
    ["a package with no classes to file now", withPackage({ classesToFileNow: [], priorityClass: null }), PLAN],
    ["classesToFileNow not a subset of likelyClasses", withPackage({ classesToFileNow: [41, 25], priorityClass: 41 }), PLAN],
    ["a trademark plan missing the trademark block", { ...TRADEMARK_JUDGMENT, trademark: null }, PLAN],
    ["a general plan missing the general block", { ...GENERAL_JUDGMENT, general: null }, groundPlan(GENERAL_PLAN, TRADEMARK_FACTS)],
    ["a dispute plan missing the dispute block", { ...DISPUTE_JUDGMENT, dispute: null }, groundPlan({ ...GENERAL_PLAN, route: "DISPUTE" }, TRADEMARK_FACTS)],
  ];
  for (const [name, bad, plan] of crossField) {
    it(`cross-field-failing output is invalid: ${name}`, async () => {
      expect(await judge(bad, plan)).toMatchObject({ ok: false, reason: "invalid" });
    });
  }

  it("the general and dispute judgments are valid for their own routes", async () => {
    expect((await judge(GENERAL_JUDGMENT, groundPlan(GENERAL_PLAN, TRADEMARK_FACTS))).ok).toBe(true);
    expect((await judge(DISPUTE_JUDGMENT, groundPlan({ ...GENERAL_PLAN, route: "DISPUTE" }, TRADEMARK_FACTS))).ok).toBe(true);
  });

  it("judgmentConsistent is the cross-field rule on its own", () => {
    expect(judgmentConsistent(TRADEMARK_JUDGMENT, "TRADEMARK", NAMES)).toBe(true);
    expect(judgmentConsistent(withPackage({ choice: "Other" }), "TRADEMARK", NAMES)).toBe(false);
    expect(judgmentConsistent(withPackage({ classesToFileNow: [41, 41], priorityClass: 41 }), "TRADEMARK", NAMES)).toBe(false);
  });

  it("a firm with no usable package names gets an invalid result, and the llm is never called", async () => {
    const llm = scriptedLlm(TRADEMARK_PLAN, TRADEMARK_JUDGMENT);
    const reserved = [{ ...PACKAGES[0], package: "held" }, { ...PACKAGES[1], package: "None" }];
    expect(packageNamesOf(reserved)).toEqual([]);
    expect(await judgeConsult(deps(llm, reserved), TRADEMARK_FACTS, PLAN, null)).toMatchObject({ ok: false, reason: "invalid" });
    expect(llm.calls).toHaveLength(0);
  });

  it("refusals, truncation and bad shapes from the llm are typed failures, never throws", async () => {
    const cases: Array<[unknown, string]> = [
      [new AiOutputError("x", "refusal"), "refused"],
      [new AiOutputError("x", "truncated"), "truncated"],
      [new AiOutputError("x", "shape"), "invalid"],
    ];
    for (const [err, reason] of cases) {
      expect(await judgeConsult(deps(llmThrowing(err)), TRADEMARK_FACTS, PLAN, null), reason).toMatchObject({ ok: false, reason });
      expect(await planRoute(deps(llmThrowing(err)), TRADEMARK_FACTS), reason).toMatchObject({ ok: false, reason });
    }
  });

  it("other errors are codes only: nothing from the error text survives", async () => {
    const r = await planRoute(deps(llmThrowing(new Error("Internal server error for Kenasha Paul"))), TRADEMARK_FACTS);
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(JSON.stringify(r)).not.toContain("Kenasha");
    expect(await planRoute(deps(llmThrowing("a string")), TRADEMARK_FACTS)).toMatchObject({ reason: "error" });
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    expect(await planRoute(deps(llmThrowing(abort)), TRADEMARK_FACTS)).toMatchObject({ reason: "timeout" });
    const synchronous = (() => {
      throw new Error("boom");
    }) as unknown as StructuredCall;
    expect(await planRoute(deps(synchronous), TRADEMARK_FACTS)).toMatchObject({ reason: "error" });
  });

  it("an output that is not even an object is invalid", async () => {
    expect(await judgeConsult(deps(llmReturning(null)), TRADEMARK_FACTS, PLAN, null)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await planRoute(deps(llmReturning(undefined)), TRADEMARK_FACTS)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("timeout aborts within the budget", async () => {
    let signal: AbortSignal | undefined;
    const hanging = ((req: { signal?: AbortSignal }) =>
      new Promise<never>(() => {
        signal = req.signal;
      })) as unknown as StructuredCall;
    const t0 = Date.now();
    const r = await planRoute(deps(hanging), TRADEMARK_FACTS, { timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("a signal already aborted (the run's budget is spent) makes no call", async () => {
    const llm = scriptedLlm(TRADEMARK_PLAN, TRADEMARK_JUDGMENT);
    const ctl = new AbortController();
    ctl.abort();
    expect(await planRoute(deps(llm), TRADEMARK_FACTS, { signal: ctl.signal })).toMatchObject({ ok: false, reason: "budget" });
    expect(await judgeConsult(deps(llm), TRADEMARK_FACTS, PLAN, null, { signal: ctl.signal })).toMatchObject({ ok: false, reason: "budget" });
    expect(llm.calls).toHaveLength(0);
  });

  it("the run's budget firing mid-call is a budget failure, not a timeout", async () => {
    const ctl = new AbortController();
    const slow = ((req: { signal?: AbortSignal }) =>
      new Promise<never>((_, reject) => {
        req.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        setTimeout(() => ctl.abort(), 10);
      })) as unknown as StructuredCall;
    expect(await planRoute(deps(slow), TRADEMARK_FACTS, { signal: ctl.signal, timeoutMs: 5_000 })).toMatchObject({ ok: false, reason: "budget" });
  });

  it("the call-2 user message carries the USPTO summary text it was given, inside the data block", async () => {
    const llm = scriptedLlm(TRADEMARK_PLAN, TRADEMARK_JUDGMENT);
    await judgeConsult(deps(llm), TRADEMARK_FACTS, PLAN, "USPTO search unavailable — run it on the call.");
    expect(llm.calls[0].user).toContain("<uspto>\nUSPTO search unavailable — run it on the call.\n</uspto>");
  });
});
