import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import { normalisePackages } from "@/lib/proposals/package-list";
import type { ProposalPricing } from "@/lib/proposals/types";
import { cardName } from "@/lib/agents/consult-prep/facts";
import { capPdfMarks, splitPrefix, type AttachPlan, type PrepFile } from "./attachments";
import type { BriefFacts } from "./brief";
import { composeFullSections, type FullSections } from "./compose";
import { judgeFactsFromBrief } from "./judge/facts";
import { JUDGE_CALL, ROUTE_CALL, judgeConsult, planRoute, type FailureReason } from "./judge/judge";
import { finalizeJudgment } from "./judge/pricing";
import { makeScrubber } from "./judge/scrub";
import { PackagesSpecError, PACKAGES_SPEC_ERROR_CODES, buildPackagesSpec, localDateKey, type PackagesSpec } from "./pdf/spec";
import { renderPackagesPdf } from "./pdf/render";
import { searchUspto, searchUsptoSite, type FetchFn, type UsptoResult } from "./uspto/uspto";
import { summarizeUspto } from "./uspto/uspto-summary";
import { buildUsptoXlsx } from "./uspto/xlsx";

/**
 * The FULL consult prep (S2b): one builder, at most TWO model calls, prices only from the firm's own list.
 *
 *   firm's package list (unreadable or none saved: no full prep)
 *   -> call 1: route + USPTO search plan (budget checked first)
 *   -> trademark path with a confirmed mark: the USPTO knockout pull (unavailable: no full prep, see below)
 *   -> call 2: the judgment (budget checked first)
 *   -> scrub every model string, package lines from the firm's list, the sections for the brief
 *   -> the two files (USPTO site export workbook, packages PDF), each optional
 *
 * Any failure is a CODE and the brief stays the facts brief: the next run tries again (S2a's withheld and owed rules decide what is
 * still sent). Never throws, never logs, never carries a model's words or a client's data out in a failure.
 *
 * A USPTO outage BLOCKS "full" on the trademark path. lawmatics-mcp sent its judgment with a "USPTO unavailable" line; that is a
 * thinner brief than the full prep (the risk read is made without the knockout it is supposed to read), and Lectual's rule is that the
 * booked and 24 h emails carry the full prep or wait for it (the 1 h email still goes, marked "facts only"). No mark to search
 * ("nothing to search") is NOT an outage: that is the full prep for a client who has not settled a mark, and it counts as full.
 */

export type FullBuildFailure = FailureReason | "uspto" | "packages" | "unexpected";

export type FullBuild =
  | {
      ok: true;
      sections: FullSections;
      /** What became of each file (codes; the marker stores this). */
      attachPlan: AttachPlan;
      files: PrepFile[];
      calls: number;
    }
  | { ok: false; reason: FullBuildFailure; calls: number };

/** The firm as the brief needs it. Read once per run, org-fenced. `packages` null = no list saved (or the read failed): no full prep. */
export type FirmForBrief = { name: string; slug: string | null; timeZone: string; packages: ProposalPricing[] | null };

export type FullBuildDeps = {
  /** The run's model call (`ctx.llm`): the cost total and the run's signal ride on it. */
  llm: StructuredCall;
  /** Injected transport for the USPTO and its images (`ctx.fetchImpl`); never an ambient global in a test. */
  fetch: FetchFn;
  /** Milliseconds left in the run's budget; Infinity when the run has none (tests). */
  timeLeftMs: () => number;
  /** The run's clock (`ctx.now`), for the firm's calendar date on the workbook. */
  now: () => number;
  signal?: AbortSignal;
  /** The PDF renderer (tests may swap it). */
  renderPdf?: (spec: PackagesSpec) => Promise<Uint8Array>;
};

