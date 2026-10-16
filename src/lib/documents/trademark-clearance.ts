import "server-only";
import { askClaude } from "@/lib/ai/claude";
import { DocumentFlowError } from "./errors";

/**
 * Trademark-clearance DRAFT assembly (lectual-plugin
 * skills/trademark-clearance/SKILL.md — read at build time, not imported at
 * runtime; this file's SYSTEM_PROMPT is this app's own copy of that SOP's
 * operative rules, kept in sync by hand, same convention as
 * opinion-letter.ts). This is the PRELIMINARY, pre-engagement knockout
 * search + draft opinion — used before formal engagement, or ahead of/instead
 * of a consult — and it is deliberately lighter-weight than, and NEVER a
 * substitute for, the comprehensive post-engagement `opinion_letter` flow
 * built on an attorney-starred TMTKO of-record search:
 *
 *   trademark_clearance (this file)      opinion_letter (opinion-letter.ts)
 *   ------------------------------------ --------------------------------------
 *   pre-engagement / early-stage          post-engagement
 *   staff-run preliminary web/TESS search attorney-starred TMTKO report (uploaded)
 *   fast registrability check             comprehensive of-record search
 *   "PRELIMINARY" everywhere, no          full risk categorization, red/yellow/
 *     comprehensive-search claim            green starring cross-reference
 *
 * Both are attorney work product for redline — never sent to a client
 * directly, and neither one files or sends anything on its own.
 *
 * There is no uploaded TMTKO PDF at this stage (the whole point is this runs
 * BEFORE that comprehensive search is commissioned), so unlike opinion-letter
 * this flow has no upload/extraction step: the input is the preliminary
 * search findings a staff member typed up after running the TESS/web search
 * themselves (SKILL.md Phase 2) — the ONLY source of truth for every mark,
 * registration/serial number, owner, and status cited in the draft, same
 * "never fabricate" discipline as the comprehensive flow.
 */

const SYSTEM_PROMPT = `You are drafting a PRELIMINARY trademark clearance opinion for RPB Law, PLLC, in the voice of Rebecca P. Beliard, Esq. The reader is the supervising attorney reviewing this as a DRAFT for redline — this is attorney work product, never sent to a client directly, and it is NOT a comprehensive of-record search.

HARD RULES (from the firm's trademark-clearance SOP — follow exactly):
1. Never fabricate a registration number, serial number, owner, class, status, goods/services description, or link. Only use what is in the staff-provided preliminary search findings or explicitly given to you. Missing detail -> a bracketed placeholder like [reg no. — confirm], never a guess.
2. This is a PRELIMINARY search only — never present it as comprehensive. Never use the word "clear" without the qualifier "preliminary" immediately adjacent to it. Never say the mark "can" be registered — say it "appears registrable at this preliminary stage."
3. Do not conduct or imply a comprehensive search happened — that requires Thomson CompuMark or equivalent professional search services, which this is not. State this limitation explicitly in the findings and in the letter.
4. Assess the mark's position on the distinctiveness spectrum (fanciful > arbitrary > suggestive > descriptive > generic) based on the mark and goods/services given.
5. For each conflict in the findings, run a DuPont-factor analysis (similarity of marks, similarity of goods/services, strength of the cited mark, channels of trade, buyer sophistication) and conclude BLOCKING / MANAGEABLE RISK / NOT CONFUSINGLY SIMILAR for that conflict.
6. Synthesize into one overall risk level — LOW / MODERATE / HIGH — and one recommendation — PROCEED / PROCEED WITH MODIFICATIONS / DO NOT PROCEED. If HIGH, end the internal section with: "ATTORNEY ACTION REQUIRED: Blocking conflict identified. Do not advise client to proceed without Rebecca's review."
7. Do not treat a dead/abandoned registration as blocking on its own unless the findings note continued common-law use.

OUTPUT FORMAT — plain text using this markdown-ish structure (blank line between paragraphs, "## " for section headings, "- " for citation bullets, "**text**" for bolded terms):

# [Client or Entity] — Trademark Clearance Opinion DRAFT — [MARK]

## Section A: Clearance Findings (Internal — Attorney Review)

[Scope of search with date — name it as a PRELIMINARY search of USPTO TESS, phonetic/near-phonetic variants, related classes, and common-law web sources]

[Findings by category: federal same class, federal related classes, common law, phonetic variants — cite only what is in the provided findings]

[DuPont analysis for each conflict found, each ending in BLOCKING / MANAGEABLE RISK / NOT CONFUSINGLY SIMILAR]

[Distinctiveness assessment for the mark]

Overall risk level: **[LOW / MODERATE / HIGH]**

Recommendation: **[PROCEED / PROCEED WITH MODIFICATIONS / DO NOT PROCEED]** — [one to two sentences of concrete next step]

## Section B: Draft Opinion Letter

RPB Law, PLLC
[DATE]

[Client Name]

Re: DRAFT Trademark Clearance Opinion — [MARK] in Class [XX]
    PRELIMINARY — ATTORNEY REVIEW REQUIRED — NOT FINAL LEGAL ADVICE

Dear [Client First Name or salutation],

I. SCOPE OF SEARCH

[Preliminary-search scope paragraph, explicitly noting a comprehensive of-record search is required before a fully defensible opinion can issue]

II. YOUR MARK

Mark: [MARK]
Goods/Services: [verbatim]
Class(es): [XX]
Proposed filing basis: [1(a) Use in Commerce / 1(b) Intent-to-Use]
Distinctiveness: [assessment]

III. FINDINGS

[Federal same class / federal related classes / common law / phonetic variants — or the "none identified" sentence for each]

IV. LEGAL ANALYSIS

[DuPont analysis in plain language, or the no-conflict paragraph]

V. RISK LEVEL

[LOW / MODERATE / HIGH, one to two sentences the client can act on]

VI. RECOMMENDATION

[PROCEED / PROCEED WITH MODIFICATIONS / DO NOT PROCEED, with a concrete next step]

VII. LIMITATIONS

[Standard limitations paragraph: preliminary only, does not cover all 50 states/design databases/foreign-language equivalents, not a guarantee, DRAFT not final legal advice until Rebecca reviews]

Sincerely,
[DRAFT — NOT SIGNED — Rebecca P. Beliard, Esq. to review]
RPB Law, PLLC
trademark@rpblawfirm.com`;

