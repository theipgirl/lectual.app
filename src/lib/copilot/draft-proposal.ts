import { hash } from "node:crypto";
import { clientFromLead, buildBrandNames, type LeadFill, type ConsultBrand } from "@/lib/proposals/prefill";
import { findPackage, normalisePackages, packageOption } from "@/lib/proposals/package-list";
import { buildNewContent, cleanId, parseMoney, parsePercent } from "@/lib/proposal-editor/form";
import { formatDollars } from "@/lib/proposal-editor/events";
import { MAX_MARKS } from "@/lib/consult/vocab";
import { isMarkKind, standardProposalPricing, type MarkKind, type ProposalAdjustment, type ProposalContent } from "@/lib/proposals/types";
import { MAX_CLASSES_PER_BRAND, validateContent, type ValidationIssue } from "@/lib/proposals/validate";

/**
 * The pure rules of Copilot's one draft-only tool, `draft_proposal`. No
 * database, no model, no clock. The executor (`@/lib/agents/copilot-draft-proposal`)
 * reads the lead and the firm's packages through the caller's scoped client and
 * hands them here; the content is built with the SAME helpers New proposal uses
 * (`clientFromLead`, `buildBrandNames`, `findPackage` over `normalisePackages`,
 * `buildNewContent`) and checked with `validateContent`.
 *
 * ── THE CONFIRMATION RULE, IN CODE ──────────────────────────────────────────
 * The system prompt tells the model to summarise and ask first. The code does not
 * rely on that:
 *  - a call without `confirmed: true` never writes. It returns the draft, and the
 *    SERVER (not the model) appends the exact summary and "Create this draft?
 *    (draft ref <ref>)" to the answer (`withConfirmation`). The ref is a hash of
 *    the firm and the resolved draft (`draftRef`).
 *  - a call with `confirmed: true` writes only when the user's CURRENT message is a
 *    plain yes (`isConfirmation`) AND the previous answer in the thread carries
 *    the ref of exactly this draft. A different draft, or a "yes, but ...", gets a
 *    new summary instead. At most one draft is created per question.
 *  - neither runs unless a user turn in the visible thread asked for a proposal
 *    (`askedForProposal`).
 * The thread is sent by the browser, i.e. by the signed-in person: they can only
 * confirm for themselves. What the rule stops is the model (or text inside a
 * record it read) creating a draft the person never saw and agreed to.
 */

export const DRAFT_PROPOSAL_TOOL = "draft_proposal";
export const CONFIRM_QUESTION = "Create this draft?";
export const MAX_LEAD_TEXT = 200;
export const MAX_PACKAGE_TEXT = 120;
export const MAX_BRAND_TEXT = 300;
export const MAX_CLASS_TEXT = 300;
export const MAX_DISCOUNT_LABEL = 120;

/* ───────────────────────── the request ──────────────────────────────────── */

export type DraftBrand = { name: string; marks: MarkKind[]; classes: string[] };
export type DraftDiscount = { label: string; kind: "amount" | "percent"; /** amount: cents; percent: 0..100 */ value: number };

export type DraftRequest = {
  lead: string;
  packageName: string;
  brands: DraftBrand[];
  discount: DraftDiscount | null;
  payLink: string | null;
  confirmed: boolean;
};

