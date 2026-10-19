/**
 * The post-consult email that carries the proposal link — Rebecca's approved
 * template, rendered as plain text for the approval queue / mailbox draft.
 *
 * Pure module: no database, no network, no `server-only`.
 *
 * ── WHY THE MODEL WRITES NONE OF THIS ───────────────────────────────────────
 * Every client-facing word below is Rebecca's, verbatim, from
 * lectual-plugin/firm/templates/post-consult-email-proposal-link.md (approved
 * 2026-10-16). The only matter-specific part, the reasoning block, is assembled
 * here from her three canned paragraphs, chosen by flags the draft step
 * verified against the call (`ReasoningChoice`). The model never writes prose
 * the client reads.
 *
 * ── THE TEMPLATE'S RULES, ENFORCED HERE ─────────────────────────────────────
 *  - No pricing, no payment link and no expiry date in the email: all of that
 *    lives on the proposal page. Nothing here reads a price or a date.
 *  - The link is the proposal title ("<Client> Trademark Proposal") with the
 *    URL on the next line: never a bare URL alone, never a claude.ai link.
 *  - Signed by the firm ("The RPB Law Team"), not a person.
 *  - The second-mark sentence only when a brand offers both a word mark and a
 *    logo mark AND the firm actually gives a second-mark discount: a discount is
 *    stated accurately or not at all.
 */

import type { ProposalContent } from "@/lib/proposals/types";

/** The slots a template may use. Anything else in braces is left as written. */
export const PROPOSAL_EMAIL_SLOTS = [
  "first_name",
  "reasoning",
  "proposal_title",
  "proposal_url",
  "second_mark_sentence",
  "sign_off",
] as const;
export type ProposalEmailSlot = (typeof PROPOSAL_EMAIL_SLOTS)[number];

/**
 * Rebecca's template, verbatim, as plain text. The markdown in the source file
 * (blockquote, **bold**, the hyperlink) becomes plain lines: the queue and the
 * mailbox draft are text. "Next Steps" stays a heading line, as she asked.
 */
export const DEFAULT_PROPOSAL_EMAIL_TEMPLATE = `Hi {first_name},

Thank you again for taking the time to meet with us for your strategy call. We truly enjoyed learning more about everything you are building, and as promised, I am following up with Rebecca's recommendations and your customized legal proposal.

{reasoning}

You can review your full proposal here:
{proposal_title}
{proposal_url}

Rebecca's recommended options have already been preselected for your convenience. However, the proposal is customizable, so you can adjust the marks and classes based on your priorities and budget. {second_mark_sentence}

Next Steps

Once you have reviewed the proposal and selected your preferred options, you can accept the proposal and submit payment directly through the link provided. Our team will then prepare your engagement agreement reflecting the services you selected and send it over for your review and signature.

If you have any questions about the proposal, our recommendations, or next steps, please don't hesitate to reach out. We look forward to the opportunity to work together and help protect the brands you are building!

Best,
{sign_off}`;

/** Rebecca's sentence for a brand that offers both a word mark and a logo mark. */
export const SECOND_MARK_SENTENCE =
  "Please also note that when you elect to protect both the word mark and logo mark for the same brand, we offer a discounted rate for the second application.";

/* ─────────────────────────── the reasoning block ─────────────────────────── */

/** 1. The principle (whenever word and logo marks are both offered). */
export const REASONING_PRINCIPLE =
  "As Rebecca discussed, generally speaking, securing both a word mark and a logo mark for each brand is best practice, as each provides a different layer of trademark protection.";

/** 2. The risk, then the option (when one mark faces a known hurdle). */
export function reasoningRisk(brand: string): string {
  return `Based on the preliminary search, Rebecca anticipates that securing a word mark registration for ${brand} may present some challenges. That said, if you are in a position to pursue both the word mark and logo mark, she believes it is worth considering both options to maximize your potential protection. Of course, once we complete the comprehensive trademark searches, we can reassess our strategy and pivot as necessary based on our findings.`;
}

/** 3. What the proposal includes, and the fallback. */
export function reasoningFallback(brand: string): string {
  return `With that in mind, we have included pricing for both word mark and logo mark applications in your proposal so you can evaluate all available options for each brand. If you prefer to move forward with only one application for ${brand} at this stage, Rebecca believes the logo mark may offer a stronger path toward registration. Ultimately, her goal is to position you and your brands for the best possible outcome.`;
}

/** Which canned paragraphs apply. The draft step sets these only from verified evidence. */
export type ReasoningChoice = {
  principle: boolean;
  riskBrand: string | null;
  fallbackBrand: string | null;
};

