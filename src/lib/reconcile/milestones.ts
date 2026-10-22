import { resolveStage } from "@/lib/lawmatics/stage-map";
import { SENSITIVE_PHRASES, type EmailType } from "@/lib/intake/email-match";
import { DEFAULT_STAGE_NAMES } from "@/lib/agents/stage-keeper/mapping";
import type { StageOpt } from "./types";

/**
 * ONE milestone classifier for the three kinds of text that say how far a person got: the intake
 * sheet's notes, Lawmatics notes and mail. Pure: no I/O, safe for the browser.
 *
 * A milestone is a fact ("proposal sent"), not a stage. The order below is the order a person moves
 * through; `no_show`, `declined` and `nurture` sit outside it. Text that matches nothing returns no
 * milestone: this never guesses, and an unknown note is simply not evidence.
 *
 * Mail has a direction. Only mail the firm SENT can be a milestone (a proposal the client wrote
 * back about is not "proposal sent"); mail the firm received is at most `contacted`.
 */

export const ORDERED_MILESTONES = [
  "contacted",
  "consult_scheduled",
  "consult_held",
  "questionnaire_sent",
  "opinion_letter_sent",
  "proposal_sent",
  "follow_up_sent",
  "accepted",
  "loe_sent",
  "paid",
] as const;
export type OrderedMilestone = (typeof ORDERED_MILESTONES)[number];

/** Outside the order: a person who did not come, said no, or is parked for later. */
export const SIDE_MILESTONES = ["no_show", "declined", "nurture"] as const;
export type SideMilestone = (typeof SIDE_MILESTONES)[number];

export type Milestone = OrderedMilestone | "hired" | SideMilestone;

/** `paid` and `hired` share the top rank: either one means the person is a client. */
export function milestoneRank(milestone: Milestone): number | null {
  if (milestone === "hired") return ORDERED_MILESTONES.indexOf("paid");
  const i = (ORDERED_MILESTONES as readonly string[]).indexOf(milestone);
  return i < 0 ? null : i;
}

/** The milestones that mean the person is a client: never a stage, always "Open a matter". */
export function opensMatter(milestone: Milestone): boolean {
  return milestone === "accepted" || milestone === "paid" || milestone === "hired";
}

export const MILESTONE_LABEL: Record<Milestone, string> = {
  contacted: "Contacted",
  consult_scheduled: "Consult scheduled",
  consult_held: "Consult held",
  questionnaire_sent: "Questionnaire sent",
  opinion_letter_sent: "Opinion letter sent",
  proposal_sent: "Proposal sent",
  follow_up_sent: "Follow-up sent",
  accepted: "Accepted",
  loe_sent: "LOE sent",
  paid: "Paid",
  hired: "Hired",
  no_show: "No-show",
  declined: "Declined",
  nurture: "Nurture",
};

/** The highest-ranked ordered milestone among these, or null when none is ordered. */
export function topMilestone(milestones: readonly Milestone[]): Milestone | null {
  let best: Milestone | null = null;
  let bestRank = -1;
  for (const m of milestones) {
    const rank = milestoneRank(m);
    if (rank !== null && rank > bestRank) {
      best = m;
      bestRank = rank;
    }
  }
  return best;
}

// ── text ─────────────────────────────────────────────────────────────────────

/**
 * Lower-case, accent-folded, with the firm's shorthand spelled out: "f/u" is a follow-up, "OL" an
 * opinion letter, "LVM" a left voicemail. Dates ("10/14", "10.12.26") are removed so they cannot
 * be read as words, and dashes become clause breaks.
 */