/** A request the tool can use, or the one thing to ask the user. */
export type ParsedRequest = { ok: true; value: DraftRequest } | { ok: false; ask: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function parseDraftRequest(raw: unknown): ParsedRequest {
  const input = isObj(raw) ? raw : {};
  const ask = (q: string): ParsedRequest => ({ ok: false, ask: q });

  const lead = text(input.lead);
  if (!lead) return ask("Which lead is this proposal for?");
  if (lead.length > MAX_LEAD_TEXT) return ask("Give the lead's name or id in fewer words.");

  const packageName = text(input.package);
  if (!packageName) return ask("Which of the firm's packages should the proposal use?");
  if (packageName.length > MAX_PACKAGE_TEXT) return ask("Which of the firm's packages should the proposal use?");

  const rawBrands = Array.isArray(input.brands) ? input.brands : [];
  if (rawBrands.length === 0) return ask("Which brand names should the proposal cover, with their marks (word, logo) and what each is used for?");
  if (rawBrands.length > MAX_MARKS) return ask(`A proposal can hold at most ${MAX_MARKS} brand names. Which ones should this one cover?`);
  const brands: DraftBrand[] = [];
  for (const rb of rawBrands) {
    const b = isObj(rb) ? rb : {};
    const name = text(b.name);
    if (!name || name.length > MAX_BRAND_TEXT) return ask("What is each brand name, exactly as it should read?");
    const marks = [...new Set((Array.isArray(b.marks) ? b.marks : []).map((m) => text(m).toLowerCase()))];
    if (marks.length === 0 || !marks.every(isMarkKind)) return ask(`Should ${name} have a word mark, a logo mark, or both?`);
    const classes = (Array.isArray(b.classes) ? b.classes : []).map(text).filter(Boolean);
    if (classes.length === 0) return ask(`What is ${name} used for? Describe each class in plain business words.`);
    if (classes.length > MAX_CLASSES_PER_BRAND) {
      return ask(`${name} has more than ${MAX_CLASSES_PER_BRAND} classes. Which ${MAX_CLASSES_PER_BRAND} should this brand name cover? The rest can go on a second brand name.`);
    }
    if (classes.some((c) => c.length > MAX_CLASS_TEXT)) return ask(`Describe each class for ${name} more briefly.`);
    brands.push({ name, marks: (["word", "logo"] as const).filter((k) => marks.includes(k)), classes });
  }

  let discount: DraftDiscount | null = null;
  if (input.discount != null) {
    const d = isObj(input.discount) ? input.discount : {};
    const kind = d.kind === "amount" || d.kind === "percent" ? d.kind : null;
    if (!kind) return ask("Is the discount a dollar amount or a percent?");
    const label = text(d.label) || "Discount";
    if (label.length > MAX_DISCOUNT_LABEL) return ask("What should the discount be called, in a few words?");
    const rawValue = typeof d.value === "number" || typeof d.value === "string" ? String(d.value) : "";
    const value = kind === "amount" ? parseMoney(rawValue, "Discount") : parsePercent(rawValue, "Discount");
    if (!value.ok) return ask(`${value.error} What is the discount?`);
    discount = { label, kind, value: value.value };
  }

  const payLink = text(input.payLink) || null;
  if (payLink) {
    const issue = validateContent({}, { pay_url: payLink }).find((i) => i.path === "pay_url");
    if (issue) return ask(`${issue.message} What is the pay link?`);
  }

  return { ok: true, value: { lead, packageName, brands, discount, payLink, confirmed: input.confirmed === true } };
}

/* ───────────────────────── the draft ────────────────────────────────────── */

export type DraftLead = LeadFill;

export type BuiltDraft = {
  leadId: string;
  clientName: string;
  clientEmail: string | null;
  packageName: string;
  content: ProposalContent;
  payLink: string | null;
  /** Problems the user must fix before anything is created (a class number in a label ...). */
  blocking: string[];
  /** Problems the draft may carry; staff fix them in the editor. */
  issues: string[];
  /** The plain summary the user confirms. */
  summary: string;
};

export type BuildResult = { ok: true; draft: BuiltDraft } | { ok: false; kind: "package_not_found"; packages: string[] } | { ok: false; kind: "no_client_name" };

/** Paths that come from what the user said: an error there is theirs to fix before anything is created. */
const USER_PATHS = /^(names\[|adjustments\[|pay_url)/;

/**
 * The draft for `request` and this lead, against the firm's saved package list
 * (`pricing` = `client_proposal_setting.pricing`, or `{}` when none is saved: the
 * same list New proposal offers). A package that is not on the list is never
 * guessed. Prices come from the package only.
 */
export function buildDraft(request: DraftRequest, lead: DraftLead, pricing: unknown, rand: () => string): BuildResult {
  const packages = normalisePackages(pricing ?? {});
  const chosen = findPackage(packages, request.packageName);
  if (!chosen) return { ok: false, kind: "package_not_found", packages: packages.map((p) => p.package) };

  const client = clientFromLead(lead);
  if (!client.fullName) return { ok: false, kind: "no_client_name" };

  const standard = standardProposalPricing(pricing ?? {});
  standard.pricing = { ...chosen };
  const brands: ConsultBrand[] = request.brands.map((b) => ({ name: b.name, kinds: b.marks, classes: b.classes, dropped: 0 }));
  const names = buildBrandNames({ typed: "", brands, rand });
  const content = buildNewContent({
    firstName: client.firstName,
    fullName: client.fullName,
    company: client.company,
    names,
    standard,
    packageBasis: { name: chosen.package, edited: [] },
    rand,
  });
  if (request.discount) {
    const taken = new Set<string>(names.flatMap((n) => [n.id, ...n.marks.map((m) => m.id), ...n.classes.map((c) => c.id)]));
    const adjustment: ProposalAdjustment = { id: cleanId("", "a", taken, rand), label: request.discount.label, kind: request.discount.kind, value: request.discount.value };
    content.adjustments = [adjustment];
  }

  const found = validateContent(content, { pay_url: request.payLink, client_email: client.clientEmail || null });
  const blocking = found.filter((i) => i.level === "error" && USER_PATHS.test(i.path)).map((i) => i.message);
  const issues = found.filter((i) => !(i.level === "error" && USER_PATHS.test(i.path))).map((i) => i.message);

  const draft: Omit<BuiltDraft, "summary"> = {
    leadId: lead.id,
    clientName: client.fullName,
    clientEmail: client.clientEmail || null,
    packageName: chosen.package,
    content,
    payLink: request.payLink,
    blocking: [...new Set(blocking)],
    issues: [...new Set(issues)],
  };
  return { ok: true, draft: { ...draft, summary: draftSummary(draft, packageOption(chosen).summary, request) } };
}

function draftSummary(draft: Omit<BuiltDraft, "summary">, packageWords: string, request: DraftRequest): string {
  const lines = [`- Client: ${draft.clientName}${draft.clientEmail ? ` (${draft.clientEmail})` : ""}`, `- Package: ${draft.packageName} (${packageWords})`];
  for (const b of request.brands) {
    const marks = b.marks.length === 2 ? "word and logo marks" : `${b.marks[0]} mark`;
    lines.push(`- ${b.name}: ${marks}; classes: ${b.classes.join("; ")}`);
  }
  if (request.discount) {
    const amount = request.discount.kind === "amount" ? `${formatDollars(request.discount.value)} off` : `${request.discount.value}% off`;
    lines.push(`- Discount: ${request.discount.label}, ${amount}`);
  }
  lines.push(`- Pay link: ${draft.payLink ?? "none yet (add it before the link is created)"}`);
  return lines.join("\n");
}

/** The leads a name search found, as the model may show them. */
export type LeadChoice = { id: string; name: string; businessName: string | null; email: string | null };

/* ───────────────────────── the confirmation ─────────────────────────────── */

/**
 * The firm and the resolved draft, hashed. Equal refs mean the same lead,
 * package, brand names, marks, classes, discount and pay link for the same firm.
 */
export function draftRef(orgId: string, draft: Pick<BuiltDraft, "leadId" | "packageName" | "payLink">, request: Pick<DraftRequest, "brands" | "discount">): string {
  const canonical = JSON.stringify([orgId, draft.leadId, draft.packageName, request.brands, request.discount, draft.payLink]);
  return hash("sha256", canonical, "hex").slice(0, 12);
}

export const refTag = (ref: string): string => `(draft ref ${ref})`;

/** What the user is asked, added to the answer by the server: the exact draft and the question. */
export function confirmationBlock(summary: string, ref: string): string {
  return [
    "Draft proposal to create:",
    summary,
    "It is created as a draft only: nothing is approved, no client link is made and nothing is sent. Staff review it before anything reaches the client.",
    `${CONFIRM_QUESTION} ${refTag(ref)}`,
  ].join("\n");
}

/** The model's answer with any "Create this draft?" it wrote removed, then the server's block. */
export function withConfirmation(answer: string, summary: string, ref: string): string {
  const own = answer.replace(/create this draft\?/gi, "").trim();
  const block = confirmationBlock(summary, ref);
  return own ? `${own}\n\n${block}` : block;
}

const CONFIRM_WORDS =
  /^(?:(?:yes|yep|yeah|y|ok|okay|sure|confirm|confirmed|correct|please|go ahead|do it|please do|create it|create the draft|create this draft|create that draft|looks good|sounds good|that'?s right|thanks|thank you)\s*)+$/;

/** A plain yes, and nothing else: "yes", "Yes, create it.", "ok go ahead". "Yes but change the package" is not one. */
export function isConfirmation(message: string): boolean {
  const m = message
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.,!;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!m || m.length > 60) return false;
  if (/\b(?:no|not|don'?t|but|change|instead|wait|except|without|cancel|stop)\b/.test(m)) return false;
  return CONFIRM_WORDS.test(m);
}

/** True when the previous answer asked to confirm exactly this draft. */
export function confirmsDraft(previousAnswer: string | null, ref: string): boolean {
  return !!previousAnswer && previousAnswer.includes(`${CONFIRM_QUESTION} ${refTag(ref)}`);
}

/** A user turn in the visible thread asked for a proposal (or a quote). */
export function askedForProposal(userTurns: readonly string[]): boolean {
  return userTurns.some((t) => /\b(?:proposals?|quotes?)\b/i.test(t));
}

/** Everything the tool needs to know about the thread, computed by the server from the request. */
export type ConfirmationContext = {
  orgId: string;
  /** The user's current message, trimmed, without any page context. */
  question: string;
  /** The answer right before it, when the thread's last turn is an answer. */
  previousAnswer: string | null;
  /** Every user turn the request carried, the current one included. */
  userTurns: string[];
};

export function confirmationContext(orgId: string, question: string, history: ReadonlyArray<{ role: "user" | "assistant"; content: string }>): ConfirmationContext {
  const last = history[history.length - 1];
  return {
    orgId,
    question: question.trim(),
    previousAnswer: last && last.role === "assistant" ? last.content : null,
    userTurns: [...history.filter((t) => t.role === "user").map((t) => t.content), question],
  };
}

export type { ValidationIssue };
