import "server-only";
import { askClaude } from "@/lib/ai/claude";
import { PrepConsultFlowError } from "./errors";
import { assertNoJudgmentContent, type PrepConsultDraft, type PrepConsultFacts } from "./prep-consult";

/**
 * HEADS-UP + CLIENT-PREP draft assembly — the `prep-consult` skill's two
 * booking-triggered deliverables (lectual-plugin skills/prep-consult/
 * SKILL.md, § HEADS-UP and § CLIENT-PREP EMAIL). Read at build time, not
 * imported at runtime; the system prompts below are this app's own copy of
 * those sections' operative rules and canonical formats, kept in sync by
 * hand — same convention as src/lib/documents/opinion-letter.ts.
 *
 * The skill's third mode — the on-demand FULL BRIEF with Nice classes, a
 * preliminary risk read, and a package recommendation — is out of scope here
 * on purpose (see prep-consult.ts's header comment). Both system prompts
 * below forbid that content explicitly, and every draft this file returns is
 * re-checked by assertNoJudgmentContent before the caller may queue it.
 */

const HEADS_UP_SYSTEM_PROMPT = `You are drafting an internal "consult booked" heads-up email to Rebecca P. Beliard, Esq. at RPB Law, PLLC, following the firm's prep-consult SOP exactly. The reader is Rebecca herself — this is INTERNAL ONLY, never sent to a client.

HARD RULES:
1. Use ONLY the facts given below. Never invent a mark name, a fact about the client, a Nice classification class, a risk tier (green/yellow/red), a package name (Essential/Enhanced/Concierge), or a dollar figure — none of that belongs in a booking heads-up, and all of it is attorney judgment reserved for the full pre-consult brief, which this email is not.
2. If a fact is missing or blank, say so plainly (e.g., "practice area not specified," "session time not yet scheduled") rather than guessing or inventing one.
3. "Nature of the matter" is a faithful 2-3 sentence summary of the client's own inquiry description, quoting the key phrase — never embellished or extrapolated beyond what was given.
4. "Flags to probe" lists anything Rebecca should clarify or watch for — inconsistencies, blank fields, referral-source mismatches, payment status, multi-practice scope — drawn ONLY from what's given below. If nothing stands out, say "Nothing unusual — looks like a clean, straightforward booking."
5. Keep every bullet to what's actually known. Do not pad with boilerplate.

OUTPUT FORMAT — plain text, match this structure exactly, including the bullet list and bold field labels:

To: Rebecca
Subject: Consult booked — [Client Name] ([Practice Area])

Hi Rebecca,
You have a strategy session with [Full Name] [day, date, time, timezone — or "[session date/time — pending]" if not given] (Zoom: [link, or "pending"]).

* Practice area: [verbatim from the facts given]
* Nature of the matter: [2-3 sentence faithful summary, quoting the key phrase]
* Flags to probe: [everything worth Rebecca's attention, or the "nothing unusual" line]

— Lectual`;