/** The reasoning block, Rebecca's paragraphs in her order, or null when none applies. */
export function buildReasoningBlock(choice: ReasoningChoice): string | null {
  const parts: string[] = [];
  if (choice.principle) parts.push(REASONING_PRINCIPLE);
  const risk = choice.riskBrand?.trim();
  if (risk) parts.push(reasoningRisk(risk));
  const fallback = choice.fallbackBrand?.trim();
  if (fallback) parts.push(reasoningFallback(fallback));
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/* ─────────────────────────── subject + link ─────────────────────────────── */

/** "Your Trademark Proposal from RPB Law": the firm's name, no client data. */
export function proposalEmailSubject(firmName: string): string {
  const firm = firmName.replace(/\s+/g, " ").trim();
  return firm ? `Your Trademark Proposal from ${firm}` : "Your Trademark Proposal";
}

/** The link line's text: "<Client full name> Trademark Proposal". */
export function proposalLinkTitle(clientFullName: string): string {
  const name = clientFullName.replace(/\s+/g, " ").trim();
  return name ? `${name} Trademark Proposal` : "Your Trademark Proposal";
}

/** Which rule a refused link or sign-off broke, so a caller can say so without parsing the message. */
export type ProposalEmailRule = "invalid_url" | "claude_link" | "not_https" | "credentials" | "no_sign_off";

export class ProposalEmailError extends Error {
  readonly rule: ProposalEmailRule;
  constructor(message: string, rule: ProposalEmailRule) {
    super(message);
    this.name = "ProposalEmailError";
    this.rule = rule;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The proposal page URL must be the firm's own page: https (plain http only
 * on a local dev server), never a claude.ai artifact link.
 */
export function checkProposalUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ProposalEmailError("The proposal link is not a valid address.", "invalid_url");
  }
  const host = url.hostname.toLowerCase();
  if (host === "claude.ai" || host.endsWith(".claude.ai")) {
    throw new ProposalEmailError("The proposal link must be the firm's proposal page, never a claude.ai link.", "claude_link");
  }
  const local = LOCAL_HOSTS.has(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new ProposalEmailError("The proposal link must be an https:// address.", "not_https");
  }
  if (url.username || url.password) throw new ProposalEmailError("The proposal link must not carry credentials.", "credentials");
  return url.toString();
}

/** A firm template is usable only if it carries the link (title + URL) and the sign-off. */
export function isUsableEmailTemplate(template: string | null | undefined): template is string {
  return (
    typeof template === "string" &&
    template.length <= 20_000 &&
    template.includes("{proposal_title}") &&
    template.includes("{proposal_url}") &&
    template.includes("{sign_off}")
  );
}

/** True when some brand offers both a word mark and a logo mark. */
export function offersWordAndLogo(content: Pick<ProposalContent, "names">): boolean {
  return content.names.some(
    (n) => n.marks.some((m) => m.kind === "word") && n.marks.some((m) => m.kind === "logo"),
  );
}

/* ─────────────────────────── render ─────────────────────────────────────── */

export type RenderableProposalDraft = {
  content: Pick<ProposalContent, "client" | "names" | "pricing">;
  email: { subject: string; reasoning: string | null };
};

export type RenderProposalEmailOptions = {
  /** The client's proposal page, e.g. `${origin}/p/${public_token}/`. */
  proposalUrl: string;
  /** Firm override; a template without the link or sign-off slots falls back to the default. */
  template?: string | null;
  /** "The RPB Law Team". */
  signOff: string;
};

/**
 * The email, as plain text. Deterministic: same draft + options, same text.
 * Throws `ProposalEmailError` for a link that is not the firm's https page or
 * an empty sign-off; nothing half-rendered is returned.
 */
export function renderProposalEmail(
  draft: RenderableProposalDraft,
  opts: RenderProposalEmailOptions,
): { subject: string; body: string } {
  const url = checkProposalUrl(opts.proposalUrl);
  // The template already says "Best,": a sign-off that brings its own is cut back to the name.
  const signOff = opts.signOff.replace(/\r\n?/g, "\n").replace(/^\s*best(?:\s+regards)?\s*,?\s*\n+/i, "").trim();
  if (!signOff) throw new ProposalEmailError("The email needs the firm's sign-off.", "no_sign_off");

  let template = isUsableEmailTemplate(opts.template) ? opts.template : DEFAULT_PROPOSAL_EMAIL_TEMPLATE;
  template = template.replace(/\r\n?/g, "\n");

  const reasoning = draft.email.reasoning?.trim() ?? "";
  // No reasoning: the slot's paragraph goes, and so does the blank line after it.
  if (!reasoning) template = template.replace(/^[ \t]*\{reasoning\}[ \t]*\n(?:[ \t]*\n)?/m, "");

  const secondMark = offersWordAndLogo(draft.content) && draft.content.pricing.second_mark_discount_pct > 0;
  if (!secondMark) template = template.replace(/[ \t]*\{second_mark_sentence\}/g, "");

  const firstName = draft.content.client.first_name.replace(/\s+/g, " ").trim() || "[First name]";
  const values: Record<ProposalEmailSlot, string> = {
    first_name: firstName,
    reasoning,
    proposal_title: proposalLinkTitle(draft.content.client.full_name),
    proposal_url: url,
    second_mark_sentence: secondMark ? SECOND_MARK_SENTENCE : "",
    sign_off: signOff,
  };
  // One pass, so a value that happens to contain "{...}" is never substituted again.
  const body = template
    .replace(/\{([a-z_]+)\}/g, (whole, slot: string) =>
      (PROPOSAL_EMAIL_SLOTS as readonly string[]).includes(slot) ? values[slot as ProposalEmailSlot] : whole,
    )
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    // Never "Best," twice (a firm template that also writes its own closing).
    .replace(/^(Best,[ \t]*\n)(?:[ \t]*\n)*(?=Best,[ \t]*(?:\n|$))/gm, "")
    .trim();

  return { subject: draft.email.subject.replace(/\s+/g, " ").trim(), body };
}
