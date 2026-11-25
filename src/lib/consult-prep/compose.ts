// The judgment half of the FULL consult brief, as sections the brief renderer places among the facts (S2b, pure).
//
// PORTED from lawmatics-mcp src/consult-brief/compose.ts @ 3bcbe3f (see PORTED_FROM.md). Changes: no HTML here (the brief renderer
// in ./brief.ts makes the text and the HTML from the same sections, as S1 does); no firm config (every price line comes from the
// firm's own list through ./judge/pricing.ts); no person is named ("Questions for the attorney"); the heads-up, the client snapshot and
// the mark line are placed into the facts brief's own sections instead of a second copy of them; the attachments manifest is not
// here (it is added to each email, from what that email really carries).
//
// Section order is the prep-consult skill's: heads-up (nature, flags), the facts, then on the trademark path likely classes, the USPTO
// knockout, the preliminary risk read and the package recommendation; on the general path scope and engagement (and, for a dispute,
// the dispute snapshot); then the questions. Every model-written string here has ALREADY been scrubbed (finalizeJudgment, or `scrub`).

import type { FinalJudgment } from "./judge/pricing";
import type { GroundedPlan } from "./judge/judge";
import type { Route } from "./judge/schemas";

/** One section of the brief: a heading and its lines. A line starting "- " is a list item. */
export type BriefSection = { heading: string; lines: string[] };

export const HEADINGS = Object.freeze({
  headsUp: "Heads-up",
  classes: "Likely classes — preliminary",
  uspto: "USPTO knockout",
  risk: "Preliminary risk read — preliminary",
  package: "Package recommendation",
  scope: "Scope and engagement",
  dispute: "Dispute snapshot",
  questions: "Questions for the attorney",
});

export const CLASSES_NOTE = "Preliminary class identification — attorney to confirm.";
export const RISK_NOTE = "Preliminary read only — the attorney confirms the risk on the call.";
export const NO_FLAGS = "None flagged from the intake.";
export const PACKAGE_BOX_TITLE = "Package (from the firm's package list):";
export const GENERAL_LOE_LINE = "General engagement — scope and fee come from the proposal; no trademark package or price applies.";
const KNOCKOUT_ATTACHED = /^(?:Full list attached|First \d+ attached)/;
export const NO_DOCUMENTS = "None named from the intake — ask on the call.";

/** The judgment's sections, ready for the brief. */
export type FullSections = {
  route: Route;
  headsUp: BriefSection;
  /** One line for the client snapshot (the model's summary). */
  snapshotLine: string;
  /** One line for the mark section (the mark as submitted, in the model's words). */
  marksLine: string;
  /** Likely classes, USPTO, risk, package (trademark); scope and engagement, dispute (general). */
  judgment: BriefSection[];
  questions: BriefSection;
};

export type ComposeInput = {
  plan: GroundedPlan;
  final: FinalJudgment;
  /** `summarizeUspto(...)` on the trademark path; null elsewhere. */
  usptoSummary: string | null;
  /** The brief's scrubber, for the one plan string the judgment does not carry (`secondaryMatter`). */
  scrub: (s: string) => string;
};

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

function trademarkSections(input: ComposeInput): BriefSection[] {
  const { final, usptoSummary } = input;
  const tm = final.judgment.trademark!;
  const classes: BriefSection = {
    heading: HEADINGS.classes,
    lines: tm.likelyClasses.length
      ? [...tm.likelyClasses.map((c) => `- Class ${c.classNumber} — ${oneLine(c.rationale)}`), CLASSES_NOTE]
      : [`N/A today — ${oneLine(tm.noClassesReason ?? "the goods and services are not settled yet")}`, CLASSES_NOTE],
  };
  // The knockout's own "attached" line is left out: the email's Attachments lines say what each email really carries (the site's export
  // workbook, not the knockout list), so the stored brief never claims a file.
  const uspto: BriefSection = { heading: HEADINGS.uspto, lines: (usptoSummary ?? "").split("\n").filter((l) => l.trim() && !KNOCKOUT_ATTACHED.test(l)) };
  const risk: BriefSection = { heading: HEADINGS.risk, lines: [oneLine(tm.riskRead), RISK_NOTE] };
  const block = final.package;
  const pkgLines: string[] = [];
  if (block?.kind === "settled") {
    pkgLines.push(`${block.package.package}. ${oneLine(block.reasoning)}`.trim(), PACKAGE_BOX_TITLE, ...block.lines.map((l) => `- ${l}`));
  } else if (block) {
    if (block.reasoning.trim()) pkgLines.push(oneLine(block.reasoning));
    pkgLines.push(block.line);
  }
  return [classes, uspto, risk, { heading: HEADINGS.package, lines: pkgLines }];
}

function generalSections(input: ComposeInput): BriefSection[] {
  const g = input.final.judgment.general!;
  const lines = [oneLine(g.scopeAndEngagement)];
  if (g.documentsNeeded.length) lines.push("Documents to have before the call:", ...g.documentsNeeded.map((d) => `- ${oneLine(d)}`));
  else lines.push(`Documents to have before the call: ${NO_DOCUMENTS}`);
  if (g.jurisdictionNote) lines.push(`Jurisdiction: ${oneLine(g.jurisdictionNote)}`);
  lines.push(GENERAL_LOE_LINE);
  const out: BriefSection[] = [{ heading: HEADINGS.scope, lines }];
  const dispute = input.final.judgment.dispute;
  if (input.plan.route === "DISPUTE" && dispute) out.push({ heading: HEADINGS.dispute, lines: [oneLine(dispute.disputeSnapshot)] });
  return out;
}

/** The judgment as sections. Pure: no price is computed here (the package block's lines are already the firm's list). */
export function composeFullSections(input: ComposeInput): FullSections {
  const { plan, final, scrub } = input;
  const j = final.judgment;
  const flags = j.flagsToProbe.map(oneLine).filter(Boolean);
  if (plan.secondaryMatter) flags.push(`Separate future matter: ${oneLine(scrub(plan.secondaryMatter))}`);
  const headsUp: BriefSection = {
    heading: HEADINGS.headsUp,
    lines: [`Nature of the matter: ${oneLine(j.natureOfMatter)}`, ...(flags.length ? ["Flags to probe:", ...flags.map((f) => `- ${f}`)] : [`Flags to probe: ${NO_FLAGS}`])],
  };
  return {
    route: plan.route,
    headsUp,
    snapshotLine: oneLine(j.clientSnapshot),
    marksLine: oneLine(j.markSubmitted),
    judgment: plan.route === "TRADEMARK" ? trademarkSections(input) : generalSections(input),
    questions: { heading: HEADINGS.questions, lines: j.questions.map((q) => `- ${oneLine(q)}`) },
  };
}