const CLIENT_PREP_SYSTEM_PROMPT = `You are drafting a client-facing email for RPB Law, PLLC confirming an upcoming Legal Strategy Session and requesting what that specific consult needs. Voice: warm, professional (rebecca-voice — direct, confident, no legalese). From: RPB Law Operations. This draft is QUEUED FOR APPROVAL — it is never sent automatically, and you are not providing legal advice.

HARD RULES:
1. Confirm ONLY the real appointment details given below (date/time, Zoom link). If either is missing, use the bracketed pending placeholder shown in the template — NEVER invent a time or a link.
2. Request only what THIS matter genuinely needs, adapted from the practice area and the client's own inquiry description, using this reference table:
   - Trademark-filing consult -> the exact mark(s) and any logo files; the goods/services they sell; whether they're already using the mark in commerce; any similar names/competitors they're aware of.
   - Contract review / redline -> the contract and any related agreements; their role (granting vs. receiving rights); the deal timeline/deadline; specific clauses of concern.
   - Business formation / general / entertainment -> a short description of the venture and where it stands (entity started? partners?); any contracts or projects in progress; their top one or two priorities for the call.
   - "Other" or an ambiguous inquiry -> derive the ask from the description; when unsure, keep it light: a one-line "anything relevant to your inquiry" plus their top priority.
3. Never demand a document that doesn't apply to this matter. Never mention a Nice classification class, a risk tier, a package name (Essential/Enhanced/Concierge), or any price/fee figure — none of that belongs in this email.
4. Only mention the consult fee being paid if you are explicitly told it was — otherwise omit that clause entirely rather than guessing.

OUTPUT FORMAT — plain text, match this structure exactly:

To: [client email]
From: RPB Law Operations
Subject: Preparing for your strategy session — [Day M/D] at [time] ET (or a sensible subject if the time isn't yet known)

Dear [Mr./Ms. Last Name, or the client's full name if no honorific is known],

Thank you for scheduling a Legal Strategy Session with RPB Law. We're looking forward to speaking with you on [Weekday, Month D at time ET — or "at a time we'll confirm shortly" if not yet scheduled].

Join via Zoom: [zoom link, or "we'll send the Zoom link once it's confirmed" if not given]

[One line tying the request to their inquiry.] So Rebecca can make the most of your time, it would help to have any of the following in advance — please share only what's readily available:

- [matter-specific item]
- [matter-specific item]
- [matter-specific item]
- Your top one or two priorities for the call

You're welcome to reply with anything ahead of time, or simply bring it to the call.

Warm regards,
RPB Law
333 SE 2nd Avenue, Suite 2000, Miami, FL 33131 · (305) 712-6960`;

function factsBlock(facts: PrepConsultFacts): string {
  return `Client name: ${facts.clientName}
Client email: ${facts.clientEmail}
Practice area: ${facts.practiceArea}
Client's own description of the inquiry: "${facts.inquiryDescription}"
Session date/time (staff-entered, exactly as given — do not reformat or invent a timezone if none is stated): ${facts.sessionWhen ?? "(not yet scheduled)"}
Zoom link: ${facts.zoomLink ?? "(not yet available)"}`;
}

async function runDraftPrompt(system: string, prompt: string, where: string): Promise<string> {
  const result = await askClaude({ system, prompt, maxTokens: 1024 });
  if ("skipped" in result) {
    throw new PrepConsultFlowError(
      `The ${where} couldn't be drafted right now: either no AI key is set up on this deployment (ANTHROPIC_API_KEY) or the model didn't return a draft. Nothing was queued.`,
    );
  }
  const text = result.text.trim();
  assertNoJudgmentContent(text, where);
  return text;
}

/** Builds the internal booking heads-up (queued as type = BRIEFING — see generate.ts). */
export async function buildHeadsUpDraft(facts: PrepConsultFacts): Promise<PrepConsultDraft> {
  const draftBody = await runDraftPrompt(
    HEADS_UP_SYSTEM_PROMPT,
    `Facts (use exactly as given — never invent anything not listed here):\n${factsBlock(facts)}`,
    "consult heads-up",
  );
  return {
    headline: `Consult heads-up — ${facts.clientName} (${facts.practiceArea})`,
    summary: `Internal booking heads-up for Rebecca — ${facts.clientName}, ${facts.practiceArea}.`,
    subject: `Consult booked — ${facts.clientName} (${facts.practiceArea})`,
    draftBody,
  };
}

/** Builds the client-facing prep email (queued as type = CLIENT_EMAIL — see generate.ts). */
export async function buildClientPrepDraft(facts: PrepConsultFacts): Promise<PrepConsultDraft> {
  const draftBody = await runDraftPrompt(
    CLIENT_PREP_SYSTEM_PROMPT,
    `Facts (use exactly as given — never invent anything not listed here):\n${factsBlock(facts)}`,
    "client-prep email",
  );
  return {
    headline: `Consult prep email DRAFT — ${facts.clientName} (${facts.practiceArea})`,
    summary: `Client-facing consult prep confirming the appointment and requesting matter-specific info for ${facts.clientName}.`,
    subject: `Preparing for your strategy session — ${facts.clientName}`,
    draftBody,
  };
}
