import "server-only";
import { askClaude } from "@/lib/ai/claude";
import { DocumentFlowError } from "./errors";

/**
 * Opinion-letter DRAFT assembly (Phase 1 of the `opinion-letter` skill,
 * lectual-plugin skills/opinion-letter/SKILL.md — read at build time, not
 * imported at runtime; this file's SYSTEM_PROMPT is this app's own copy of
 * that SOP's operative rules, kept in sync by hand). ASSEMBLE mode only: the
 * attorney's starring in the uploaded TMTKO report is treated as
 * authoritative, and Claude's job is faithful assembly into the firm's
 * canonical letter structure — never re-running the legal analysis.
 *
 * DEFERRED (see the build report): Phase 2's tracked-changes redline
 * workflow, the combined letter+report PDF, and INDEPENDENT-mode starring
 * are NOT built here. This produces one thing — a Phase-1-shaped draft as
 * plain text for the approval queue — matching the "text now, real .docx at
 * approval" MVP shape every other queue draft type already uses.
 */

const SYSTEM_PROMPT = `You are assembling a trademark clearance opinion letter for RPB Law, PLLC, in the voice of Rebecca P. Beliard, Esq. The reader is the supervising attorney reviewing this as a DRAFT for redline — this is attorney work product, never sent to a client directly.

HARD RULES (from the firm's opinion-letter SOP — follow exactly):
1. Never fabricate a registration number, serial number, owner, class, status, goods/services description, or link. Only use what is in the uploaded search report or explicitly given to you. Missing detail -> a bracketed placeholder like [reg no. — confirm], never a guess.
2. Boilerplate sections (see structure below) are reproduced close to verbatim in tone — do not "improve" or paraphrase the firm's standard language.
3. Only red/high-risk-starred marks go in the letter body's cited sections. Yellow/moderate marks are covered collectively in one awareness paragraph (include ONLY if such marks exist). Green/cleared marks inform risk level only, never cited individually.
4. Goods/services are quoted verbatim from the report — do not trim or paraphrase long specifications.
5. If the report's stated classes/goods don't match what you were told about the client's application, flag it in one line rather than silently choosing.
6. ASSEMBLE mode is the default: assume the report has already been reviewed/starred by the attorney (or state briefly if you are inferring risk tiers yourself because no starring is evident) — never present your own read as the attorney's determination.

OUTPUT FORMAT — plain text using this markdown-ish structure (blank line between paragraphs, "## " for the letter's main section headings, "- " for citation bullets, "**text**" for the few bolded terms):

# [Client or Entity] — Opinion Letter DRAFT — [MARK]

[Salutation paragraph, RE line, intro paragraph naming the mark and that a comprehensive search was completed]

[Search-scope paragraph naming the class(es) and goods/services verbatim]

[One-sentence risk conclusion: "the risk of applying for trademark registration for the proposed mark is [low / moderate / high / a range]."]

## Federal Register Search

[Standard 2-paragraph explanation of federal registration + the likelihood-of-confusion two-step test]

## Similar Federal Registrations
[Bulleted citations in the form: MARK (U.S. Reg. No. XXX) Registered in connection with [goods/services] Class XXX — OR the "no registrations found" sentence if none]

## Similar Pending Applications for Registration
[Same bullet pattern with U.S. Serial No., "Applied for" — OR the "none found" sentence]

## Similar Abandoned/Cancelled/Expired Registrations
[Same bullet pattern, "Registered/Applied for" — OR the "none found" sentence]

## State Search
[Standard explanation paragraph, then state citations or the "no references" sentence]

## Common Law Search & Business Listings
[Standard explanation paragraphs, then a "Common Law and Business Uses" list: **[BRAND NAME]**, then Link / Goods-Services / USPTO Status: Unregistered, no application pending / Notes — or the "none found" sentence. Include the awareness paragraph ONLY if yellow/moderate-starred items exist.]

## Potential for USPTO Office Action
[Standard paragraph about Office Action possibility]

## Risk of Third-Party Opposition During Publication Period
[Standard paragraph about the opposition window]

## Risk Assessment
[One italicized-in-intent sentence restating the overall risk level, then the standard "no warranties" paragraph]

## Conclusion
[Standard closing paragraph asking the client to confirm whether to proceed, noting the 7-day default-to-proceed]

Sincerely,

Rebecca P. Beliard, Esq.
Managing Partner
RPB Law, PLLC

After the letter, on new lines, add:

## Risk Categorization Summary (internal — for the reviewing attorney, not part of the letter)
[Every meaningful hit from the report with its star/tier and a one-line rationale, and which section above it landed in. Note any anomaly in one line (e.g. a mark whose status doesn't match its star) rather than silently fixing it.]`;

export type OpinionLetterMatterFacts = {
  markText: string;
  markType: "word mark" | "design mark";
  internationalClasses: number[] | null;
  goodsServices: string | null;
  clientName: string;
  entityName: string | null;
  clientEmail: string | null;
  honorific: string | null; // "Mr." | "Ms." | "" (none) | other — always asked, never inferred
  letterDate: string; // "Month D, YYYY"
};

export type OpinionLetterDraft = {
  headline: string;
  summary: string;
  draftBody: string;
};

function userPrompt(facts: OpinionLetterMatterFacts, extractedText: string): string {
  const classes = facts.internationalClasses?.length
    ? `International Class(es): ${facts.internationalClasses.join(", ")}`
    : "International Class(es): [confirm from the report]";
  return `Client/applicant facts (use exactly as given — do not invent or guess anything not listed here):
- Proposed mark: ${facts.markText} (${facts.markType})
- ${classes}
- Goods/services as filed: ${facts.goodsServices ?? "[confirm from the report/consult]"}
- Client name: ${facts.clientName}
- Entity name: ${facts.entityName ?? "(none on file — use the individual's name)"}
- Honorific: ${facts.honorific ? facts.honorific : "(none — use the full name, no honorific)"}
- Email: ${facts.clientEmail ?? "[confirm]"}
- Letter date: ${facts.letterDate}

TMTKO Knockout Report text (extracted from the uploaded file — read it in full; this is the ONLY source for every citation, mark name, registration/serial number, owner, status, and goods/services in the letter):
"""
${extractedText}
"""`;
}

/**
 * Runs the opinion-letter SOP via Claude and returns the queue-ready draft.
 * Throws DocumentFlowError when neither VERCEL_AI_GATEWAY_KEY nor
 * ANTHROPIC_API_KEY is set — there is
 * no reasonable fallback for this flow the way enrichment has one, so the
 * caller should surface this as a form error rather than silently degrading.
 */
export async function buildOpinionLetterDraft(
  facts: OpinionLetterMatterFacts,
  extractedText: string,
): Promise<OpinionLetterDraft> {
  const result = await askClaude({
    system: SYSTEM_PROMPT,
    prompt: userPrompt(facts, extractedText),
    maxTokens: 4096,
  });

  if ("skipped" in result) {
    throw new DocumentFlowError(
      "No AI provider is configured for this deployment (VERCEL_AI_GATEWAY_KEY or ANTHROPIC_API_KEY) — the opinion letter can't be drafted right now.",
    );
  }

  const clientOrEntity = facts.entityName?.trim() || facts.clientName;
  return {
    headline: `Opinion letter DRAFT — ${clientOrEntity} — ${facts.markText}`,
    summary: `Clearance opinion letter draft assembled from the uploaded TMTKO report for ${facts.markText}.`,
    draftBody: result.text.trim(),
  };
}
