import "server-only";
import { askClaude } from "@/lib/ai/claude";
import { DocumentFlowError } from "./errors";
import type { DocType } from "./types";

/**
 * LOE (Letter of Engagement) drafting — `draft-engagement-letter` skill
 * (lectual-plugin skills/draft-engagement-letter/SKILL.md), refined per
 * Dawn's 2026-06-22 walkthrough (see the build-report/plan doc): trademark
 * LOEs need an EXPLICIT current-vs-legacy template choice (never guessed —
 * HARD RULE 2 of that SOP), and general (non-trademark) LOEs are an
 * AI-summarized-scope-into-bullets flow with fee/deposit pulled from the
 * proposal.
 *
 * Every dollar figure here is STAFF-ENTERED, never computed by the model —
 * the SOP's hard rule 2 ("every dollar amount comes verbatim from the
 * proposal... never fill a gap with a plausible number") is enforced by
 * design: this module does arithmetic only on numbers a human typed in (gov
 * filing fees = $350 × class count; deposit = pct × quoted amount), and shows
 * the math rather than hiding it, exactly as the SOP requires. AI is used
 * ONLY for the general-LOE scope-bullets step, which is formatting, not
 * fee math.
 */

export type LoeTemplateVariant = "current" | "legacy";

const GOV_FILING_FEE_PER_CLASS = 350;
const SIGNATURE_DEADLINE_DAYS = 14;

function plusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type TrademarkLoeInput = {
  /** Required, explicit — no default. The whole point of this flow is that
   * this is never guessed (SOP hard rule). */
  variant: LoeTemplateVariant;
  clientName: string;
  entityName: string | null;
  markText: string;
  packageName: string;
  /** The package's benefit rows, staff-entered free text (one per line) —
   * "keep the chosen package's column, delete rows it doesn't include" per
   * firm/templates/loe-chart-format.md is a staff judgment call the MVP asks
   * for directly rather than trying to re-derive from a proposal PDF Lectual
   * has no integration to read. */
  benefitRowsText: string;
  classSelected: string;
  classCount: number;
  amountPaid: string;
  /** Optional discount math shown verbatim, e.g. "$2,775 − $250 = $2,525". */
  amountPaidMath: string | null;
  sendDateIso: string;
};

export type LoeDraft = {
  docType: DocType;
  headline: string;
  summary: string;
  draftBody: string;
  payload: Record<string, unknown>;
};

/**
 * Builds the trademark LOE draft deterministically (no AI) — the fee chart
 * is arithmetic and verbatim transcription, exactly the kind of task the SOP
 * says must never be left to a model's judgment.
 */
export function buildTrademarkLoeDraft(input: TrademarkLoeInput): LoeDraft {
  if (input.classCount < 1) {
    throw new DocumentFlowError("Enter at least one purchased class.");
  }
  const govFees = GOV_FILING_FEE_PER_CLASS * input.classCount;
  const signatureDeadline = plusDays(input.sendDateIso, SIGNATURE_DEADLINE_DAYS);
  const clientOrEntity = input.entityName?.trim() || input.clientName;
  const docType: DocType = input.variant === "current" ? "loe_trademark_current" : "loe_trademark_legacy";
  const templateLabel =
    input.variant === "current"
      ? "Trademark LOE (current)"
      : "Trademark Letter of Engagement (legacy — pre-change package pricing)";

  const chartRows = input.benefitRowsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const draftBody = `# ${clientOrEntity} — ${templateLabel} — ${input.markText}

Template: **${templateLabel}**
Client: ${input.clientName}${input.entityName ? ` (${input.entityName})` : ""}
Mark: ${input.markText}

## Fee chart (paste at the bottom of the LOE's estimated-costs section)

**Trademark Package — Word Mark – ${input.markText}**
Package: ${input.packageName}
${chartRows.map((r) => `- ${r}`).join("\n")}
- **Class Selected:** ${input.classSelected}
- **Amount Paid:** ${input.amountPaid}${input.amountPaidMath ? ` (${input.amountPaidMath})` : ""}
- **Government Filing Fees (Unpaid):** $${govFees} (${GOV_FILING_FEE_PER_CLASS} × ${input.classCount} class${input.classCount === 1 ? "" : "es"})

## Human steps remaining
1. Open the **${templateLabel}** template in Lawmatics for this matter.
2. Paste the chart above at the bottom of the estimated-costs section.
3. Set the signature deadline field to **${signatureDeadline}** (send date + 14 days).
4. Review, save, send.
5. Next after signing: welcome email + convert to hired.`;

  return {
    docType,
    headline: `LOE DRAFT — ${clientOrEntity} — ${templateLabel}`,
    summary: `Trademark LOE fee chart for ${input.markText} (${templateLabel}).`,
    draftBody,
    payload: {
      clientName: input.clientName,
      entityName: input.entityName,
      markText: input.markText,
      variant: input.variant,
      packageName: input.packageName,
      classSelected: input.classSelected,
      classCount: input.classCount,
      amountPaid: input.amountPaid,
      govFees,
      signatureDeadline,
    },
  };
}

