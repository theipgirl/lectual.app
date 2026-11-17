import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { canApproveItem, kindShort, memberName, ownerOf, type RoutableItem } from "@/lib/queue/routing";
import { formatCents } from "@/lib/quotes/money";
import {
  LEAD_STEP_APPROVALS_OFF,
  LEAD_STEP_A_TEAMMATE,
  LEAD_STEP_DID_CUT,
  LEAD_STEP_DRAFT_PROPOSAL,
  LEAD_STEP_FOLLOW_UP_PASSED,
  LEAD_STEP_FOLLOW_UP_PASSED_TEXT,
  LEAD_STEP_HANDED_AWAY,
  LEAD_STEP_LINK_NOT_LIVE,
  LEAD_STEP_ROW_PROPOSAL,
  LEAD_STEP_STALLED_MAY_DRAFT,
  leadStepHandedTo,
  leadStepHandedToYou,
  LEAD_STEP_CANT_CHECK,
  LEAD_STEP_CANT_SHOW_NEEDS,
  LEAD_STEP_CANT_SHOW_NEXT,
  LEAD_STEP_CLOSER_LOOK,
  LEAD_STEP_CONTACT_OFF,
  LEAD_STEP_COULDNT_LOAD,
  LEAD_STEP_DID_UNAVAILABLE,
  LEAD_STEP_FACT_CONSULT,
  LEAD_STEP_FACT_CONTACT,
  LEAD_STEP_FACT_PROPOSAL,
  LEAD_STEP_FACT_WAITING,
  LEAD_STEP_GAP,
  LEAD_STEP_HAS_IT,
  LEAD_STEP_NEEDS_AN_APPROVER,
  LEAD_STEP_NEEDS_YES,
  LEAD_STEP_NOT_BOOKED,
  LEAD_STEP_NOT_PAID,
  LEAD_STEP_NOT_PREPARED,
  LEAD_STEP_NO_CONTACT,
  LEAD_STEP_NO_PROPOSAL,
  LEAD_STEP_OFF,
  LEAD_STEP_OPENS_UNAVAILABLE,
  LEAD_STEP_OVERDUE,
  LEAD_STEP_PAID,
  LEAD_STEP_PAID_UNAVAILABLE,
  LEAD_STEP_PREVIEW_ONLY,
  LEAD_STEP_PROPOSAL_CLOSED,
  LEAD_STEP_PROPOSAL_DRAFT,
  LEAD_STEP_PROPOSAL_LIVE,
  LEAD_STEP_PROPOSAL_SAVED,
  LEAD_STEP_QUIET,
  LEAD_STEP_ROW_LEGAL,
  LEAD_STEP_ROW_USPTO,
  LEAD_STEP_ROW_VERSION,
  LEAD_STEP_QUIET_NOTE,
  LEAD_STEP_THEIR_TURN,
  LEAD_STEP_THEY_WROTE,
  LEAD_STEP_WAITING_FOR_RUN,
  LEAD_STEP_WAITING_ON_APPROVER,
  LEAD_STEP_WAIT_APPROVAL,
  LEAD_STEP_WAIT_LECTUAL,
  LEAD_STEP_WAIT_PERSON,
  LEAD_STEP_WAIT_US,
  LEAD_STEP_WE_WROTE,
  LEAD_STEP_YOURS,
  LEAD_STEP_YOUR_YES,
  OUR_TURN,
  leadStepAccepted,
  leadStepConsultHeld,
  leadStepFollowUpDay,
  leadStepLastDay,
  leadStepMoreSteps,
  leadStepNeedsYesOf,
  leadStepOpened,
  leadStepOthers,
  leadStepPrepPromise,
  leadStepProposalAfterConsult,
  leadStepProposalFromRecording,
  leadStepWaitingForConsult,
  leadStepWaitingOn,
  notReadyYet,
} from "@/lib/ui/words";
import { decideTopCard, type DueState, type TopCard } from "./decide";
import { readDid, type DidRow } from "./did";
import type { LeadStepFacts, PendingDraft } from "./facts";
import type { GapId } from "./gaps";
import { dayWord, shortDay, whenWords, windowWords } from "./schedule";

/**
 * Exactly what the lead page draws for "where Lectual does the step": the one top card, the four facts, the
 * "What Lectual did" list and the read-only flags. The facts in, plain data out: no React, no database and no
 * server-only import (tests/lead-step/hygiene.test.ts walks the import graph).
 * Every word comes from words.ts. The page draws this and decides nothing.
 */

/** Yes is held this long in the browser, with Undo, before anything is posted (the approval deck's rule). */
export const YES_HOLD_MS = 5_000;