export function normalizeNote(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\bf\s*\/\s*u\b|\bf-u\b|\bfu\b/g, "follow up")
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clauses are cut at ; , . – — and a spaced hyphen, so a negation never reaches into the next one. */
function clausesOf(normalized: string): string[] {
  return normalized
    .split(/\s*[;,.–—]\s*|\s-\s|\s*\n\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** A negation or a not-yet inside the span a rule matched (or the three words before it). */
const NEGATION =
  /\b(?:not|never|no|cannot|can't|couldn't|didn't|doesn't|hasn't|haven't|wasn't|won't|isn't|unable|without|cancel(?:l?ed)?|postponed|missed|to be|needs? to|need|will|plan(?:s|ning)? to|going to|pending|ready to|once|until|if|waiting|awaiting|should|hold off)\b/;

const SENT_VERBS = "sent|emailed|e-mailed|delivered|shared|forwarded|issued|provided|went out";

/** "sent <noun>" or "<noun> sent", within one clause. */
function sentWith(noun: string): RegExp {
  return new RegExp(
    `\\b(?:${SENT_VERBS})\\b[^,;]{0,30}?\\b(?:${noun})\\b|\\b(?:${noun})\\b[^,;]{0,15}?\\b(?:${SENT_VERBS}|out)\\b`,
  );
}

type Rule = { milestone: Milestone; pattern: RegExp; /** Negations inside the match are part of its meaning ("not interested"). */ negatable?: boolean };

const PROPOSAL = "proposal|quote|pricing|fee quote";
const OPINION = "opinion letter|opinion|search opinion|ol|clearance report";
const QUESTIONNAIRE = "questionnaire|intake form|interest form";
const LOE = "loe|engagement letter|engagement agreement|retainer agreement|invoice";
const FOLLOW_UP = "follow up|followup|check in|checking in|nudge|reminder";

/**
 * The table. A clause can match several rules (a note says "consult done, sent proposal" in one
 * breath); the caller takes the highest ordered milestone, and keeps the others as evidence.
 */
const RULES: readonly Rule[] = [
  // outside the order first
  {
    milestone: "no_show",
    pattern:
      /\bno[- ]?show\b|\bnoshow\b|\bdid not (?:attend|show|come)\b|\bdidn't (?:attend|show|come)\b|\bnever (?:showed|attended|came)\b|\bmissed (?:the |their |her |his )?(?:consult\w*|call|meeting|session|appointment)\b|\bwas absent\b/,
    negatable: false,
  },
  {
    milestone: "declined",
    pattern:
      /\bdeclined\b|\bnot interested\b|\bno longer interested\b|\bwent with (?:another|someone else|a different)\b|\bchose (?:another|someone else)\b|\bdecided not to (?:move forward|proceed|hire|file)\b|\bpassed on\b|\bgoing elsewhere\b|\bmarked lost\b|\blost lead\b|\bclosed (?:out|lost)\b/,
    negatable: false,
  },
  {
    milestone: "nurture",
    pattern: /\bnurture\b|\bcircle back\b|\bcheck back\b|\bnot ready (?:yet|now)\b|\bon hold\b|\bkeep warm\b|\brevisit (?:in|next)\b/,
    negatable: false,
  },
  // the order, from the bottom
  {
    milestone: "contacted",
    pattern:
      /\blvm\b|\bleft (?:a )?(?:vm|voicemail|voice mail|message)\b|\bvoicemail\b|\bcalled\b|\btexted\b|\btext message\b|\bspoke (?:with|to)\b|\btalked (?:with|to)\b|\breached out\b|\breplied\b|\bresponded\b|\bcontacted\b|\binquir\w+\b|\bemailed\b|\bsent [^,;]{0,40}?\blink\b/,
  },
  {
    milestone: "consult_scheduled",
    pattern:
      /\b(?:schedul\w*|booked|set up|confirmed|calendared|invite sent)\b[^,;]{0,25}?\b(?:consult\w*|call|session|meeting|appointment)\b|\b(?:consult\w*|call|session|meeting|appointment)\b[^,;]{0,25}?\b(?:scheduled|booked|set for|set up|confirmed|on the calendar)\b|\bresched\w*\b/,
  },
  {
    milestone: "consult_held",
    pattern:
      /\b(?:consult\w*|strategy session|discovery call|call|meeting|session)\b[^,;]{0,25}?\b(?:done|complete[d]?|held|happened|attended|finished|took place)\b|\b(?:met with|had (?:a |the |our )?(?:consult\w*|call|meeting|session))\b|\bpost[- ]?consult\w*\b|\bfollowing our (?:call|consult\w*|meeting)\b|\battended\b/,
  },
  { milestone: "questionnaire_sent", pattern: sentWith(QUESTIONNAIRE) },
  { milestone: "opinion_letter_sent", pattern: sentWith(OPINION) },
  { milestone: "proposal_sent", pattern: sentWith(PROPOSAL) },
  { milestone: "follow_up_sent", pattern: new RegExp(`${sentWith(FOLLOW_UP).source}|\\bfollowed up\\b`) },
  {
    milestone: "accepted",
    pattern:
      /\b(?:accepted|signed|agreed to|approved)\b[^,;]{0,25}?\b(?:proposal|quote|package|loe|engagement|terms)\b|\b(?:proposal|quote|package|loe|engagement)\b[^,;]{0,20}?\b(?:accepted|signed|approved)\b|\b(?:client|pnc|cl) (?:accepted|said yes|wants to proceed|is moving forward|will move forward)\b|\bwants to proceed\b|\bready to (?:move forward|proceed|hire)\b/,
  },
  { milestone: "loe_sent", pattern: sentWith(LOE) },
  {
    milestone: "paid",
    pattern:
      /\bpaid\b|\bpayment (?:received|made|processed|complete[d]?|came in)\b|\bdeposit (?:received|paid|made|in)\b|\bretainer (?:received|paid)\b|\breceived (?:the |their )?(?:payment|deposit)\b/,
  },
  { milestone: "hired", pattern: /\bhired\b|\bonboarded\b|\bis now a client\b|\bbecame a client\b/ },
];

/** Every milestone a note or Lawmatics note says. Empty for text that says none. */
export function classifyNote(text: string | null | undefined): Milestone[] {
  if (!text) return [];
  const found = new Set<Milestone>();
  for (const clause of clausesOf(normalizeNote(text))) {
    const noShow = RULES[0].pattern.test(clause);
    for (const rule of RULES) {
      const m = rule.pattern.exec(clause);
      if (!m) continue;
      if (rule.negatable !== false) {
        // The match itself and the three words before it: "did not attend", "proposal not sent yet".
        const before = clause.slice(0, m.index).split(" ").slice(-3).join(" ");
        if (NEGATION.test(`${before} ${m[0]}`)) continue;
      }
      // A consult the person missed was not held.
      if (rule.milestone === "consult_held" && noShow) continue;
      found.add(rule.milestone);
    }
  }
  return [...found];
}

// ── mail ─────────────────────────────────────────────────────────────────────

/** What the mailbox sync's own classifier stored for a message the firm SENT. */
const SENT_TYPE_MILESTONE: Partial<Record<EmailType, Milestone>> = {
  "strategy-session-link": "contacted",
  "discovery-call": "consult_scheduled",
  "post-consult": "consult_held",
  "follow-up": "follow_up_sent",
  "loe-invoice": "loe_sent",
  questionnaire: "questionnaire_sent",
  "opinion-letter": "opinion_letter_sent",
};

const SUBJECT_RULES: ReadonlyArray<{ milestone: Milestone; pattern: RegExp }> = [
  { milestone: "paid", pattern: /\bpayment received\b|\breceipt\b|\bpaid in full\b|\bthank you for your payment\b/ },
  { milestone: "loe_sent", pattern: /\bengagement (?:letter|agreement)\b|\bloe\b|\binvoice\b/ },
  { milestone: "follow_up_sent", pattern: /\bfollow(?:ing)? ?up\b|\bchecking in\b|\bcircling back\b/ },
  { milestone: "proposal_sent", pattern: /\bproposal\b|\bquote\b/ },
  { milestone: "opinion_letter_sent", pattern: /\bopinion letter\b|\bsearch opinion\b|\btrademark opinion\b/ },
  { milestone: "questionnaire_sent", pattern: /\bquestionnaire\b|\bintake form\b|\binterest form\b/ },
  { milestone: "consult_held", pattern: /\bpost[- ]?consult\w*\b|\bfollowing our call\b|\bthank you for (?:meeting|speaking)\b|\bgreat (?:speaking|meeting|chatting)\b/ },
  { milestone: "consult_scheduled", pattern: /\bdiscovery call\b/ },
  { milestone: "contacted", pattern: /\bstrategy session\b|\blegal strategy\b/ },
];

export type MailDirection = "sent" | "received";

/**
 * Milestones one message stands for. `storedType` is the sync's own classification when the message
 * is already on a timeline; the subject is read too, because the sync has no "proposal" type (a
 * "Your Trademark Proposal" mail is filed as `other`). A thread about a dispute says nothing, and a
 * calendar reply ("Accepted: ...") is not an acceptance of anything.
 */
export function classifyMail(input: {
  subject: string | null | undefined;
  direction: MailDirection;
  storedType?: string | null;
}): Milestone[] {
  const subject = normalizeNote((input.subject ?? "").replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, ""));
  if (SENSITIVE_PHRASES.some((p) => subject.includes(p))) return [];
  if (/^(?:accepted|declined|tentative|canceled|cancelled)\s*:/.test(subject)) return [];
  if (input.direction === "received") return ["contacted"];

  const found = new Set<Milestone>();
  const fromType = input.storedType ? SENT_TYPE_MILESTONE[input.storedType as EmailType] : undefined;
  if (fromType) found.add(fromType);
  for (const rule of SUBJECT_RULES) if (rule.pattern.test(subject)) found.add(rule.milestone);
  if (found.size === 0) found.add("contacted");
  return [...found];
}

// ── milestone -> the firm's stage ────────────────────────────────────────────

/** The milestones that can name a stage. The matter-opening ones never do; neither does `no_show`. */
export type StageMilestone = Exclude<Milestone, "accepted" | "paid" | "hired" | "no_show">;

/**
 * The one table of default stage names. Candidates are tried in order and the first the firm has
 * wins. A milestone with no candidate the firm has gives NO proposal: nothing falls back to the
 * first stage. `follow_up_sent` deliberately omits the bare "Follow-Up" stage, which is where a
 * person is parked, not where a follow-up email puts them.
 */
export const MILESTONE_STAGE_NAMES: Record<StageMilestone, readonly string[]> = {
  contacted: ["Potential New Client", "New PNC", "New Inquiry"],
  consult_scheduled: DEFAULT_STAGE_NAMES["consult-scheduled"],
  consult_held: ["Consultation Held", "Consult Held", "Consultation Completed", "Consult Completed", "Consultation Complete"],
  questionnaire_sent: DEFAULT_STAGE_NAMES["questionnaire-sent"],
  opinion_letter_sent: ["Opinion Letter Sent", "Search Opinion Sent"],
  proposal_sent: ["Proposal Sent", "Proposal Sent to Client", ...DEFAULT_STAGE_NAMES["post-consult-sent"]],
  follow_up_sent: ["Follow-Up Sent", "Follow Up Sent", "Post Consultation Follow Up"],
  loe_sent: DEFAULT_STAGE_NAMES["loe-invoice-sent"],
  declined: ["Lost", "Lost Lead"],
  nurture: ["Follow-Up", "Follow Up", "Nurture"],
};

/** The signal ids the Stage Keeper's firm-brain entries already use, read as the milestone they name. */
const SIGNAL_ALIASES: Record<string, StageMilestone> = {
  "consult-scheduled": "consult_scheduled",
  "questionnaire-sent": "questionnaire_sent",
  "loe-invoice-sent": "loe_sent",
};

export type MilestoneMapping = Partial<Record<StageMilestone, string>>;

type BrainRow = { key?: unknown; body?: unknown; data?: unknown };

/**
 * The firm brain's `stage_mapping` entries that name a milestone, by its key (`proposal_sent` or
 * `proposal-sent`) or by the Stage Keeper's signal id for the same fact. Others are ignored.
 */
export function parseMilestoneMapping(entries: readonly BrainRow[]): MilestoneMapping {
  const out: MilestoneMapping = {};
  for (const entry of entries) {
    const raw = typeof entry.key === "string" ? entry.key.trim().toLowerCase() : "";
    if (!raw) continue;
    const underscored = raw.replace(/-/g, "_");
    const milestone: StageMilestone | undefined =
      underscored in MILESTONE_STAGE_NAMES ? (underscored as StageMilestone) : SIGNAL_ALIASES[raw];
    if (!milestone) continue;
    const data = entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? (entry.data as Record<string, unknown>) : {};
    const name = (typeof data.stage === "string" ? data.stage.trim() : "") || (typeof entry.body === "string" ? entry.body.trim() : "");
    if (name) out[milestone] = name;
  }
  return out;
}

/**
 * The firm's stage a milestone names, or null. A brain entry wins, and one naming a stage the firm
 * lacks gives nothing (the firm said what it meant). Otherwise the default names, through the same
 * `resolveStage` the Lawmatics mapper uses.
 */
export function stageForMilestone(milestone: Milestone, stages: readonly StageOpt[], mapping: MilestoneMapping = {}): StageOpt | null {
  if (!(milestone in MILESTONE_STAGE_NAMES)) return null;
  const key = milestone as StageMilestone;
  const byId = new Map(stages.map((s) => [s.id, s]));
  const named = mapping[key];
  if (named !== undefined) {
    const hit = resolveStage(named, stages);
    return hit.ok ? (byId.get(hit.stage.id) ?? null) : null;
  }
  for (const candidate of MILESTONE_STAGE_NAMES[key]) {
    const hit = resolveStage(candidate, stages);
    if (hit.ok) return byId.get(hit.stage.id) ?? null;
  }
  return null;
}

/** 140 characters of a note, whitespace collapsed: all that is ever kept, and only in memory. */
export const SNIPPET_MAX = 140;
export function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
}
