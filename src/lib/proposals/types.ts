/**
 * Client trademark proposals — row shapes, the content document, vocabularies.
 *
 * Pure module: no database, no `server-only`, no Node-only import. Safe to
 * import from a `"use client"` component (the editor preview and the public
 * page render from these types) and from a plain vitest run.
 *
 * ── WHY THIS IS NOT THE QUOTE ENGINE ────────────────────────────────────────
 * `src/lib/quotes` models one package plus add-ons plus a typed signature. RPB
 * sells brand names x marks x classes, with a second-mark discount, "accept"
 * (not "sign") followed by a payment form, and the engagement letter only after
 * payment. The table is lectual's 0089 `client_proposal`; this file mirrors its
 * columns by hand (the generated `Database` type has no such table until the
 * migration is applied somewhere types can be regenerated from).
 *
 * ── MONEY ───────────────────────────────────────────────────────────────────
 * Integer cents as plain `number`. Never a float, never dollars, and never a
 * typed total: totals are always COMPUTED (`pricing.ts#quoteProposal`).
 *
 * ── FIRM RULES THAT SHAPE THESE TYPES (spec "Firm rules") ───────────────────
 *  - No International Class number is ever client-facing; "Class 1/2/3" are
 *    counting labels and are allowed (Rebecca, 2026-10-16). `validate.ts`.
 *  - The SUBSTANTIVE office action response is never in a package. `validate.ts`.
 *  - USPTO fees are due at filing, never with the legal fee, so the quote has
 *    two totals and no bare `total`.
 *  - Only the firm's named approvers approve. Enforced by the database trigger;
 *    `PROPOSAL_STAFF_WRITE_ROLES` below is only the friendly refusal.
 */

import type { Role } from "@/lib/auth/roles";
import { normalisePackages } from "./package-list";

/* ─────────────────────────── role gates ──────────────────────────────────
 * Mirror the RLS policy role lists in 0089, verbatim. RLS is the real
 * boundary; these are the friendly app-layer refusal.
 */

/** client_proposal / client_proposal_event insert + update policies. */
export const PROPOSAL_STAFF_WRITE_ROLES: Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "intake",
  "paralegal",
  "law_clerk",
  "attorney",
  "clerk",
];

/** client_proposal_setting insert/update, and client_proposal delete (drafts). */
export const PROPOSAL_ADMIN_ROLES: Role[] = ["owner", "admin", "senior_admin"];

/* ─────────────────────────── vocabularies ────────────────────────────────── */