export type FactView = { label: string; value: string; sub: string | null; state: "ok" | "off" | "unavailable" };

export type NeedsYesView = {
  kind: "needs-yes";
  eyebrow: string;
  itemId: string;
  kindLabel: string;
  headline: string;
  attorneyOnly: boolean;
  email: { to: string | null; subject: string | null; body: string } | null;
  proposal: { rows: { label: string; value: string }[]; href: string } | null;
  /** The reviewer notes the drafter left (CHECK FIRST ones marked). */
  why: { text: string; checkFirst: boolean }[];
  others: string | null;
  /** Which buttons this viewer gets. All false = read-only. */
  actions: { yes: boolean; edit: boolean; notThis: boolean };
  /** Why Yes isn't offered to someone who could approve (closer look, couldn't check, preview), else null. */
  blocked: string | null;
  /** Read-only: whose yes it is waiting on. Null when the viewer may approve. */
  waitingOn: string | null;
  /** The deck's hand-off: "Handed to you by Rebecca" (with Send back) or "Handed to Rayn". Null when not handed. */
  handoff: { text: string; toViewer: boolean; note: string | null } | null;
  /** Send back is offered (the card is handed to this viewer; the existing `sendCardBack` path). */
  sendBack: boolean;
  /** The full approval page, for Open to review. */
  approvalHref: string;
  holdMs: number;
};

export type TopCardView =
  | NeedsYesView
  | { kind: "has-it"; eyebrow: string; waitingFor: string; line: string }
  | {
      kind: "yours";
      eyebrow: string;
      overdue: boolean;
      taskId: string;
      title: string;
      due: DueState;
      dueText: string | null;
      assigneeId: string | null;
      others: string | null;
      /** A read about what Lectual will do next failed: said under the step, never hidden. */
      note: string | null;
    }
  | { kind: "not-prepared"; eyebrow: string; gap: GapId; title: string | null; text: string; off: string | null }
  | { kind: "approvals-off"; eyebrow: string; text: string }
  | { kind: "quiet"; eyebrow: string; text: string }
  | { kind: "couldnt-load"; text: string };

export type DidRowView = { id: string; at: string; when: string; text: string; undo: { activityId: string } | null; undone: boolean };

export type LeadStepView = {
  top: TopCardView;
  facts: { contact: FactView; consult: FactView; proposal: FactView | null; waiting: FactView };
  did: { status: "ok"; rows: DidRowView[]; note: string | null } | { status: "unavailable"; text: string };
  /** The viewer can't say yes to the top card's item (or there is none). */
  readOnly: boolean;
};

const routable = (d: PendingDraft): RoutableItem => ({ type: d.type, agent: d.agent, headline: d.headline, recipient: d.recipient, summary: d.summary, draft_body: d.draftBody, final_body: d.finalBody });

/** May this viewer say yes (or no) to this draft? The routing rule, as `review-core.ts` will re-check it on the server. */
export function viewerMayDecide(facts: Pick<LeadStepFacts, "viewer" | "routing">, item: PendingDraft): boolean {
  const routing = facts.routing.status === "ok" ? facts.routing.routing : {};
  return canApproveItem({ role: facts.viewer.role, userId: facts.viewer.userId, item: routable(item), routing });
}

function waitingOnName(facts: Pick<LeadStepFacts, "routing">, item: PendingDraft): string | null {
  const routing = facts.routing.status === "ok" ? facts.routing.routing : {};
  const owner = ownerOf(routable(item), routing);
  if (owner.kind === "default" || item.attorneyOnly) return null;
  const who = facts.routing.status === "ok" ? facts.routing.members.find((m) => m.userId === owner.userId) : undefined;
  return who ? memberName(who) : null;
}

function memberLabel(facts: Pick<LeadStepFacts, "routing">, userId: string): string {
  const who = facts.routing.status === "ok" ? facts.routing.members.find((m) => m.userId === userId) : undefined;
  return who ? memberName(who) : LEAD_STEP_A_TEAMMATE;
}

function linkedProposalStatusText(status: string): string {
  if (status === "draft") return LEAD_STEP_DRAFT_PROPOSAL;
  if (status === "approved") return LEAD_STEP_PROPOSAL_SAVED;
  if (status === "sent") return LEAD_STEP_PROPOSAL_LIVE;
  return LEAD_STEP_PROPOSAL_CLOSED;
}

