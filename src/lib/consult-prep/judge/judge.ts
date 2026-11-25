// The two model calls behind the full consult brief, and everything between the model's output and the email:
//
//   llm (structured, zod) -> re-validate -> cross-field checks -> grounding
//
// PORTED from lawmatics-mcp src/consult-brief/ai/judge.ts (see PORTED_FROM.md). Changes: the model is the injected `llm` (the shape of
// `ctx.llm`, agent "consult-prep", Sonnet through `agentModel`), not the Anthropic SDK; the package is a NAME from the firm's own list;
// failures are typed results (`JudgeFailure`), never a throw into the run, and never carry a message; nothing here logs (prompts and
// answers are client content).
//
// Any failure is a reason CODE, and the brief stays a facts brief. Grounding stops the model inventing the facts that drive the USPTO
// search and the price: a "confirmed" mark must appear in what the client actually wrote, the stem must come from the mark, and the
// package must agree with the classes.

import type { StructuredCall } from "@/lib/ai/claude";
import type { ProposalPricing } from "@/lib/proposals/types";
import { mapIntakeLabel } from "../lawmatics-intake";
import type { JudgeFacts } from "./facts";
import { buildJudgeUserMessage, buildRouteUserMessage, judgeSystemPrompt, routeSystemPrompt } from "./prompt";
import {
  PACKAGE_HELD,
  PACKAGE_NONE,
  RESERVED_CHOICES,
  RoutePlanSchema,
  makeJudgmentSchema,
  type Judgment,
  type MarkStatus,
  type Route,
  type RoutePlan,
} from "./schemas";

export type FailureReason = "timeout" | "error" | "invalid" | "refused" | "truncated" | "budget";

export type CallDiagnostics = {
  /** "ok" or the failure reason. */
  status: "ok" | FailureReason;
  ms: number;
  /** The model that answered and what the call cost, when the llm reported them (for the run's cost total). Codes and numbers only. */
  model?: string;
  costUsd?: number | null;
};

export type JudgeResult<T> =
  | { ok: true; value: T; diagnostics: CallDiagnostics }
  | { ok: false; reason: FailureReason; diagnostics: CallDiagnostics };

