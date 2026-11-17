import { ROLES, type Role } from "@/lib/auth/roles";
import type { EffectiveTemperature } from "@/lib/intake/effective-temperature";
import { REFERRAL_SOURCES } from "@/lib/intake/referral-source";
import { LANES, LANE_LABEL, type Lane } from "@/lib/leads/lane";
import { MERGE_ROLES } from "@/lib/leads/merge";
import { formatCents } from "@/lib/quotes/money";
import { leadStageChoices } from "@/lib/review/detail";
import {
  LEAD_STEP_ROW_LEGAL,
  LEAD_STEP_ROW_USPTO,
  NOT_RATED,
  RECORD_CARD_APPROVALS_FAILED,
  RECORD_CARD_MENU_MERGE,
  RECORD_CARD_MENU_MOVE,
  RECORD_CARD_MENU_NO_SHOW,
  RECORD_CARD_MENU_OPEN,
  RECORD_CARD_MENU_STEP,
  RECORD_CARD_SUGGESTED_MARK,
  recordCardNeedsAttorney,
  recordCardSuggests,
} from "@/lib/ui/words";

/**
 * Which edit controls a card draws, per role and per kind (Sprint 10). PURE: no database, no server-only import, so the
 * Part 2 client components can import it (tests/record-card/hygiene.test.ts walks the import graph).
 *
 * The rule: a control is drawn exactly when the action behind it would accept the role. A role that can't make an edit
 * sees the same card with NO control for it (not a disabled one). The role lists below are COPIES of the lists the
 * actions check, because those live beside the scoped client (server code). tests/record-card/rules.test.ts holds each
 * copy equal to its source (CAN_WRITE_LEAD, MATTER_WRITE_ROLES, CAN_MOVE_STAGE, FILE_UPLOAD_ROLES, MERGE_ROLES), so they
 * cannot drift.
 */

export type CardKind = "lead" | "matter";

/** `CAN_WRITE_LEAD` (src/lib/pipeline/leads.ts): setLane, setReferralSource, updateLead, tags, notes, the lead's owner and next-step add. */
const WRITE_LEAD: readonly Role[] = ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk"];
/** `MATTER_WRITE_ROLES` (src/lib/matters/matters.ts): every matter write, and the review's step edit / done / snooze on ANY task. */
const WRITE_MATTER: readonly Role[] = ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk"];
/** `CAN_MOVE_STAGE` (src/lib/pipeline/leads.ts): `moveLeadStage`. A paralegal can edit a lead but never move its stage. */
const MOVE_STAGE: readonly Role[] = ["owner", "admin", "senior_admin", "intake", "law_clerk", "attorney", "clerk"];
/** `FILE_UPLOAD_ROLES` (src/lib/files/roles.ts). */
const UPLOAD: readonly Role[] = WRITE_LEAD;

/** Exported only so the equality test can compare each copy with the list the action really checks. */
export const CARD_ROLE_LISTS = { writeLead: WRITE_LEAD, writeMatter: WRITE_MATTER, moveStage: MOVE_STAGE, upload: UPLOAD, merge: MERGE_ROLES } as const;

export const CARD_CONTROLS = [
  "temperature",
  "source",
  "owner",
  "stepAdd",
  "stepEdit",
  "stepDone",
  "stepSnooze",
  "stage",
  "tags",
  "rename",
  "title",
  "noShow",
  "merge",
  "upload",
  "notes",
] as const;
export type CardControl = (typeof CARD_CONTROLS)[number];
export type CardEdits = Record<CardControl, boolean>;

export type CardEditsInput = {
  /** The caller's role, re-resolved on the server. Anything that is not a known role draws nothing. */
  role: Role | string | null | undefined;
  kind: CardKind;
  /** lectual 0107's merge columns are there (`mergeAvailable`). False on any doubt. */
  mergeAvailable?: boolean;
  /** A possible duplicate of this lead is known (the Intake page's duplicate rule). */
  hasDuplicate?: boolean;
  /**
   * Whether the reads a pick needs worked. An unreadable member list shows the owner read only (the action refuses an
   * unchecked change anyway); unreadable stages show the stage read only. Default: readable.
   */
  readable?: { members?: boolean; stages?: boolean };
};

