import type { Role } from "@/lib/auth/roles";
import type { EffectiveTemperature } from "@/lib/intake/effective-temperature";
import { buildLeadStepView, type LeadStepView, type TopCardView } from "@/lib/lead-step/view-model";
import type { LeadStepFacts } from "@/lib/lead-step/facts";
import { firmDate, shortDay } from "@/lib/lead-step/schedule";
import { matterDisplayTitle } from "@/lib/matters/display-title";
import type { RecordDocuments } from "@/lib/review/documents";
import type { ActivityRow } from "@/lib/stage-keeper/moves";
import {
  LEAD_STEP_CANT_SHOW_NEEDS,
  LEAD_STEP_COULDNT_LOAD,
  LEAD_STEP_DID_UNAVAILABLE,
  RECORD_CARD_A_TEAMMATE,
  RECORD_CARD_ACTIVITY_FAILED,
  RECORD_CARD_ADD_STEP,
  RECORD_CARD_DEADLINE_CONFIRMED,
  RECORD_CARD_DEADLINE_UNCONFIRMED,
  RECORD_CARD_NO_ACTIVITY,
  RECORD_CARD_NO_DATE,
  RECORD_CARD_NO_DEADLINE,
  RECORD_CARD_NO_STEP,
  RECORD_CARD_NOT_FOUND,
  RECORD_CARD_STEPS_FAILED,
  RECORD_CARD_UNASSIGNED,
  RECORD_CARD_UNAVAILABLE,
  recordCardDeadline,
  recordCardDue,
  recordCardLastActivity,
} from "@/lib/ui/words";
import { leadLabel } from "./lead-label";
import { closeHref, openHref, type CurrentParams } from "./open";
import {
  SOURCE_CHOICES,
  approvalsChip,
  cardEdits,
  cardMenu,
  fullPageHref,
  moveTargets,
  proposalFeeLines,
  temperatureControl,
  type ApprovalsChip,
  type CardApprovals,
  type CardEdits,
  type CardKind,
  type FeeLine,
  type MenuItem,
  type StageTarget,
  type TemperatureControl,
} from "./rules";

/**
 * The card view-model (Sprint 10): the board card, the list row and the opened card, for a lead or a matter, built
 * from rows the pages already read (or, for the opened card, from `loadRecordCard`). PURE: no database, no React, no
 * server-only import. It decides what is drawn; Part 2's components only draw it. Every word comes from words.ts.
 *
 * Reads are three-state everywhere: a failed read says so and is never "none", "No next step" or 0.
 */

export type CardRead<T> = { status: "ok"; value: T } | { status: "not-set-up" } | { status: "unavailable" };

export type CardMember = { userId: string; name: string };
export type CardTask = { id: string; title: string; dueAt: string | null; assigneeId: string | null };
export type CardDeadline = { id: string; dueDate: string; title: string | null; confirmed: boolean };
export type CardProposal = { id: string; version: number; status: string; legalCents: number; govCents: number };
export type CardTag = { id: string; label: string; color: string | null };
export type CardStage = { id: string; name?: string | null; label?: string | null; category?: string | null };

/** The lead columns a card reads. A subset of crm_lead, so the Intake page's rows fit as they are. */
export type CardLeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  /** The mark, when the page has it: shown beside the business (Taylor, Nov 17 call). */
  mark_text?: string | null;
  email: string | null;
  phone: string | null;
  current_stage_id: string | null;
  assigned_to: string | null;
  referral_source: string | null;
  last_activity_at: string | null;
};

/** The matter columns a card reads. */
export type CardMatterRow = {
  id: string;
  title: string | null;
  mark_text: string | null;
  owner_name: string | null;
  matter_number: string;
  stage_id: string | null;
  assigned_to: string | null;
  referral_source: string | null;
};

/** What every card on one page shares: who is looking, the firm's lists and where the page is. */
export type CardContext = {
  role: Role | string | null;
  members: CardRead<CardMember[]>;
  stages: CardRead<CardStage[]>;
  mergeAvailable: boolean;
  /** The page's path and its current query, so opening a card keeps the view. */
  path: string;
  params: CurrentParams;
  now: Date;
  timeZone: string;
  /** The Intake page is showing its Lost set: only then are Lost stages a Move-to destination (Item L). */
  lostShown?: boolean;
};