/** client_proposal.status check constraint. */
export const PROPOSAL_STATUSES = [
  "draft",
  "approved",
  "sent",
  "superseded",
  "accepted",
  "withdrawn",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** client_proposal.source check constraint. */
export const PROPOSAL_SOURCES = ["manual", "agent", "revision"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

/** client_proposal_event.type check constraint. */
export const PROPOSAL_EVENT_TYPES = [
  "created",
  "edited",
  "approved",
  "unapproved",
  "sent",
  "viewed",
  "accepted",
  "withdrawn",
  "superseded",
  "revised",
  /** lectual 0101: staff moved an accepted version back to "Link live". Written by the trigger only. */
  "reset",
] as const;
export type ProposalEventType = (typeof PROPOSAL_EVENT_TYPES)[number];

/** client_proposal_event.actor check constraint. */
export const PROPOSAL_EVENT_ACTORS = ["staff", "agent", "client", "system"] as const;
export type ProposalEventActor = (typeof PROPOSAL_EVENT_ACTORS)[number];

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === "string" && (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

/** Statuses whose editable fields can still change (the trigger freezes the rest). */
export const PROPOSAL_EDITABLE_STATUSES: readonly ProposalStatus[] = ["draft", "approved"];

export function isProposalEditable(status: string): boolean {
  return (PROPOSAL_EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The status moves the 0089 trigger allows. accepted / superseded / withdrawn
 * are terminal. `approved` is reachable only by a named approver and `accepted`
 * only by the service role; this table says what is possible, not who may.
 */
export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ["approved", "withdrawn"],
  approved: ["draft", "sent", "withdrawn"],
  sent: ["superseded", "accepted", "withdrawn"],
  superseded: [],
  accepted: [],
  withdrawn: [],
};

export function canTransitionProposal(from: string, to: string): boolean {
  if (!isProposalStatus(from)) return false;
  return (PROPOSAL_TRANSITIONS[from] as readonly string[]).includes(to);
}

/* ─────────────────────────── the content document ────────────────────────── */

export const MARK_KINDS = ["word", "logo"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export function isMarkKind(value: unknown): value is MarkKind {
  return value === "word" || value === "logo";
}

/** Client-facing label for a mark kind (Rebecca's vocabulary). */
export const MARK_KIND_LABEL: Record<MarkKind, string> = {
  word: "Word mark",
  logo: "Logo mark",
};

/** The firm's default `desc` for a mark kind. */
export const MARK_KIND_DEFAULT_DESC: Record<MarkKind, string> = {
  word: "Protects the words only. It does not protect the font or style.",
  logo: "Protects the design, including its fonts, styles and colors.",
};

export type ProposalPricing = {
  /** e.g. "Concierge". */
  package: string;
  /** Price with `included_classes` classes. */
  base_cents: number;
  included_classes: number;
  /** Added per class over `included_classes`. A package is flat up to `included_classes`: fewer classes never lower the price. */
  per_class_cents: number;
  /** 0..100. Second mark of the SAME brand name. */
  second_mark_discount_pct: number;
  /** USPTO fee per class per mark, due at filing. Always charged for every class, never waived. */
  gov_per_class_cents: number;
  /**
   * Custom package only: take `per_class_cents` off for each class UNDER `included_classes`
   * (the pre-Sprint-28 rule). Absent or false = the package is flat. Set by staff, or by the
   * consult drafter on quoted evidence; never read from the browser.
   */
  reduce_under_included?: boolean;
};

export type ProposalMark = {
  id: string;
  kind: MarkKind;
  desc: string;
  preselected: boolean;
};

export type ProposalClass = {
  id: string;
  /** Plain business language. Never an International Class number. */
  label: string;
  preselected: boolean;
  /** True for a class the client added on /p/<token> (Sprint 28 / Spec 3); its label is their plain-text description. */
  client_added?: boolean;
  /**
   * An OPEN class (Spec 3): the client types the goods or services. In the stored offer `label` is the PROMPT the
   * client reads; in an accepted snapshot `label` is what the client typed and `prompt` keeps the firm's question.
   * Priced exactly like any other class. See `client-classes.ts`.
   */
  client_entry?: true;
  /** Accepted snapshot only: the firm's prompt of an open class (its `label` there is the client's text). */
  prompt?: string;
};

export type ProposalName = {
  id: string;
  name: string;
  what?: string;
  /** "A note from Rebecca" — `**bold**` is the only markup. */
  note?: string;
  /** A different amount for this brand. */
  price_override?: { base_cents?: number; per_class_cents?: number };
  marks: ProposalMark[];
  classes: ProposalClass[];
  /** The client may add up to `max` (0..10) more open classes to this brand name on /p/<token> (Spec 3). */
  client_add?: { max: number };
  /**
   * Spec 6: the client picks this brand name's package on /p/<token>. `options` are 1 to 3 names from
   * `content.packages`, in the order shown; `default` is one of them and is what a missing or unknown pick means.
   * Never together with `price_override`.
   */
  package_choice?: { options: string[]; default: string };
  /** Spec 6: a whole percent (0..50) off THIS brand name's legal fee, after its package price. Never the USPTO fee. */
  discount_pct?: number;
};

/**
 * Spec 6: one firm package as it stood when the proposal was built (a snapshot, so a later change to the firm's
 * list never re-prices a proposal). The same numbers as `ProposalPricing`, plus that package's own includes rows.
 */
export type PackageOffer = {
  package: string;
  base_cents: number;
  per_class_cents: number;
  included_classes: number;
  gov_per_class_cents: number;
  second_mark_discount_pct: number;
  includes?: ProposalInclude[];
};

export type ProposalAdjustment = {
  id: string;
  label: string;
  kind: "amount" | "percent";
  /** amount: cents (positive = discount). percent: 0..100. */
  value: number;
};

export type ProposalInclude = {
  label: string;
  value?: string;
  included: string;
  note?: string;
  highlight?: boolean;
};

/**
 * Staff-only note of which firm package a proposal started from and which of its
 * numbers were then changed for this proposal ("Edited from Concierge"). It lives
 * in the content jsonb because that is the one column that travels with the
 * proposal, and it is NOT in `publicContent`'s allowlist, so it is never published.
 */
export type ProposalPackageBasis = {
  name: string;
  /** Plain labels of the fields changed from the package, e.g. "price", "classes included". */
  edited: string[];
};

export type ProposalContent = {
  client: { first_name: string; full_name: string; company?: string };
  greeting: string;
  recommendation?: string;
  pricing: ProposalPricing;
  names: ProposalName[];
  adjustments: ProposalAdjustment[];
  includes: ProposalInclude[];
  office_action_note?: string;
  package_basis?: ProposalPackageBasis;
  /** Spec 6: the packages a brand name's `package_choice` may offer, snapshotted from the firm's list. */
  packages?: PackageOffer[];
};

/** Spec 6: brand name id -> the package NAME the client chose. Never a price. */
export type PackagePicks = Record<string, string>;

/**
 * Mark or class id -> ticked, plus (Spec 6) `packages`: the package name chosen per brand name. The key
 * "packages" is reserved (`validateContent` refuses it as a mark or class id).
 */
export type Selection = { [id: string]: boolean | PackagePicks | undefined; packages?: PackagePicks };

/* ─────────────────────────── rows ────────────────────────────────────────── */

/** client_proposal_setting (one row per firm). */
export type ProposalSettingRow = {
  org_id: string;
  approver_user_ids: string[];
  default_pay_url: string | null;
  notify_email: string | null;
  /** The firm's standard prices + includes; see `ProposalSettingPricing`. */
  pricing: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** client_proposal (one row per VERSION). */
export type ProposalRow = {
  id: string;
  org_id: string;
  family_id: string;
  version: number;
  public_token: string;
  lead_id: string | null;
  matter_id: string | null;
  client_name: string;
  client_email: string | null;
  title: string;
  status: ProposalStatus;
  content: ProposalContent;
  expires_on: string | null;
  pay_url: string | null;
  source: ProposalSource;
  created_by: string | null;
  updated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  superseded_at: string | null;
  withdrawn_at: string | null;
  accepted_selection: Selection | null;
  accepted_snapshot: AcceptedSnapshot | null;
  created_at: string;
  updated_at: string;
};

/** client_proposal_event (append-only audit). */
export type ProposalEventRow = {
  id: string;
  org_id: string;
  proposal_id: string;
  family_id: string;
  type: ProposalEventType;
  actor: ProposalEventActor;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

/** What `edited` events carry in `payload` (written by store.ts#updateProposal). */
export type ProposalEditedPayload = {
  /** Row fields touched: "content", "client_name", "expires_on", ... */
  fields: string[];
  legal_total_before: number;
  legal_total_after: number;
  /** True when the edit sent an approved row back to draft. */
  reset_to_draft: boolean;
  /** Field-level changes inside `content` (and the plain columns), capped. */
  changes: ProposalChange[];
};

/** One field-level change, for the version history ("changed Concierge price from ... to ..."). */
export type ProposalChange = {
  /** Stable path, e.g. "pricing.base_cents" or "names[p].marks[p-word].desc". */
  path: string;
  /** Readable label, e.g. "Concierge base price" or "Prosperall: Word mark description". */
  label: string;
  /** How the renderer should format before/after. */
  format: "cents" | "pct" | "text" | "bool" | "count";
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

/**
 * `client_proposal.accepted_snapshot` — frozen at acceptance, written only by
 * the service role. The quote inside is what the client was SHOWN and agreed
 * to, recomputed server-side from `content` + `selection`, never from the
 * browser.
 */
export type AcceptedSnapshot = {
  /** Bump when this shape changes. */
  schema: 1;
  version: number;
  content: ProposalContent;
  selection: Selection;
  quote: ProposalQuote;
  accepted_at: string;
};

/* ─────────────────────────── the quote (pricing.ts output) ───────────────── */

export type QuotedMark = {
  id: string;
  kind: MarkKind;
  desc: string;
  /** True for every picked mark after the first within the same brand name. */
  second: boolean;
  /** Legal fee for this mark, cents, after any second-mark discount. */
  price_cents: number;
};

export type QuotedName = {
  id: string;
  name: string;
  /** False when no class or no mark is picked: everything below is empty/0. */
  included: boolean;
  /** Picked classes (empty unless included). */
  classes: Array<{ id: string; label: string }>;
  /** Picked marks in content order (empty unless included). */
  marks: QuotedMark[];
  /** First-mark price for this brand at its picked class count. */
  base_cents: number;
  /** Legal fee for this brand. */
  legal_cents: number;
  /** USPTO fee for this brand: classes x marks x per-class fee. Due at filing. */
  gov_cents: number;
  /** Filing-class count for the fee: classes x marks. */
  class_count: number;
  /** Spec 6: the package this brand name was priced under (only for a name with `package_choice`). */
  package?: string;
  /** Spec 6: what `discount_pct` took off this brand name's legal fee (only when the name has one). */
  discount_cents?: number;
};

export type QuotedAdjustment = {
  id: string;
  label: string;
  kind: "amount" | "percent";
  value: number;
  /** Cents actually taken off the legal fee by this adjustment (never more than what was left). */
  discount_cents: number;
};

export type ProposalQuote = {
  names: QuotedName[];
  /** Legal fee before adjustments. */
  legal_subtotal_cents: number;
  adjustments: QuotedAdjustment[];
  /** Sum of `adjustments[].discount_cents`; legal_subtotal - this = legal_total. */
  discount_cents: number;
  /** What the client pays NOW (the legal fee). Never negative. */
  legal_total_cents: number;
  /** USPTO fees, due at filing, shown separately. */
  gov_total_cents: number;
  /** Total filing classes (classes x marks) the USPTO fee is charged on. */
  gov_class_count: number;
};

/* ─────────────────────────── the firm's standard pricing ─────────────────── */

/**
 * `client_proposal_setting.pricing`: any subset of `ProposalPricing` plus the
 * firm's default includes table and office-action note. Missing keys fall back
 * to `DEFAULT_PROPOSAL_PRICING` / `DEFAULT_PROPOSAL_INCLUDES`.
 */
export type ProposalSettingPricing = Partial<ProposalPricing> & {
  /** The firm's named packages, first one the default. The flat fields above mirror it. */
  packages?: ProposalPricing[];
  includes?: ProposalInclude[];
  office_action_note?: string;
};

// Defined with the package list (pure, client-safe); re-exported so every existing import keeps working.
export { DEFAULT_PROPOSAL_PRICING } from "./package-list";

export const DEFAULT_OFFICE_ACTION_NOTE =
  "If a substantive office action is issued, your package includes Rebecca's strategy review. The response itself is quoted separately, and we will get your approval before any work begins.";

/** RPB's "What your package includes" table (from the Sevetri example). */
export const DEFAULT_PROPOSAL_INCLUDES: ProposalInclude[] = [
  { label: "Classes included", included: "Your choice (up to 3)", highlight: true },
  { label: "Preliminary Consultation Strategy Call", value: "$450", included: "✓" },
  { label: "USPTO Knockout Searches", value: "$900", included: "Unlimited" },
  { label: "Comprehensive Trademark Search Report", value: "$675 each", included: "2 included" },
  { label: "Trademark Opinion Letter", value: "$900 each", included: "2 if high risk" },
  { label: "Post Search Strategy Call", value: "$450 each", included: "2 included" },
  { label: "Trademark Application Preparation and Filing", value: "$900", included: "✓" },
  { label: "Dedicated Attorney Support (8 to 18 months)", value: "$2,250", included: "✓" },
  { label: "Monthly Monitoring of Application and Email Updates", value: "$350", included: "✓" },
  { label: "Non-Substantive Office Action Response", value: "$450 each", included: "Unlimited" },
  { label: "Statement of Use Legal Fee", value: "$500", included: "✓" },
  { label: "Extension Legal Fees", value: "$225 each", included: "Unlimited" },
  { label: "Comprehensive IP Audit (Trademarks + Copyright)", value: "$1,500", included: "✓" },
  {
    label: "Substantive Office Action Legal Strategy Review",
    value: "$675",
    note: "Does not include the response itself",
    included: "✓",
  },
  { label: "Post Registration Monitoring (12 months)", value: "$1,800", included: "✓" },
  { label: "Cease and Desist Letter Template", value: "$750", included: "✓" },
  { label: "Trademark Assignment Agreement", value: "$1,500", included: "✓" },
];

/**
 * The pricing a NEW proposal starts from: the firm's DEFAULT (first) package from
 * `client_proposal_setting` where it is well-formed, the RPB defaults for anything
 * missing or unreadable. Total — a malformed jsonb never throws, it just falls back.
 */
export function standardProposalPricing(setting: unknown): {
  pricing: ProposalPricing;
  includes: ProposalInclude[];
  office_action_note: string;
} {
  const raw = (setting && typeof setting === "object" && !Array.isArray(setting)
    ? setting
    : {}) as Record<string, unknown>;
  // The default package is the first of the firm's list (the flat fields when there is no list).
  const pricing: ProposalPricing = normalisePackages(raw)[0];
  const includes = Array.isArray(raw.includes)
    ? (raw.includes as unknown[]).filter(
        (r): r is ProposalInclude =>
          !!r &&
          typeof r === "object" &&
          typeof (r as ProposalInclude).label === "string" &&
          typeof (r as ProposalInclude).included === "string",
      )
    : [];
  return {
    pricing,
    includes: includes.length > 0 ? includes : DEFAULT_PROPOSAL_INCLUDES.map((r) => ({ ...r })),
    office_action_note:
      typeof raw.office_action_note === "string" && raw.office_action_note.trim()
        ? raw.office_action_note
        : DEFAULT_OFFICE_ACTION_NOTE,
  };
}

/* ─────────────────────────── the public token ────────────────────────────── */

/**
 * The shape a real `client_proposal.public_token` has: unpadded base64url,
 * 32..64 characters (0089's check; 32 random bytes is 43). Checked before any
 * query so token-guessing traffic is free to refuse and only `[A-Za-z0-9_-]`
 * ever reaches PostgREST's filter parser.
 */
const PROPOSAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export function isWellFormedProposalToken(token: unknown): token is string {
  return typeof token === "string" && PROPOSAL_TOKEN_PATTERN.test(token);
}