function needsYesView(facts: LeadStepFacts, item: PendingDraft, others: number): NeedsYesView {
  const mayDecide = viewerMayDecide(facts, item);
  const preview = facts.viewer.actingAsStaff;
  const owner = waitingOnName(facts, item);
  const holder = item.handoff.status === "ok" ? item.handoff.holder : null;
  const handedToViewer = !!holder && holder.userId === facts.viewer.userId;
  // The hander of a card now with someone else: the yes is theirs (the deck takes it off the hander's cards).
  const handedAway = !!holder && !handedToViewer && holder.by === facts.viewer.userId;
  let blocked: string | null = null;
  if (mayDecide) {
    if (preview) blocked = LEAD_STEP_PREVIEW_ONLY;
    else if (handedAway) blocked = LEAD_STEP_HANDED_AWAY;
    else if (item.closerLook === null || item.linked.status === "unavailable") blocked = LEAD_STEP_CANT_CHECK;
    else if (item.linked.status === "ok" && item.linked.gateRefusal) blocked = item.linked.gateRefusal;
    else if (item.closerLook.linkNotLive) blocked = LEAD_STEP_LINK_NOT_LIVE;
    else if (item.closerLook.reasons.length > 0) blocked = LEAD_STEP_CLOSER_LOOK;
  }
  const canYes = mayDecide && blocked === null;
  const canEdit = !preview && QUEUE_EDIT_ROLES.includes(facts.viewer.role);
  const proposal =
    item.linked.status === "ok"
      ? {
          rows: [
            { label: LEAD_STEP_ROW_PROPOSAL, value: linkedProposalStatusText(item.linked.proposalStatus) },
            { label: LEAD_STEP_ROW_VERSION, value: String(item.linked.version) },
            { label: LEAD_STEP_ROW_LEGAL, value: formatCents(item.linked.legalCents) },
            { label: LEAD_STEP_ROW_USPTO, value: formatCents(item.linked.govCents) },
          ],
          href: `/dashboard/proposals/${encodeURIComponent(item.linked.id)}/`,
        }
      : null;
  return {
    kind: "needs-yes",
    eyebrow: mayDecide ? LEAD_STEP_NEEDS_YES : owner ? leadStepNeedsYesOf(owner) : LEAD_STEP_NEEDS_AN_APPROVER,
    itemId: item.id,
    kindLabel: kindShort(item.kind),
    headline: item.headline,
    attorneyOnly: item.attorneyOnly,
    email: item.type === "CLIENT_EMAIL" ? { to: item.recipient, subject: item.subject, body: item.body } : { to: null, subject: null, body: item.body },
    proposal,
    why: item.reviewer.map((r) => ({ text: r.text, checkFirst: r.checkFirst })),
    others: others > 0 ? leadStepOthers(others) : null,
    actions: { yes: canYes, edit: canEdit, notThis: mayDecide && !preview },
    blocked,
    waitingOn: mayDecide ? null : owner ? leadStepWaitingOn(owner) : LEAD_STEP_WAITING_ON_APPROVER,
    handoff: holder
      ? handedToViewer
        ? { text: leadStepHandedToYou(memberLabel(facts, holder.by)), toViewer: true, note: holder.note }
        : { text: leadStepHandedTo(memberLabel(facts, holder.userId)), toViewer: false, note: holder.note }
      : null,
    sendBack: handedToViewer && !preview,
    approvalHref: `/dashboard/queue/${encodeURIComponent(item.id)}/`,
    holdMs: YES_HOLD_MS,
  };
}