export type TrademarkClearanceFilingBasis = "1(a) Use in Commerce" | "1(b) Intent-to-Use";

export type TrademarkClearanceMatterFacts = {
  markText: string;
  filingBasis: TrademarkClearanceFilingBasis;
  internationalClasses: number[] | null;
  goodsServices: string | null;
  clientName: string;
  entityName: string | null;
  clientEmail: string | null;
  searchDate: string; // "Month D, YYYY"
};

export type TrademarkClearanceDraft = {
  headline: string;
  summary: string;
  draftBody: string;
};

function userPrompt(facts: TrademarkClearanceMatterFacts, searchFindings: string): string {
  const classes = facts.internationalClasses?.length
    ? `International Class(es): ${facts.internationalClasses.join(", ")}`
    : "International Class(es): [confirm/infer from the goods/services]";
  return `Client/applicant facts (use exactly as given — do not invent or guess anything not listed here):
- Proposed mark: ${facts.markText}
- ${classes}
- Goods/services: ${facts.goodsServices ?? "[confirm from staff]"}
- Proposed filing basis: ${facts.filingBasis}
- Client name: ${facts.clientName}
- Entity name: ${facts.entityName ?? "(none on file — use the individual's name)"}
- Email: ${facts.clientEmail ?? "[confirm]"}
- Search date: ${facts.searchDate}

Preliminary search findings (staff-conducted TESS/web search — read in full; this is the ONLY source for every mark name, registration/serial number, owner, status, and goods/services cited as a conflict):
"""
${searchFindings}
"""`;
}

/**
 * Runs the trademark-clearance SOP via Claude and returns the queue-ready
 * draft. Throws DocumentFlowError when no AI provider is configured — same
 * behavior as buildOpinionLetterDraft, and for the same reason: there is no
 * reasonable non-AI fallback for this flow.
 */
export async function buildTrademarkClearanceDraft(
  facts: TrademarkClearanceMatterFacts,
  searchFindings: string,
): Promise<TrademarkClearanceDraft> {
  const result = await askClaude({
    system: SYSTEM_PROMPT,
    prompt: userPrompt(facts, searchFindings),
    maxTokens: 4096,
  });

  if ("skipped" in result) {
    throw new DocumentFlowError(
      "No AI provider is configured for this deployment (VERCEL_AI_GATEWAY_KEY or ANTHROPIC_API_KEY) — the trademark clearance opinion can't be drafted right now.",
    );
  }

  const clientOrEntity = facts.entityName?.trim() || facts.clientName;
  return {
    headline: `Trademark clearance DRAFT — ${clientOrEntity} — ${facts.markText}`,
    summary: `Preliminary trademark clearance opinion drafted from staff-conducted search findings for ${facts.markText}.`,
    draftBody: result.text.trim(),
  };
}
