import type { BriefFacts } from "../brief";
import { sessionText } from "../brief";
import { cardName } from "@/lib/agents/consult-prep/facts";
import { mapIntakeLabel, sanitizeText, type IntakeFactKey, type IntakePair } from "../lawmatics-intake";

/**
 * What the judge is told about the client. Plain strings (null = not recorded), so the judge has no dependency on how the facts were read.
 *
 * Adapted from lawmatics-mcp `ConsultFacts` (see PORTED_FROM.md): the client's email is NOT here at all (the model never sees an address;
 * the recipient guard keeps its own copy), and `intake` holds every labelled answer, which is what grounds a "confirmed" mark.
 */
export type JudgeFacts = {
  clientName: string | null;
  company: string | null;
  sessionTime: string | null;
  practiceArea: string | null;
  inquiry: string | null;
  mark: string | null;
  useInCommerce: string | null;
  productsServices: string | null;
  website: string | null;
  referralSource: string | null;
  intake: IntakePair[];
};

const MAX_PAIRS = 40;

/** Labels that `mapIntakeLabel` sends to the right fact, so the named values ground the mark the same way the raw answers did. */
const LABEL = {
  inquiry: "Please describe your legal matter",
  mark: "Brand name you want to protect",
  useInCommerce: "Is the mark currently in use in commerce?",
  productsServices: "Products and services",
  website: "Website",
  referralSource: "How did you hear about us?",
  competitors: "Competitors",
  goals: "Goals",
  company: "Company name",
  practiceArea: "Practice area",
} as const;

const some = (v: string | null | undefined): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** The judge's facts from what the brief already read. Pure. Pairs whose label maps to nothing are kept under their own label. */
export function judgeFactsFromBrief(f: BriefFacts): JudgeFacts {
  const lead = f.lead;
  const lm = f.lawmatics.state === "ok" ? f.lawmatics.intake : null;
  const other = f.lawmatics.state === "ok" ? f.lawmatics.other : [];
  const ownAnswers = f.answers.state === "ok" ? f.answers.blocks.find((b) => b.label === "Intake form") : undefined;

  const mark = some(lead.markText) ?? some(lm?.mark);
  const practiceArea = some(lead.practiceArea) ?? some(lm?.practiceArea);
  const company = some(lead.businessName) ?? some(lm?.company);

  const named: Array<[string, string | null]> = [
    [LABEL.inquiry, some(lm?.inquiry)],
    [LABEL.mark, mark],
    [LABEL.useInCommerce, some(lm?.useInCommerce)],
    [LABEL.productsServices, some(lm?.productsServices)],
    [LABEL.website, some(lm?.website)],
    [LABEL.referralSource, some(lm?.referralSource) ?? some([lead.referralSource, lead.referralDetail].filter(Boolean).join(", "))],
    [LABEL.competitors, some(lm?.competitors)],
    [LABEL.goals, some(lm?.goals)],
    [LABEL.company, company],
    [LABEL.practiceArea, practiceArea],
  ];
  const intake: IntakePair[] = [];
  const push = (label: string, value: string | null) => {
    const l = sanitizeText(label, 120);
    const v = sanitizeText(value ?? "", 600);
    if (l && v && intake.length < MAX_PAIRS) intake.push({ label: l, value: v });
  };
  for (const [label, value] of named) push(label, value);
  for (const p of other) push(p.label, p.value);
  for (const p of ownAnswers?.pairs ?? []) push(p.question, p.answer);

  // The first intake answer whose label maps to the fact fills a fact the lead record did not carry.
  const fromIntake = (key: IntakeFactKey): string | null =>
    intake.find((p) => mapIntakeLabel(p.label) === key)?.value ?? null;

  return {
    clientName: some(cardName(lead)),
    company,
    sessionTime: f.startsAt ? sessionText(f.startsAt, f.tz) : null,
    practiceArea,
    inquiry: some(lm?.inquiry) ?? fromIntake("inquiry"),
    mark,
    useInCommerce: some(lm?.useInCommerce) ?? fromIntake("useInCommerce"),
    productsServices: some(lm?.productsServices) ?? fromIntake("productsServices"),
    website: some(lm?.website) ?? fromIntake("website"),
    referralSource: named[5][1],
    intake,
  };
}