export type CallOptions = {
  timeoutMs?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

/** What the judge needs: the model call, the firm's name and the firm's own package list (from `normalisePackages`). */
export type JudgeDeps = {
  llm: StructuredCall;
  firm: { name: string };
  packages: readonly ProposalPricing[];
};

export const ROUTE_CALL = Object.freeze({ maxTokens: 2_000, timeoutMs: 60_000 });
export const JUDGE_CALL = Object.freeze({ maxTokens: 6_000, timeoutMs: 90_000 });

export const MAX_VARIANTS = 5;
export const MAX_VARIANT_CHARS = 60;
export const MAX_CLASSES = 3;

const RESERVED = new Set(RESERVED_CHOICES.map((r) => r.toLowerCase()));

/** The names the model may choose: the firm's package names, each once, never HELD or NONE. */
export function packageNamesOf(packages: readonly ProposalPricing[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of packages) {
    const name = p.package.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || RESERVED.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// ------------------------------------------------------------------ calling

class TimedOut extends Error {}

type Called<T> = { ok: true; output: T; model?: string; costUsd?: number | null } | { ok: false; reason: FailureReason };

/** What the real call (`callClaude`) throws, told apart by name so this module never imports the SDK or its error classes. */
function reasonOf(err: unknown): FailureReason {
  if (err instanceof TimedOut) return "timeout";
  if (err instanceof Error) {
    if (err.name === "AiOutputError") {
      const kind = (err as { kind?: unknown }).kind;
      return kind === "refusal" ? "refused" : kind === "truncated" ? "truncated" : "invalid";
    }
    if (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "APIUserAbortError" || err.name === "APIConnectionTimeoutError") return "timeout";
  }
  return "error";
}

/**
 * One model call with a hard timeout: the abort signal is fired AND the call is raced against a timer, so even a model that
 * ignores the signal cannot hold the brief past its budget. A signal already aborted means the run's budget is spent: no call is made.
 */
async function callModel<T>(
  llm: StructuredCall,
  req: { system: string; user: string; schema: Parameters<StructuredCall>[0]["schema"]; effort: "low" | "medium" | "high" },
  opts: Required<Pick<CallOptions, "timeoutMs" | "maxTokens">> & { signal?: AbortSignal },
): Promise<Called<T>> {
  if (opts.signal?.aborted) return { ok: false, reason: "budget" };
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimedOut());
    }, opts.timeoutMs);
  });
  const work = Promise.resolve().then(() =>
    llm({ ...req, maxTokens: opts.maxTokens, agent: "consult-prep", signal: controller.signal }),
  );
  work.catch(() => undefined); // a late rejection after the timeout must not go unhandled
  try {
    const res = await Promise.race([work, timedOut]);
    return { ok: true, output: res.output as T, model: res.model, costUsd: res.costUsd };
  } catch (err) {
    // The run's own budget fired the signal: say so, rather than "timeout".
    if (opts.signal?.aborted && !(err instanceof TimedOut)) return { ok: false, reason: "budget" };
    return { ok: false, reason: reasonOf(err) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

// ------------------------------------------------------------------ grounding

/** Case-insensitive, whitespace collapsed, quotes and ™/®/© stripped. */
export function normalizeMark(s: string): string {
  // ™/®/© go BEFORE NFKC, which would otherwise turn ™ into the letters "TM".
  return s
    .replace(/[™®©]/g, "")
    .normalize("NFKC")
    .replace(/["'`‘’“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Words that never make a mark on their own: articles, pronouns, connectives,
 * and the generic nouns a client uses ABOUT a mark ("my brand name").
 */
const GROUNDING_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with", "from", "as", "is", "it", "its",
  "we", "us", "our", "i", "me", "my", "you", "your", "they", "their", "this", "that", "be", "are", "was", "not", "no",
  "brand", "name", "mark", "logo", "trademark", "company", "business", "llc", "inc", "co", "corp", "tbd", "n/a", "na", "none", "yes",
]);

/** Letters and digits of `m` outside stopwords: "the we" has 0, "legacy con" has 9. */
function substantiveChars(m: string): number {
  return m
    .split(/[^\p{L}\p{N}/]+/u)
    .filter((t) => t && !GROUNDING_STOPWORDS.has(t))
    .reduce((n, t) => n + t.replace(/[^\p{L}\p{N}]/gu, "").length, 0);
}

/** Is `m` in `source` as whole tokens (not inside a longer word)? Both already normalized. */
function hasWholeTokens(source: string, m: string): boolean {
  const esc = m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(source);
}

/**
 * Is `mark` what the client actually wrote? Two ways to be grounded:
 * - it IS the answer to a mark-specific intake field (the mapped mark fact, or
 *   any intake answer whose label maps to the mark), compared whole; or
 * - it appears as whole tokens in the mark field, the inquiry or any intake
 *   answer AND carries at least 3 letters/digits outside stopwords, so "the",
 *   "we" or "my brand" can never count as a confirmed mark.
 */
export function markIsGrounded(mark: string | null | undefined, facts: JudgeFacts): boolean {
  if (!mark) return false;
  const m = normalizeMark(mark);
  if (m.length < 2) return false;
  const markFields = [facts.mark, ...facts.intake.filter((p) => mapIntakeLabel(p.label) === "mark").map((p) => p.value)];
  if (markFields.some((s) => typeof s === "string" && normalizeMark(s) === m && substantiveChars(m) >= 2)) return true;
  if (substantiveChars(m) < 3) return false;
  const sources = [...markFields, facts.inquiry, ...facts.intake.map((p) => p.value)];
  return sources.some((s) => typeof s === "string" && hasWholeTokens(normalizeMark(s), m));
}

export type GroundingReport = {
  /** The model said "confirmed" but the mark is not in the facts: treated as tbd. */
  markDowngraded: boolean;
  /** The stem was not part of the mark (or not a plain word): dropped, no tier-2 search. */
  stemDropped: boolean;
  variantsTrimmed: number;
  classesTrimmed: number;
};

export type GroundedPlan = {
  route: Route;
  routeReason: string;
  secondaryMatter: string | null;
  markStatus: MarkStatus;
  /** Non-null only when markStatus is confirmed AND the mark is grounded in the facts. */
  mark: string | null;
  stem: string | null;
  variants: string[];
  likelyClasses: { classNumber: number; rationale: string }[];
  grounding: GroundingReport;
};

export function groundPlan(plan: RoutePlan, facts: JudgeFacts): GroundedPlan {
  const grounding: GroundingReport = { markDowngraded: false, stemDropped: false, variantsTrimmed: 0, classesTrimmed: 0 };

  let markStatus: MarkStatus = plan.markStatus;
  let mark: string | null = plan.mark?.trim() || null;
  if (markStatus === "confirmed" && !markIsGrounded(mark, facts)) {
    markStatus = "tbd";
    grounding.markDowngraded = true;
  }
  if (markStatus !== "confirmed") mark = null;

  let stem: string | null = null;
  if (mark && plan.stem) {
    const s = normalizeMark(plan.stem);
    if (/^[a-z0-9]+$/.test(s) && normalizeMark(mark).includes(s)) stem = s;
  }
  if (plan.stem && !stem) grounding.stemDropped = true;

  const variants: string[] = [];
  const seenVariants = new Set<string>();
  for (const v of plan.variants) {
    const t = v.replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (!t || t.length > MAX_VARIANT_CHARS || seenVariants.has(key) || variants.length >= MAX_VARIANTS) {
      grounding.variantsTrimmed++;
      continue;
    }
    seenVariants.add(key);
    variants.push(t);
  }

  const likelyClasses: GroundedPlan["likelyClasses"] = [];
  const seenClasses = new Set<number>();
  for (const c of plan.likelyClasses) {
    if (seenClasses.has(c.classNumber) || likelyClasses.length >= MAX_CLASSES) {
      grounding.classesTrimmed++;
      continue;
    }
    seenClasses.add(c.classNumber);
    likelyClasses.push({ classNumber: c.classNumber, rationale: c.rationale });
  }

  return {
    route: plan.route,
    routeReason: plan.routeReason,
    secondaryMatter: plan.secondaryMatter,
    markStatus,
    mark,
    stem,
    variants: mark ? variants : [],
    likelyClasses,
    grounding,
  };
}

// ------------------------------------------------------------------ cross-field checks

/**
 * The checks the JSON schema cannot express. Any failure makes the whole judgment invalid (the brief stays facts):
 * a half-consistent package is how a wrong price would reach the attorney. `names` is the firm's package list.
 */
export function judgmentConsistent(j: Judgment, route: Route, names: readonly string[]): boolean {
  if (route === "TRADEMARK" && !j.trademark) return false;
  if (route === "GENERAL" && !j.general) return false;
  if (route === "DISPUTE" && (!j.general || !j.dispute)) return false;
  if (route !== "TRADEMARK") return true;

  const tm = j.trademark!;
  const pkg = tm.package;
  const listed = pkg.choice === PACKAGE_HELD || pkg.choice === PACKAGE_NONE || names.includes(pkg.choice);
  if (!listed) return false;
  const likely = new Set(tm.likelyClasses.map((c) => c.classNumber));
  if (!pkg.classesToFileNow.every((c) => likely.has(c))) return false;
  if (new Set(pkg.classesToFileNow).size !== pkg.classesToFileNow.length) return false;
  if (pkg.priorityClass !== null && !pkg.classesToFileNow.includes(pkg.priorityClass)) return false;
  if (pkg.choice === PACKAGE_HELD && !pkg.pending) return false;
  if (pkg.choice !== PACKAGE_NONE && pkg.choice !== PACKAGE_HELD && pkg.classesToFileNow.length < 1) return false;
  return true;
}

// ------------------------------------------------------------------ calls

function failure<T>(reason: FailureReason, started: number): JudgeResult<T> {
  return { ok: false, reason, diagnostics: { status: reason, ms: Date.now() - started } };
}

function okResult<T>(value: T, started: number, called: { model?: string; costUsd?: number | null }): JudgeResult<T> {
  return { ok: true, value, diagnostics: { status: "ok", ms: Date.now() - started, model: called.model, costUsd: called.costUsd } };
}

/** Call 1: route + search plan, grounded against the facts. Never throws. */
export async function planRoute(deps: JudgeDeps, facts: JudgeFacts, opts: CallOptions = {}): Promise<JudgeResult<GroundedPlan>> {
  const started = Date.now();
  try {
    const res = await callModel<unknown>(
      deps.llm,
      { system: routeSystemPrompt(deps.firm), user: buildRouteUserMessage(facts), schema: RoutePlanSchema, effort: "medium" },
      { timeoutMs: opts.timeoutMs ?? ROUTE_CALL.timeoutMs, maxTokens: opts.maxTokens ?? ROUTE_CALL.maxTokens, signal: opts.signal },
    );
    if (!res.ok) return failure(res.reason, started);
    const parsed = RoutePlanSchema.safeParse(res.output);
    if (!parsed.success) return failure("invalid", started);
    return okResult(groundPlan(parsed.data, facts), started, res);
  } catch {
    return failure("error", started);
  }
}

/**
 * Call 2: the judgment, made after the USPTO pull. `usptoSummary` is P1's `summarizeUspto(result)` text (it says "unavailable" or
 * "nothing to search" in words when the pull did not run), and null on the general and dispute paths (no search runs there).
 * Never throws.
 */
export async function judgeConsult(
  deps: JudgeDeps,
  facts: JudgeFacts,
  plan: GroundedPlan,
  usptoSummary: string | null,
  opts: CallOptions = {},
): Promise<JudgeResult<Judgment>> {
  const started = Date.now();
  try {
    const names = packageNamesOf(deps.packages);
    if (names.length === 0) return failure("invalid", started); // nothing to choose from: no price could be printed
    const schema = makeJudgmentSchema(names);
    const prompts = deps.packages.filter((p) => names.includes(p.package.trim())).map((p) => ({ name: p.package.trim(), includedClasses: p.included_classes }));
    const res = await callModel<unknown>(
      deps.llm,
      {
        system: judgeSystemPrompt(deps.firm, prompts),
        user: buildJudgeUserMessage(facts, plan, usptoSummary),
        schema,
        effort: "high",
      },
      { timeoutMs: opts.timeoutMs ?? JUDGE_CALL.timeoutMs, maxTokens: opts.maxTokens ?? JUDGE_CALL.maxTokens, signal: opts.signal },
    );
    if (!res.ok) return failure(res.reason, started);
    const parsed = schema.safeParse(res.output);
    if (!parsed.success || !judgmentConsistent(parsed.data, plan.route, names)) return failure("invalid", started);
    return okResult(parsed.data, started, res);
  } catch {
    return failure("error", started);
  }
}