/** Kept back from every step for the rest of the run (queue, emails, saves, marker). */
export const BUILD_RESERVE_MS = 20_000;
/** A call is not started with less than this of its own time left: it could only be cut off. */
export const MIN_ROUTE_MS = 20_000;
export const MIN_JUDGE_MS = 30_000;
/** Before call 1, room for call 1, the USPTO pull and call 2 together; otherwise none is started. */
export const MIN_START_MS = 75_000;
/** The USPTO knockout pull's whole budget, and the per-request deadline (P1's own default). */
export const USPTO_BUDGET_MS = 45_000;
export const USPTO_REQUEST_MS = 20_000;
/** The files after the judgment: the site search and the mark images together. */
export const FILES_BUDGET_MS = 40_000;
export const MAX_MODEL_CALLS = 2;

/** The firm's name, slug, zone and package list. A failed read of the list, or no saved setting, is `packages: null` (never a default list). */
export async function readFirmForBrief(admin: SupabaseClient, orgId: string, timeZone: string): Promise<FirmForBrief> {
  let name = "";
  let slug: string | null = null;
  try {
    const [org, profile] = await Promise.all([
      admin.from("crm_org").select("name, slug").eq("id", orgId).maybeSingle(),
      admin.from("crm_org_profile").select("display_name").eq("org_id", orgId).maybeSingle(),
    ]);
    const display = ((profile.data as { display_name?: string | null } | null)?.display_name ?? "").trim();
    name = display || (((org.data as { name?: string | null } | null)?.name ?? "") as string).trim();
    slug = ((org.data as { slug?: string | null } | null)?.slug ?? null) || null;
  } catch {
    name = "";
  }
  let packages: ProposalPricing[] | null = null;
  try {
    const { data, error } = await admin.from("client_proposal_setting").select("pricing").eq("org_id", orgId).maybeSingle();
    // `normalisePackages` turns a missing list into a made-up default; a firm that never saved one gets NO list, so no price is ever invented.
    if (!error && data && (data as { pricing?: unknown }).pricing) packages = normalisePackages((data as { pricing: unknown }).pricing);
  } catch {
    packages = null;
  }
  return { name, slug, timeZone, packages };
}

/** The model call, counted: a third call is refused in code, whatever a future change to the flow does. */
function capped(llm: StructuredCall, count: { n: number }): StructuredCall {
  return (async (req) => {
    if (count.n >= MAX_MODEL_CALLS) throw new Error("model call limit reached");
    count.n += 1;
    return llm({ ...req, agent: "consult-prep" });
  }) as StructuredCall;
}

/** Builds the full prep for one consult. Never throws. */
export async function buildFullPrep(facts: BriefFacts, firm: FirmForBrief, deps: FullBuildDeps): Promise<FullBuild> {
  const count = { n: 0 };
  const fail = (reason: FullBuildFailure): FullBuild => ({ ok: false, reason, calls: count.n });
  try {
    const packages = firm.packages;
    if (!packages || packages.length === 0 || !firm.name) return fail("packages");
    const left = () => deps.timeLeftMs() - BUILD_RESERVE_MS;
    const judgeDeps = { llm: capped(deps.llm, count), firm: { name: firm.name }, packages };
    const jf = judgeFactsFromBrief(facts);

    // ---- call 1: route + search plan. Room for the whole build, or nothing is started.
    if (left() < MIN_START_MS) return fail("budget");
    const planned = await planRoute(judgeDeps, jf, { timeoutMs: Math.min(ROUTE_CALL.timeoutMs, Math.max(MIN_ROUTE_MS, left() - MIN_JUDGE_MS - 10_000)), signal: deps.signal });
    if (!planned.ok) return fail(planned.reason);
    const plan = planned.value;

    // ---- the USPTO knockout: trademark path only, a confirmed mark only. An outage is no full prep (see the header).
    let uspto: UsptoResult | null = null;
    if (plan.route === "TRADEMARK") {
      if (plan.mark) {
        const room = Math.min(USPTO_BUDGET_MS, left() - MIN_JUDGE_MS);
        if (room <= 0) return fail("budget");
        uspto = await searchUspto({
          mark: plan.mark,
          stem: plan.stem ?? "",
          classes: plan.likelyClasses.map((c) => c.classNumber),
          variants: plan.variants,
          fetch: deps.fetch,
          timeoutMs: USPTO_REQUEST_MS,
          deadline: Date.now() + room,
        });
        if (uspto.status === "unavailable") return fail("uspto");
      } else {
        uspto = { status: "skipped", reason: "no mark" };
      }
    }
    const usptoSummary = uspto ? summarizeUspto(uspto) : null;

    // ---- call 2: the judgment.
    if (left() < MIN_JUDGE_MS) return fail("budget");
    const judged = await judgeConsult(judgeDeps, jf, plan, usptoSummary, { timeoutMs: Math.min(JUDGE_CALL.timeoutMs, left()), signal: deps.signal });
    if (!judged.ok) return fail(judged.reason);

    // ---- scrub, the firm's prices, the sections.
    const final = finalizeJudgment(judged.value, { route: plan.route, markConfirmed: plan.mark !== null, packages });
    const { scrub } = makeScrubber(plan.route !== "TRADEMARK", packages.map((p) => p.package));
    const sections = composeFullSections({ plan, final, usptoSummary, scrub });

    // ---- the files: each optional, never a reason to hold the brief back.
    const files: PrepFile[] = [];
    const attachPlan: AttachPlan = {};
    if (plan.route !== "TRADEMARK") {
      attachPlan.uspto_xlsx = "none";
      attachPlan.packages_pdf = "none";
    } else {
      attachPlan.uspto_xlsx = await usptoFile(plan.mark, firm, deps, left, files);
      attachPlan.packages_pdf = await packagesFile(facts, plan.mark, final, jf, firm, deps, scrub, files);
    }
    return { ok: true, sections, attachPlan, files, calls: count.n };
  } catch {
    return fail("unexpected");
  }
}

