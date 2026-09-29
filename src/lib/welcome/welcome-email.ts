/**
 * Welcome-email DRAFT assembly — the `welcome-client` skill
 * (lectual-plugin skills/welcome-client/SKILL.md), Step 3: "Queue the
 * welcome email draft from the firm template: from Rebecca, cc Trademarks,
 * trademark questionnaire attached. Variable fields only (client name,
 * mark/matter)."
 *
 * DETERMINISTIC ON PURPOSE — no AI call. The SOP's Hard Rule 2 is explicit:
 * "Use the firm's existing Lawmatics template ... do not rewrite it. If the
 * template can't be read, queue a draft that names the template and fills
 * only the variable fields." This app has no integration that reads the
 * real Lawmatics template content, so it is always in the "can't be read"
 * branch — an LLM asked to improvise the firm's welcome-email boilerplate
 * would be doing exactly what Hard Rule 2 forbids. Matching
 * buildTrademarkLoeDraft's reasoning in src/lib/documents/loe.ts: this does
 * verbatim transcription of the variable fields into a fixed shape, not
 * generation.
 *
 * The trademark intake questionnaire is likewise an EXTERNAL Lawmatics form
 * link this app has no source for — the draft says so explicitly rather
 * than fabricating a URL (same "missing detail -> bracketed placeholder,
 * never a guess" rule the opinion-letter SOP states directly).
 */

export type WelcomeEmailInput = {
  /** Entity name if on file, else the individual's name — resolved by the caller. */
  clientOrEntityName: string;
  /** matter.mark_text — null when the mark hasn't been recorded yet. */
  markText: string | null;
  matterNumber: string;
  /** The linked lead's email, when there is one. */
  clientEmail: string | null;
  sendDateIso: string; // YYYY-MM-DD
};

export type WelcomeEmailDraft = {
  headline: string;
  summary: string;
  subject: string;
  recipient: string | null;
  draftBody: string;
};

export function buildWelcomeEmailDraft(input: WelcomeEmailInput): WelcomeEmailDraft {
  const markSuffix = input.markText ? ` — ${input.markText}` : "";
  const subject = `Welcome to RPB Law${input.markText ? ` — ${input.markText}` : ""}`;

  const draftBody = `# ${input.clientOrEntityName} — Welcome email DRAFT — ${input.matterNumber}

Template: **Trademark client welcome email** (Lawmatics — use the firm's saved template
verbatim; this draft fills only the variable fields below, per the welcome-client SOP's
Hard Rule 2 — never rewrite the template).

From: Rebecca P. Beliard, Esq.
Cc: Trademarks
To: ${input.clientEmail ?? "[confirm client email on the lead record]"}
Subject: ${subject}

## Variable fields to drop into the template
- Client / entity name: ${input.clientOrEntityName}
- Matter: ${input.matterNumber}${input.markText ? ` (${input.markText})` : ""}
- Send date: ${input.sendDateIso}

## Trademark intake questionnaire
Attach/link the trademark questionnaire — this is an EXTERNAL Lawmatics intake form link;
Lectual has no integration that can generate or verify it, so confirm the correct form link
in Lawmatics before sending rather than trusting a guessed one.

## Human steps remaining
1. Open the **Trademark client welcome email** template in Lawmatics for this matter.
2. Confirm the variable fields above and attach/link the trademark questionnaire.
3. Review, save, send.
4. Follow-through: once the client completes the questionnaire, notify Rain directly —
   the automatic notification has been unreliable (per the welcome-client SOP); do not
   rely on it firing on its own.`;

  return {
    headline: `Welcome email DRAFT — ${input.clientOrEntityName}${markSuffix}`,
    summary: `Welcome email for ${input.clientOrEntityName} (${input.matterNumber}) — names the firm's welcome-email template and the trademark questionnaire link; follow-through note: notify Rain once the questionnaire is complete.`,
    subject,
    recipient: input.clientEmail,
    draftBody,
  };
}