function topView(facts: LeadStepFacts, top: TopCard): TopCardView {
  const now = new Date(facts.now);
  const tz = facts.timeZone;
  switch (top.kind) {
    case "needs-yes":
      return needsYesView(facts, top.item, top.others);
    case "has-it": {
      const p = top.promise;
      const w = windowWords(p.window, now, tz);
      if (p.job === "consult-prep") {
        return { kind: "has-it", eyebrow: LEAD_STEP_HAS_IT, waitingFor: leadStepWaitingForConsult(whenWords(p.consult.startsAt, now, tz)), line: leadStepPrepPromise(w.day, w.from, w.to, p.withClientEmail) };
      }
      if (p.source === "after-consult") {
        return { kind: "has-it", eyebrow: LEAD_STEP_HAS_IT, waitingFor: leadStepWaitingForConsult(whenWords(p.consult.startsAt, now, tz)), line: leadStepProposalAfterConsult(w.day, w.from, w.to) };
      }
      return { kind: "has-it", eyebrow: LEAD_STEP_HAS_IT, waitingFor: LEAD_STEP_WAITING_FOR_RUN, line: leadStepProposalFromRecording(w.day, w.from, w.to) };
    }
    case "yours":
      return {
        kind: "yours",
        eyebrow: LEAD_STEP_YOURS,
        overdue: top.due === "overdue",
        taskId: top.task.id,
        title: top.task.title,
        due: top.due,
        dueText: top.task.dueAt ? `${top.due === "overdue" ? `${LEAD_STEP_OVERDUE} · ` : ""}${shortDay(top.task.dueAt, tz)}` : null,
        assigneeId: top.task.assigneeId,
        others: top.others > 0 ? leadStepMoreSteps(top.others) : null,
        note: top.nextUnknown ? LEAD_STEP_CANT_SHOW_NEXT : null,
      };
    case "not-prepared": {
      const g = top.gap;
      if (g.id === "follow-up") {
        const tail = g.stalledFollowUp === "off" ? "" : ` ${LEAD_STEP_STALLED_MAY_DRAFT}`;
        return g.windowPassed
          ? { kind: "not-prepared", eyebrow: LEAD_STEP_NOT_PREPARED, gap: g.id, title: LEAD_STEP_FOLLOW_UP_PASSED, text: LEAD_STEP_FOLLOW_UP_PASSED_TEXT, off: null }
          : { kind: "not-prepared", eyebrow: LEAD_STEP_NOT_PREPARED, gap: g.id, title: leadStepFollowUpDay(g.day), text: `${LEAD_STEP_GAP[g.id]}${tail}`, off: null };
      }
      return { kind: "not-prepared", eyebrow: LEAD_STEP_NOT_PREPARED, gap: g.id, title: null, text: LEAD_STEP_GAP[g.id], off: top.off ? LEAD_STEP_OFF[top.off.why] : null };
    }
    case "approvals-off":
      return { kind: "approvals-off", eyebrow: LEAD_STEP_QUIET, text: LEAD_STEP_APPROVALS_OFF };
    case "quiet":
      return { kind: "quiet", eyebrow: LEAD_STEP_QUIET, text: top.off ? LEAD_STEP_OFF[top.off.why] : LEAD_STEP_QUIET_NOTE };
    case "couldnt-load":
      return { kind: "couldnt-load", text: top.what === "needs-you" ? LEAD_STEP_CANT_SHOW_NEEDS : LEAD_STEP_CANT_SHOW_NEXT };
  }
}

/* ─────────────────────────── the four facts ─────────────────────────── */

function contactFact(facts: LeadStepFacts): FactView {
  const label = LEAD_STEP_FACT_CONTACT;
  const { lastInboundAt: inb, lastOutboundAt: out } = facts.lead;
  const tIn = inb ? Date.parse(inb) : NaN;
  const tOut = out ? Date.parse(out) : NaN;
  if (!Number.isFinite(tIn) && !Number.isFinite(tOut)) {
    const mailboxOff = facts.jobs.status === "ok" && !facts.jobs.value.modules.mailbox;
    return { label, value: mailboxOff ? LEAD_STEP_CONTACT_OFF : LEAD_STEP_NO_CONTACT, sub: null, state: mailboxOff ? "off" : "ok" };
  }
  const theyLast = Number.isFinite(tIn) && (!Number.isFinite(tOut) || tIn > tOut);
  const at = theyLast ? (inb as string) : (out as string);
  return { label, value: shortDay(at, facts.timeZone), sub: `${theyLast ? LEAD_STEP_THEY_WROTE : LEAD_STEP_WE_WROTE} · ${theyLast ? OUR_TURN : LEAD_STEP_THEIR_TURN}`, state: "ok" };
}

function consultFact(facts: LeadStepFacts): FactView {
  const label = LEAD_STEP_FACT_CONSULT;
  const now = new Date(facts.now);
  const { consult, meetings } = facts;
  if (consult.status === "ok" && consult.value && Date.parse(consult.value.startsAt) > now.getTime()) {
    return { label, value: whenWords(consult.value.startsAt, now, facts.timeZone), sub: null, state: "ok" };
  }
  if (meetings.status === "ok") {
    const held = meetings.value.filter((m) => m.startedAt && Date.parse(m.startedAt) <= now.getTime()).sort((a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? ""))[0];
    if (held?.startedAt) return { label, value: leadStepConsultHeld(dayWord(held.startedAt, now, facts.timeZone)), sub: held.provider === "zoom" ? "Zoom" : held.provider === "fathom" ? "Fathom" : null, state: "ok" };
  }
  if (consult.status === "unavailable" || meetings.status === "unavailable") return { label, value: LEAD_STEP_COULDNT_LOAD, sub: null, state: "unavailable" };
  return { label, value: LEAD_STEP_NOT_BOOKED, sub: null, state: "ok" };
}