/** The USPTO site's own export workbook for the mark. Returns the code for the plan and pushes the file when built. */
async function usptoFile(mark: string | null, firm: FirmForBrief, deps: FullBuildDeps, left: () => number, files: PrepFile[]): Promise<string> {
  if (!mark) return "skipped";
  const room = Math.min(FILES_BUDGET_MS, left());
  if (room <= 5_000) return "budget";
  try {
    const started = Date.now();
    const result = await searchUsptoSite({ term: mark, fetch: deps.fetch, timeoutMs: USPTO_REQUEST_MS, deadline: started + room });
    if (result.status === "unavailable") return "unavailable";
    if (result.status === "skipped") return "skipped";
    const date = localDateKey(new Date(deps.now()), firm.timeZone);
    const imageBudgetMs = Math.max(0, room - (Date.now() - started) - 5_000);
    const built = await buildUsptoXlsx({ result, date, fetch: deps.fetch, imageBudgetMs });
    if (!built.ok) return built.status;
    files.push({ kind: "uspto_xlsx", fileName: built.fileName, bytes: built.bytes });
    return "built";
  } catch {
    return "failed";
  }
}

/** The packages PDF (client-facing on the call: no class number, prices from the firm's list). Returns the plan code. */
async function packagesFile(
  facts: BriefFacts,
  mark: string | null,
  final: ReturnType<typeof finalizeJudgment>,
  jf: ReturnType<typeof judgeFactsFromBrief>,
  firm: FirmForBrief,
  deps: FullBuildDeps,
  scrub: (s: string) => string,
  files: PrepFile[],
): Promise<string> {
  if (!mark) return "no_marks";
  try {
    const marks = capPdfMarks(final.judgment.trademark?.package.pdfMarks ?? [], jf, scrub);
    const { prefix, name } = splitPrefix(cardName(facts.lead));
    const spec = buildPackagesSpec(
      { client: name, clientPrefix: prefix, company: facts.lead.businessName, consultStart: facts.startsAt ?? "", marks },
      { name: firm.name, timeZone: firm.timeZone, packages: firm.packages ?? [], slug: firm.slug },
    );
    const bytes = await (deps.renderPdf ?? renderPackagesPdf)(spec);
    files.push({ kind: "packages_pdf", fileName: spec.filename, bytes: Buffer.from(bytes) });
    return "built";
  } catch (err) {
    if (err instanceof PackagesSpecError && (PACKAGES_SPEC_ERROR_CODES as readonly string[]).includes(err.code)) return err.code;
    return "failed";
  }
}