const NONE: CardEdits = Object.fromEntries(CARD_CONTROLS.map((c) => [c, false])) as CardEdits;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The controls drawn on a card for this role and kind. Each line names the action whose role check it mirrors
 * (the edit-to-action table in docs/pge/2026-11-17-agentic-ip-os/sprint-10.md).
 */
export function cardEdits(input: CardEditsInput): CardEdits {
  const { role, kind } = input;
  if (!isRole(role)) return { ...NONE };
  const members = input.readable?.members !== false;
  const stages = input.readable?.stages !== false;
  const writeLead = WRITE_LEAD.includes(role);
  const writeMatter = WRITE_MATTER.includes(role);
  if (kind === "lead") {
    return {
      temperature: writeLead, // setLaneAction -> setLane: CAN_WRITE_LEAD
      source: writeLead, // setSourceAction -> setReferralSource: CAN_WRITE_LEAD
      owner: writeLead && members, // assignRecordAction (lead): CAN_WRITE_LEAD, member check
      stepAdd: writeLead, // setNextStepAction (lead): CAN_WRITE_LEAD
      stepEdit: writeMatter, // updateNextStepAction: MATTER_WRITE_ROLES on any task
      stepDone: writeMatter, // completeNextStepAction: MATTER_WRITE_ROLES
      stepSnooze: writeMatter, // snoozeNextStepAction: MATTER_WRITE_ROLES, works on a lead's task too
      stage: MOVE_STAGE.includes(role) && writeLead && stages, // moveStageAction (lead): CAN_MOVE_STAGE and CAN_WRITE_LEAD
      tags: writeLead, // cardTagAction: CAN_WRITE_LEAD
      rename: writeLead, // renameLeadAction: CAN_WRITE_LEAD
      title: false,
      noShow: writeLead, // logConsultOutcomeAction -> logConsultOutcome: CAN_WRITE_LEAD
      merge: MERGE_ROLES.includes(role) && input.mergeAvailable === true && input.hasDuplicate === true, // the merge screen: MERGE_ROLES
      upload: UPLOAD.includes(role), // requestUploadAction / confirmUploadAction: FILE_UPLOAD_ROLES
      notes: writeLead, // addNoteAction / addVoiceNoteAction: the lead write roles
    };
  }
  return {
    temperature: false,
    source: writeMatter, // updateMatterHeaderAction (referralSource only): MATTER_WRITE_ROLES
    owner: writeMatter && members, // assignRecordAction (matter): MATTER_WRITE_ROLES, member check
    stepAdd: writeMatter,
    stepEdit: writeMatter,
    stepDone: writeMatter,
    stepSnooze: writeMatter,
    // The review's moveStageAction (kind matter -> updateMatterStage): MATTER_WRITE_ROLES. Part 2 must call THAT action,
    // which answers { saved: true }; the matter page's updateMatterStageAction answers {} and the card couldn't show "Saved".
    stage: writeMatter && stages,
    tags: false,
    rename: false,
    title: writeMatter, // updateMatterHeaderAction (title only): MATTER_WRITE_ROLES
    noShow: false,
    merge: false,
    upload: UPLOAD.includes(role),
    notes: writeMatter, // addMatterNoteAction / the matter's addVoiceNoteAction: MATTER_WRITE_ROLES
  };
}

export type StageTarget = { id: string; name: string };

/**
 * Where a card may move a record. A lead: its open and nurture stages (the review's own rule, `leadStageChoices`), and
 * its LOST stages only while the page shows the Lost set (Item L: a lost stage is a Move-to destination only there;
 * `lostShown`, default false). NEVER a `won` stage: that move runs the matter handoff, and the server refuses it again.
 * A matter: the firm's docket stages. The record's current stage is left out either way.
 */