export type GeneralLoeInput = {
  clientName: string;
  entityName: string | null;
  /** Free text describing the engagement, source: proposal email + consult
   * notes — summarized into bullets below. */
  scopeDescription: string;
  /** Fee structure exactly as stated in the proposal, e.g. "hourly at $450/hr". */
  feeStructure: string;
  /** Verbatim deposit terms from the proposal email, if any, e.g. "we
   * require a 50% deposit to commence work". */
  depositStatedTerms: string | null;
  depositPercent: number | null;
  quotedAmount: number | null;
};

const GENERAL_LOE_SYSTEM_PROMPT = `You are summarizing an engagement's scope for RPB Law's General Letter of Engagement, in the voice of Rebecca P. Beliard, Esq. Turn the scope description below into 3-7 SHORT bullet points (not prose) describing what the firm will do — e.g. "Phone consultation regarding [topic]", "Review of [agreement type]", "Drafting of [document type]". Use ONLY what is in the scope description; never invent a service that isn't mentioned. Output ONLY the bullet points, one per line, each starting with "- ".`;

/**
 * General (non-trademark) LOE: AI summarizes the scope into bullets (the
 * flow Dawn described); fee/deposit math is computed here from staff-entered
 * numbers, never invented, and shown with the math visible per the SOP.
 */
export async function buildGeneralLoeDraft(input: GeneralLoeInput): Promise<LoeDraft> {
  const result = await askClaude({
    system: GENERAL_LOE_SYSTEM_PROMPT,
    prompt: input.scopeDescription,
    maxTokens: 512,
  });
  if ("skipped" in result) {
    throw new DocumentFlowError(
      "No AI provider is configured for this deployment (VERCEL_AI_GATEWAY_KEY or ANTHROPIC_API_KEY) — the scope bullets can't be summarized right now.",
    );
  }
  const scopeBullets = result.text.trim();

  let depositLine: string;
  if (input.depositPercent != null && input.quotedAmount != null) {
    const depositAmount = Math.round((input.depositPercent / 100) * input.quotedAmount * 100) / 100;
    depositLine = `${input.depositPercent}% × $${input.quotedAmount} = $${depositAmount}`;
  } else if (input.depositStatedTerms) {
    depositLine = `${input.depositStatedTerms} — [confirm exact amount before sending]`;
  } else {
    depositLine = "[no deposit terms stated in the proposal — confirm before sending]";
  }

  const clientOrEntity = input.entityName?.trim() || input.clientName;
  const draftBody = `# ${clientOrEntity} — General LOE

Client: ${input.clientName}${input.entityName ? ` (${input.entityName})` : ""}

## In connection with

${scopeBullets}

## Fee & billing

- Fee structure: ${input.feeStructure}
- Deposit: ${depositLine}

## Human steps remaining
1. Open the General LOE form template in Lawmatics for this matter.
2. Paste the scope bullets and fee/deposit terms above.
3. Review, save, send.`;

  return {
    docType: "loe_general",
    headline: `LOE DRAFT — ${clientOrEntity} — General`,
    summary: "General LOE: AI-summarized scope + fee/deposit terms from the proposal.",
    draftBody,
    payload: {
      clientName: input.clientName,
      entityName: input.entityName,
      feeStructure: input.feeStructure,
      depositPercent: input.depositPercent,
      quotedAmount: input.quotedAmount,
    },
  };
}