function proposalFact(facts: LeadStepFacts): FactView | null {
  const label = LEAD_STEP_FACT_PROPOSAL;
  const { proposal } = facts;
  if (proposal.status === "not-set-up") return null;
  if (proposal.status === "unavailable") return { label, value: LEAD_STEP_COULDNT_LOAD, sub: null, state: "unavailable" };
  const p = proposal.value;
  if (!p) return { label, value: LEAD_STEP_NO_PROPOSAL, sub: null, state: "ok" };
  const tz = facts.timeZone;
  switch (p.status) {
    case "draft":
      return { label, value: LEAD_STEP_PROPOSAL_DRAFT, sub: null, state: "ok" };
    case "approved":
      return { label, value: LEAD_STEP_PROPOSAL_SAVED, sub: null, state: "ok" };
    case "sent": {
      const opened = p.opens.status === "ok" ? leadStepOpened(p.opens.count) : LEAD_STEP_OPENS_UNAVAILABLE;
      return { label, value: `${LEAD_STEP_PROPOSAL_LIVE}, ${opened.charAt(0).toLowerCase()}${opened.slice(1)}`, sub: p.expiresOn ? leadStepLastDay(shortDay(`${p.expiresOn}T12:00:00Z`, "UTC")) : null, state: p.opens.status === "ok" ? "ok" : "unavailable" };
    }
    case "accepted": {
      const paid = p.paid.status === "ok" ? (p.paid.paid ? LEAD_STEP_PAID : LEAD_STEP_NOT_PAID) : p.paid.status === "unavailable" ? LEAD_STEP_PAID_UNAVAILABLE : null;
      return { label, value: leadStepAccepted(p.acceptedAt ? shortDay(p.acceptedAt, tz) : null, p.signed), sub: paid, state: p.paid.status === "unavailable" ? "unavailable" : "ok" };
    }
    default:
      return { label, value: LEAD_STEP_PROPOSAL_CLOSED, sub: null, state: "ok" };
  }
}

function waitingFact(view: TopCardView): FactView {
  const label = LEAD_STEP_FACT_WAITING;
  switch (view.kind) {
    case "needs-yes":
      return { label, value: LEAD_STEP_WAIT_APPROVAL, sub: view.waitingOn ?? LEAD_STEP_YOUR_YES, state: "ok" };
    case "has-it":
      return { label, value: LEAD_STEP_WAIT_LECTUAL, sub: view.waitingFor, state: "ok" };
    case "yours":
    case "not-prepared":
      return { label, value: LEAD_STEP_WAIT_US, sub: LEAD_STEP_WAIT_PERSON, state: "ok" };
    case "approvals-off":
      return { label, value: LEAD_STEP_WAIT_US, sub: notReadyYet("Approvals"), state: "off" };
    case "quiet":
      return { label, value: LEAD_STEP_WAIT_US, sub: null, state: "ok" };
    case "couldnt-load":
      return { label, value: LEAD_STEP_COULDNT_LOAD, sub: null, state: "unavailable" };
  }
}

/* ─────────────────────────── the did list ─────────────────────────── */

function didView(facts: LeadStepFacts): LeadStepView["did"] {
  const list = readDid(facts.activity, facts.lead.id, facts.lead.stageId);
  if (list.status !== "ok") return { status: "unavailable", text: LEAD_STEP_DID_UNAVAILABLE };
  const now = new Date(facts.now);
  // Undo is a person's move: never for Lectual staff viewing as the firm, and only for a role that may move stages.
  const mayUndo = facts.viewer.canMoveStage && !facts.viewer.actingAsStaff;
  return {
    status: "ok",
    note: list.truncated ? LEAD_STEP_DID_CUT : null,
    rows: list.rows.map((r: DidRow) => ({
      id: r.id,
      at: r.at,
      when: whenWords(r.at, now, facts.timeZone),
      text: r.text,
      // Undo only where the Stage Keeper's own Undo exists, it can still undo, and this person may move stages.
      undo: r.undo && r.undo.state === "available" && mayUndo ? { activityId: r.undo.activityId } : null,
      undone: r.undo?.state === "undone",
    })),
  };
}

export function buildLeadStepView(facts: LeadStepFacts): LeadStepView {
  const top = topView(facts, decideTopCard(facts));
  return {
    top,
    facts: { contact: contactFact(facts), consult: consultFact(facts), proposal: proposalFact(facts), waiting: waitingFact(top) },
    did: didView(facts),
    readOnly: top.kind !== "needs-yes" || !top.actions.yes,
  };
}