export function moveTargets(
  stages: readonly { id: string; name?: string | null; label?: string | null; category?: string | null }[],
  kind: CardKind,
  currentId: string | null = null,
  opts: { lostShown?: boolean } = {},
): StageTarget[] {
  const lost = new Set(stages.filter((s) => s.category === "lost").map((s) => s.id));
  const list: StageTarget[] =
    kind === "lead"
      ? leadStageChoices(stages.map((s) => ({ id: s.id, name: s.name ?? null, category: s.category ?? null }))).filter((s) => opts.lostShown === true || !lost.has(s.id))
      : stages.filter((s) => !!(s.label ?? s.name)).map((s) => ({ id: s.id, name: (s.label ?? s.name) as string }));
  return list.filter((s) => s.id !== currentId);
}

/** The firm's sources, in the firm's order. A card never offers a typed new one (default 1). */
export const SOURCE_CHOICES: readonly string[] = REFERRAL_SOURCES;

export type TemperatureChoice = { kind: "accept" | "set"; value: Lane | null; label: string; current: boolean };
export type TemperatureControl = {
  pill: { value: Lane | null; label: string; style: "filled" | "outlined" | "none"; mark: string | null; title: string };
  /** Empty when the role can't set it (then the pill is plain text). */
  menu: TemperatureChoice[];
};

/**
 * The temperature pill and its menu. A PERSON's level (crm_lead.lane) is a FILLED pill; a level Lectual only suggested
 * (`effectiveTemperature`'s `source: "suggested"`) is a quiet OUTLINED pill with a small "suggested" mark, and the menu
 * starts with "Lectual suggests Warm · Accept". Accept writes the suggested level through `setLane` like any other choice.
 * With no suggestion to show (`suggestion` off or unreadable) a suggested level is not drawn at all; a person's still is.
 *
 * The suggestion is RULE-BASED (`effectiveTemperature` over the lead's activity and recorded facts), not a model call, so
 * there is no "AI off" state: `suggestion: "off"` exists only for a caller that chooses not to show one. The `reason`
 * (the pill's title) may carry the triage assistant's summary appended ("... · Triage: ..."): staff-only text.
 */
export function temperatureControl(
  temperature: Pick<EffectiveTemperature, "value" | "source" | "reason">,
  opts: { canEdit: boolean; suggestion?: "ok" | "off" | "unavailable" },
): TemperatureControl {
  const suggestionShown = (opts.suggestion ?? "ok") === "ok";
  const person = temperature.source === "person" && temperature.value !== null;
  const suggested = temperature.source === "suggested" && temperature.value !== null && suggestionShown;
  const shown: Lane | null = person || suggested ? temperature.value : null;
  const pill: TemperatureControl["pill"] = {
    value: shown,
    label: shown ? LANE_LABEL[shown] : NOT_RATED,
    style: person ? "filled" : suggested ? "outlined" : "none",
    mark: suggested ? RECORD_CARD_SUGGESTED_MARK : null,
    title: person || suggested ? temperature.reason : NOT_RATED,
  };
  if (!opts.canEdit) return { pill, menu: [] };
  const set = person ? temperature.value : null;
  const menu: TemperatureChoice[] = [];
  if (suggested && temperature.value) menu.push({ kind: "accept", value: temperature.value, label: recordCardSuggests(LANE_LABEL[temperature.value]), current: false });
  for (const lane of LANES) menu.push({ kind: "set", value: lane, label: LANE_LABEL[lane], current: set === lane });
  menu.push({ kind: "set", value: null, label: NOT_RATED, current: !person });
  return { pill, menu };
}

export type FeeLine = { label: string; value: string };

/**
 * The proposal's money, from the STORED quote, as two separate lines: the legal fee, then the USPTO fees. They are
 * never added up here (different payees, different times); tests/record-card/fees.test.ts forbids a sum.
 */
export function proposalFeeLines(quote: { legalCents: number; govCents: number }): FeeLine[] {
  return [
    { label: LEAD_STEP_ROW_LEGAL, value: formatCents(quote.legalCents) },
    { label: LEAD_STEP_ROW_USPTO, value: formatCents(quote.govCents) },
  ];
}