export type BoardLeadInput = {
  kind: "lead";
  lead: CardLeadRow;
  stageName?: string | null;
  temperature: Pick<EffectiveTemperature, "value" | "source" | "reason">;
  suggestion?: "ok" | "off" | "unavailable";
  nextStep: CardRead<CardTask | null>;
  approvals: CardApprovals;
  duplicateOf?: string | null;
};

export type BoardMatterInput = {
  kind: "matter";
  matter: CardMatterRow;
  stageName?: string | null;
  nextStep: CardRead<CardTask | null>;
  /** The next open USPTO deadline, READ ONLY. Omitted where the page doesn't read it. */
  deadline?: CardRead<CardDeadline | null>;
  lastActivityAt: string | null;
  /** The read behind `lastActivityAt` failed: the bottom line says so, never "No activity yet". Default false. */
  lastActivityUnavailable?: boolean;
};

export type StepLine =
  | {
      status: "ok";
      step: { id: string; title: string; due: string; overdue: boolean } | null;
      /** "Add a next step" when there is none and the role may add one. */
      add: string | null;
      edit: boolean;
      done: boolean;
      snooze: boolean;
    }
  | { status: "unavailable"; text: string };

/** The deadline line, read only on every card for every role: no confirm, edit or close control exists here. */
export type DeadlineLine = { status: "ok"; text: string; marker: string; confirmed: boolean } | { status: "none"; text: string } | { status: "unavailable"; text: string };

export type CardView = {
  kind: CardKind;
  id: string;
  name: string;
  /**
   * Display only: the business, or a matter's client, and null when it equals the name. Part 2's rename form must
   * prefill the business from the LEAD ROW's `business_name`, never from `sub` (a blank `sub` would post a blank
   * business and clear it).
   */
  sub: string | null;
  openHref: string;
  fullHref: string;
  edits: CardEdits;
  stage: { id: string | null; name: string | null; targets: StageTarget[] };
  temperature: TemperatureControl | null;
  source: { value: string | null; choices: readonly string[] | null };
  owner: { id: string | null; name: string; choices: CardMember[] | null };
  nextStep: StepLine;
  /** The board card's bottom line (default 4): owner, next step, last activity. */
  bottom: { owner: string; nextStep: string; lastActivity: string };
  approvals: ApprovalsChip;
  deadline: DeadlineLine | null;
  menu: MenuItem[];
};

function leadName(lead: Pick<CardLeadRow, "first_name" | "last_name" | "business_name" | "email">): string {
  return leadLabel(lead, RECORD_CARD_A_TEAMMATE).name;
}

function ownerName(id: string | null, members: CardRead<CardMember[]>): string {
  if (!id) return RECORD_CARD_UNASSIGNED;
  if (members.status !== "ok") return RECORD_CARD_A_TEAMMATE;
  return members.value.find((m) => m.userId === id)?.name || RECORD_CARD_A_TEAMMATE;
}

function stageNameOf(id: string | null, given: string | null | undefined, stages: CardRead<CardStage[]>): string | null {
  if (given) return given;
  if (!id || stages.status !== "ok") return null;
  const s = stages.value.find((x) => x.id === id);
  return (s?.name ?? s?.label ?? null) || null;
}

/** A task's due date is its UTC day (the review's rule); overdue is judged against the firm's calendar day. */
function dueOf(dueAt: string | null, now: Date, timeZone: string): { due: string; overdue: boolean } {
  if (!dueAt) return { due: RECORD_CARD_NO_DATE, overdue: false };
  const day = dueAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { due: RECORD_CARD_NO_DATE, overdue: false };
  return { due: shortDay(`${day}T12:00:00Z`, "UTC"), overdue: day < firmDate(now.getTime(), timeZone) };
}