/** What a card shows beside a control after the action answers. Only the action's own success shape is "Saved". */
export type SavedMark = { saved: true; error: null } | { saved: false; error: string | null };

/**
 * Reads the result of any action a card calls. The review's actions and the two new card actions answer
 * `{ saved: true }`; the Intake list's `setLaneAction` / `setSourceAction` answer `{ ok: true }`. A refusal carries the
 * action's own fixed sentence. Anything else (no result, an unknown shape) is not "Saved".
 */
export function savedMark(result: unknown): SavedMark {
  if (!result || typeof result !== "object") return { saved: false, error: null };
  const r = result as { saved?: unknown; ok?: unknown; error?: unknown };
  const error = typeof r.error === "string" && r.error.trim() ? r.error : null;
  if (error) return { saved: false, error };
  if (r.saved === true || r.ok === true) return { saved: true, error: null };
  return { saved: false, error: null };
}

/** The pending approvals named on one lead, as the Intake page already reads them (`LeadPendingApprovals`). */
export type CardApprovals = { status: "ok"; queueIds: readonly string[] } | { status: "unconfigured" } | { status: "unavailable" };
export type ApprovalsChip = { text: string; href: string | null; tone: "warn" | "muted" } | null;

/**
 * "Needs attorney · N". One waiting approval links straight to it; more open the card, whose top card lists them. An
 * unconfigured queue draws no chip; a failed read says so and is never 0.
 */
export function approvalsChip(read: CardApprovals, openCardHref: string): ApprovalsChip {
  if (read.status === "unconfigured") return null;
  if (read.status === "unavailable") return { text: RECORD_CARD_APPROVALS_FAILED, href: null, tone: "muted" };
  const n = read.queueIds.length;
  if (n === 0) return null;
  return { text: recordCardNeedsAttorney(n), href: n === 1 ? `/dashboard/queue/${encodeURIComponent(read.queueIds[0])}/` : openCardHref, tone: "warn" };
}

export type MenuItem = { id: "move" | "step" | "noShow" | "merge" | "open"; label: string; href: string | null };

/**
 * The card's "⋯" menu: Move to stage… (only with somewhere to go), Set next step, Mark no-show (leads), Merge duplicates
 * (admin tier, 0107 there and a duplicate known: a link to the existing merge screen, which re-gates), Open full page.
 */
export function cardMenu(input: { kind: CardKind; id: string; edits: CardEdits; targets: readonly StageTarget[]; duplicateOf?: string | null }): MenuItem[] {
  const { kind, id, edits } = input;
  const items: MenuItem[] = [];
  if (edits.stage && input.targets.length > 0) items.push({ id: "move", label: RECORD_CARD_MENU_MOVE, href: null });
  if (edits.stepAdd) items.push({ id: "step", label: RECORD_CARD_MENU_STEP, href: null });
  if (kind === "lead" && edits.noShow) items.push({ id: "noShow", label: RECORD_CARD_MENU_NO_SHOW, href: null });
  if (kind === "lead" && edits.merge && input.duplicateOf) {
    items.push({ id: "merge", label: RECORD_CARD_MENU_MERGE, href: `/dashboard/intake/merge/?a=${encodeURIComponent(id)}&b=${encodeURIComponent(input.duplicateOf)}` });
  }
  items.push({ id: "open", label: RECORD_CARD_MENU_OPEN, href: fullPageHref(kind, id) });
  return items;
}

/** The record's own page. */
export function fullPageHref(kind: CardKind, id: string): string {
  return kind === "lead" ? `/dashboard/leads/${encodeURIComponent(id)}/` : `/dashboard/matters/${encodeURIComponent(id)}/`;
}

/** Mark no-show's Undo window: nothing is posted until it ends (the approval deck's rule); after it there is no undo. */
export const NO_SHOW_HOLD_MS = 5_000;