function stepLine(read: CardRead<CardTask | null>, edits: CardEdits, now: Date, timeZone: string): StepLine {
  if (read.status !== "ok") return { status: "unavailable", text: RECORD_CARD_STEPS_FAILED };
  const t = read.value;
  if (!t) return { status: "ok", step: null, add: edits.stepAdd ? RECORD_CARD_ADD_STEP : null, edit: false, done: false, snooze: false };
  return { status: "ok", step: { id: t.id, title: t.title, ...dueOf(t.dueAt, now, timeZone) }, add: null, edit: edits.stepEdit, done: edits.stepDone, snooze: edits.stepSnooze };
}

function stepText(line: StepLine): string {
  if (line.status !== "ok") return line.text;
  if (!line.step) return RECORD_CARD_NO_STEP;
  return line.step.due === RECORD_CARD_NO_DATE ? `${line.step.title} · ${RECORD_CARD_NO_DATE}` : `${line.step.title} · ${recordCardDue(line.step.due)}`;
}

function lastActivityText(iso: string | null, timeZone: string, unavailable = false): string {
  if (unavailable) return RECORD_CARD_ACTIVITY_FAILED;
  if (!iso || Number.isNaN(new Date(iso).getTime())) return RECORD_CARD_NO_ACTIVITY;
  return recordCardLastActivity(shortDay(iso, timeZone));
}

/** The next USPTO deadline as a read-only line. */
export function deadlineLine(read: CardRead<CardDeadline | null>): DeadlineLine | null {
  if (read.status === "not-set-up") return null;
  if (read.status === "unavailable") return { status: "unavailable", text: LEAD_STEP_COULDNT_LOAD };
  const d = read.value;
  if (!d) return { status: "none", text: RECORD_CARD_NO_DEADLINE };
  return {
    status: "ok",
    text: recordCardDeadline(shortDay(`${d.dueDate}T12:00:00Z`, "UTC")),
    marker: d.confirmed ? RECORD_CARD_DEADLINE_CONFIRMED : RECORD_CARD_DEADLINE_UNCONFIRMED,
    confirmed: d.confirmed,
  };
}

/** The soonest OPEN deadline from a matter's docket rows (as `listMatterDeadlines` returns them). */
export function nextOpenDeadline(rows: readonly { id: string; status: string; due_date: string; title: string | null; attorney_confirmed: boolean | null }[]): CardDeadline | null {
  const open = rows.filter((r) => r.status === "open" && /^\d{4}-\d{2}-\d{2}/.test(r.due_date)).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  const r = open[0];
  return r ? { id: r.id, dueDate: r.due_date.slice(0, 10), title: r.title, confirmed: r.attorney_confirmed === true } : null;
}

/** One board card or list row. */
export function buildBoardCard(input: BoardLeadInput | BoardMatterInput, ctx: CardContext): CardView {
  const kind = input.kind;
  const row = input.kind === "lead" ? input.lead : input.matter;
  const id = row.id;
  const edits = cardEdits({
    role: ctx.role,
    kind,
    mergeAvailable: ctx.mergeAvailable,
    hasDuplicate: input.kind === "lead" && !!input.duplicateOf,
    readable: { members: ctx.members.status === "ok", stages: ctx.stages.status === "ok" },
  });
  const stageId = input.kind === "lead" ? input.lead.current_stage_id : input.matter.stage_id;
  const targets = edits.stage && ctx.stages.status === "ok" ? moveTargets(ctx.stages.value, kind, stageId, { lostShown: ctx.lostShown === true }) : [];
  const nextStep = stepLine(input.nextStep, edits, ctx.now, ctx.timeZone);
  const owner = ownerName(row.assigned_to, ctx.members);
  const open = openHref(ctx.path, ctx.params, { kind, id });
  const name = input.kind === "lead" ? leadName(input.lead) : matterDisplayTitle(input.matter).title;
  const sub = input.kind === "lead" ? leadLabel(input.lead).sub : (input.matter.owner_name ?? "").trim() || null;
  const lastActivityAt = input.kind === "lead" ? input.lead.last_activity_at : input.lastActivityAt;
  return {
    kind,
    id,
    name,
    sub: sub && sub !== name ? sub : null,
    openHref: open,
    fullHref: fullPageHref(kind, id),
    edits,
    stage: { id: stageId, name: stageNameOf(stageId, input.stageName, ctx.stages), targets },
    temperature: input.kind === "lead" ? temperatureControl(input.temperature, { canEdit: edits.temperature, suggestion: input.suggestion }) : null,
    source: { value: (row.referral_source ?? "").trim() || null, choices: edits.source ? SOURCE_CHOICES : null },
    owner: { id: row.assigned_to, name: owner, choices: edits.owner && ctx.members.status === "ok" ? ctx.members.value : null },
    nextStep,
    bottom: { owner, nextStep: stepText(nextStep), lastActivity: lastActivityText(lastActivityAt, ctx.timeZone, input.kind === "matter" && input.lastActivityUnavailable === true) },
    approvals: input.kind === "lead" ? approvalsChip(input.approvals, open) : null,
    deadline: input.kind === "matter" && input.deadline ? deadlineLine(input.deadline) : null,
    menu: cardMenu({ kind, id, edits, targets, duplicateOf: input.kind === "lead" ? input.duplicateOf : null }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The opened card.

/** The full lead row the opened card reads (temperature inputs included). */
export type OpenedLeadRow = CardLeadRow & {
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  lane: string | null;
  lane_set_at: string | null;
  ai_summary: string | null;
};

/** What `loadRecordCard` returns. Each source is its own three-state read; a record that isn't visible is nothing. */
export type RecordCardLoad =
  | { status: "not-found" }
  | { status: "unavailable" }
  | {
      status: "ok";
      kind: "lead";
      role: Role;
      now: string;
      timeZone: string;
      /** The lead shown: a merged lead opened by id is followed to its keeper. */
      lead: OpenedLeadRow;
      stages: CardRead<CardStage[]>;
      members: CardRead<CardMember[]>;
      tags: CardRead<{ on: CardTag[]; catalog: CardTag[] }>;
      /** Sprint 9's engine, as loaded by `loadLeadStepFacts` (top card, steps, timeline, what Lectual did). */
      leadStep: { status: "ok"; facts: LeadStepFacts } | { status: "not-found" } | { status: "unavailable" };
      approvals: CardApprovals;
      proposal: CardRead<CardProposal | null>;
      documents: CardRead<RecordDocuments>;
      /**
       * `effectiveTemperature` for this lead, worked out by the loader with the same facts the Intake page reads, so the
       * card and the board agree. Null when the stages (its input) couldn't be read: then only a person's level shows.
       */
      temperature: Pick<EffectiveTemperature, "value" | "source" | "reason"> | null;
      mergeAvailable: boolean;
      duplicateOf: string | null;
    }
  | {
      status: "ok";
      kind: "matter";
      role: Role;
      now: string;
      timeZone: string;
      matter: CardMatterRow;
      stages: CardRead<CardStage[]>;
      members: CardRead<CardMember[]>;
      tasks: CardRead<CardTask[]>;
      activity: CardRead<{ rows: ActivityRow[]; truncated: boolean }>;
      deadline: CardRead<CardDeadline | null>;
      documents: CardRead<RecordDocuments>;
    };

export type ChecklistView =
  | {
      status: "ok";
      items: { id: string; title: string; due: string; dueIso: string | null; overdue: boolean }[];
      add: boolean;
      done: boolean;
      snooze: boolean;
      edit: boolean;
    }
  | { status: "unavailable"; text: string };

export type ProposalView = { status: "ok"; lines: FeeLine[]; href: string } | { status: "none" } | { status: "unavailable"; text: string } | null;

export type OpenedCommon = {
  card: CardView;
  titleId: string;
  closeHref: string;
  steps: ChecklistView;
  timeline: CardRead<{ rows: ActivityRow[]; truncated: boolean }>;
  documents: CardRead<RecordDocuments>;
};

export type OpenedCardView =
  | { status: "not-found"; text: string; closeHref: string }
  | { status: "unavailable"; text: string; closeHref: string }
  | (OpenedCommon & {
      status: "ok";
      kind: "lead";
      /** The name fields the rename form prefills from: the LEAD ROW's own values (never `card.sub`, which is display only). */
      names: { first: string; last: string; business: string };
      /** Sprint 9's card, from the SAME engine (`buildLeadStepView`). A failed engine read never says "Lectual has it". */
      top: TopCardView;
      facts: LeadStepView["facts"] | null;
      did: LeadStepView["did"];
      tags: { status: "ok"; on: CardTag[]; addable: CardTag[]; edit: boolean } | { status: "unavailable"; text: string };
      contact: { call: string | null; email: string | null };
      proposal: ProposalView;
    })
  | (OpenedCommon & { status: "ok"; kind: "matter"; deadline: DeadlineLine });

function checklist(read: CardRead<CardTask[]>, edits: CardEdits, now: Date, timeZone: string): ChecklistView {
  if (read.status !== "ok") return { status: "unavailable", text: RECORD_CARD_STEPS_FAILED };
  return {
    status: "ok",
    items: read.value.map((t) => ({ id: t.id, title: t.title, ...dueOf(t.dueAt, now, timeZone), dueIso: t.dueAt && /^\d{4}-\d{2}-\d{2}/.test(t.dueAt) ? t.dueAt.slice(0, 10) : null })),
    add: edits.stepAdd,
    done: edits.stepDone,
    snooze: edits.stepSnooze,
    edit: edits.stepEdit,
  };
}

/** `tel:` only for a number that has digits, `mailto:` only for an address. They open the person's own apps; nothing is sent from Lectual. */
export function contactLinks(lead: Pick<CardLeadRow, "phone" | "email">): { call: string | null; email: string | null } {
  const digits = (lead.phone ?? "").replace(/[^\d+]/g, "");
  const tel = /\d{3,}/.test(digits) ? `tel:${digits}` : null;
  const addr = (lead.email ?? "").trim();
  // `?`, `#`, `&` and `%` would let a stored address add headers (cc=, body=) to the mail link: no link at all then.
  const mail = /^[^\s@<>"?#&%]+@[^\s@<>"?#&%]+\.[^\s@<>"?#&%]+$/.test(addr) ? `mailto:${addr}` : null;
  return { call: tel, email: mail };
}

function proposalView(read: CardRead<CardProposal | null>): ProposalView {
  if (read.status === "not-set-up") return null;
  if (read.status === "unavailable") return { status: "unavailable", text: LEAD_STEP_COULDNT_LOAD };
  if (!read.value) return { status: "none" };
  return { status: "ok", lines: proposalFeeLines(read.value), href: `/dashboard/proposals/${encodeURIComponent(read.value.id)}/` };
}

/**
 * The Matters page offers its card menus only `matterMoveStages`; the opened card gets the same list. Only a matter whose
 * stage read worked is touched: a lead, and a failed stage read, keep the loader's result exactly.
 */
export function withMatterMoveStages(load: RecordCardLoad, moveStages?: readonly CardStage[]): RecordCardLoad {
  if (!moveStages || load.status !== "ok" || load.kind !== "matter" || load.stages.status !== "ok") return load;
  const value = moveStages.map((s) => ({ id: s.id, label: s.label }));
  // The matter's own stage stays in the list (never a move target: moveTargets drops the current id) so a matter opened on an
  // intake stage by a direct ?open= link still shows its stage name.
  const current = load.matter.stage_id ? load.stages.value.find((s) => s.id === load.matter.stage_id) : undefined;
  if (current && !value.some((s) => s.id === current.id)) value.push({ id: current.id, label: current.label });
  return { ...load, stages: { status: "ok", value } };
}

/** The opened card for `?open=`. A foreign or missing id carries no field of the record, only the sentence. */
export function buildOpenedCard(load: RecordCardLoad, page: { path: string; params: CurrentParams }): OpenedCardView {
  const close = closeHref(page.path, page.params);
  if (load.status === "not-found") return { status: "not-found", text: RECORD_CARD_NOT_FOUND, closeHref: close };
  if (load.status === "unavailable") return { status: "unavailable", text: RECORD_CARD_UNAVAILABLE, closeHref: close };
  const now = new Date(load.now);
  const ctx: CardContext = { role: load.role, members: load.members, stages: load.stages, mergeAvailable: load.kind === "lead" ? load.mergeAvailable : false, path: page.path, params: page.params, now, timeZone: load.timeZone };
  const titleId = `record-card-title-${load.kind}`;

  if (load.kind === "matter") {
    const firstTask: CardRead<CardTask | null> = load.tasks.status === "ok" ? { status: "ok", value: load.tasks.value[0] ?? null } : { status: "unavailable" };
    const card = buildBoardCard({ kind: "matter", matter: load.matter, nextStep: firstTask, deadline: load.deadline, lastActivityAt: load.activity.status === "ok" ? (load.activity.value.rows[0]?.created_at ?? null) : null, lastActivityUnavailable: load.activity.status !== "ok" }, ctx);
    return {
      status: "ok",
      kind: "matter",
      card,
      titleId,
      closeHref: close,
      steps: checklist(load.tasks, card.edits, now, load.timeZone),
      timeline: load.activity,
      documents: load.documents,
      deadline: deadlineLine(load.deadline) ?? { status: "unavailable", text: LEAD_STEP_COULDNT_LOAD },
    };
  }

  const step = load.leadStep.status === "ok" ? buildLeadStepView(load.leadStep.facts) : null;
  const facts = load.leadStep.status === "ok" ? load.leadStep.facts : null;
  const tasks: CardRead<CardTask[]> =
    facts && facts.tasks.status === "ok" ? { status: "ok", value: facts.tasks.value.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, assigneeId: t.assigneeId })) } : { status: "unavailable" };
  const timeline: CardRead<{ rows: ActivityRow[]; truncated: boolean }> = facts && facts.activity.status === "ok" ? { status: "ok", value: facts.activity.value } : { status: "unavailable" };
  const temperature = load.temperature;
  const card = buildBoardCard(
    {
      kind: "lead",
      lead: load.lead,
      temperature: temperature ?? { value: null, source: "suggested", reason: "" },
      suggestion: temperature ? "ok" : "unavailable",
      nextStep: tasks.status === "ok" ? { status: "ok", value: tasks.value[0] ?? null } : { status: "unavailable" },
      approvals: load.approvals,
      duplicateOf: load.duplicateOf,
    },
    ctx,
  );
  // A person's level still shows when the stages (the suggestion's input) couldn't be read.
  if (!temperature && card.temperature) {
    card.temperature = temperatureControl(
      load.lead.lane === "hot" || load.lead.lane === "warm" || load.lead.lane === "cold" ? { value: load.lead.lane, source: "person", reason: "" } : { value: null, source: "suggested", reason: "" },
      { canEdit: card.edits.temperature, suggestion: "unavailable" },
    );
  }
  const tags: Extract<OpenedCardView, { kind: "lead" }>["tags"] =
    load.tags.status === "ok"
      ? (() => {
          const on = load.tags.value.on;
          const onIds = new Set(on.map((t) => t.id));
          return { status: "ok", on, addable: card.edits.tags ? load.tags.value.catalog.filter((t) => !onIds.has(t.id)) : [], edit: card.edits.tags };
        })()
      : { status: "unavailable", text: LEAD_STEP_COULDNT_LOAD };
  return {
    status: "ok",
    kind: "lead",
    names: { first: load.lead.first_name ?? "", last: load.lead.last_name ?? "", business: load.lead.business_name ?? "" },
    card,
    titleId,
    closeHref: close,
    top: step ? step.top : { kind: "couldnt-load", text: LEAD_STEP_CANT_SHOW_NEEDS },
    facts: step ? step.facts : null,
    did: step ? step.did : { status: "unavailable", text: LEAD_STEP_DID_UNAVAILABLE },
    steps: checklist(tasks, card.edits, now, load.timeZone),
    timeline,
    tags,
    contact: contactLinks(load.lead),
    proposal: proposalView(load.proposal),
    documents: load.documents,
  };
}
