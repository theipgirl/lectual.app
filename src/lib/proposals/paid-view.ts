/**
 * The paid mark and its follow-up steps, as words and tones (Sprint 19). Pure and
 * client-safe: the proposal page, the proposals list and the action confirmations all
 * read these, so "Paid · marked by Dawn · Oct 21" and "Not uploaded to Lawmatics: ..."
 * are written once.
 *
 * Everything is derived from the proposal's step events (`paid.ts`). An events read that
 * failed is its own state ("Paid status couldn't be read"): never "Not paid", never "Paid".
 */

import { formatShortFirmDate } from "@/lib/quotes/labels";
import { CHOOSE_LOE_TEMPLATE } from "./loe-adapter";
import { paidStateFromEvents, stepStates, STEP_SUCCESS, type PaidState, type ProposalStep, type RetryableStep, type StepEventInput, type StepState } from "./paid";
import { MARK_PAID_WORDS, notUploadedText, notWrittenText, STEP_TEXT } from "./step-text";

export type Tone = "ok" | "warn" | "risk" | "mute";

/* ─────────────────────────── the paid line ──────────────────────────────── */

/**
 * "Paid · marked by Dawn · Oct 21". When the name can't be resolved it is dropped, never
 * replaced by an id: "Paid · Oct 21".
 */
export function paidLine(paid: Extract<PaidState, { state: "paid" }>, names: ReadonlyMap<string, string>, tz: string): string {
  const who = paid.by ? names.get(paid.by) : undefined;
  const when = formatShortFirmDate(paid.at, tz);
  return ["Paid", who ? `marked by ${who}` : null, when || null].filter(Boolean).join(" · ");
}

export type PaidMarker = { state: "paid" | "not_paid" | "unreadable"; label: string; tone: Tone };

/** The marker the list shows and the panel's first line: from the same `PaidState`, or "unreadable". */
export function paidMarker(paid: PaidState | "unreadable", names: ReadonlyMap<string, string>, tz: string): PaidMarker {
  if (paid === "unreadable") return { state: "unreadable", label: MARK_PAID_WORDS.unreadable, tone: "risk" };
  if (paid.state === "paid") return { state: "paid", label: paidLine(paid, names, tz), tone: "ok" };
  return { state: "not_paid", label: "Not paid", tone: "mute" };
}

/* ─────────────────────────── the step lines ─────────────────────────────── */

export const STEP_LABEL: Record<ProposalStep, string> = {
  paid_marked: "Paid",
  paid_undone: "Paid",
  accept_notice: "Firm notice",
  lawmatics_note: "Lawmatics note",
  loe_draft: "Engagement letter draft",
  accepted_file_upload: "Accepted proposal file",
  loe_file_upload: "Engagement letter file",
  custom_fields: "LOE fields",
};

const SUCCESS_TEXT: Partial<Record<ProposalStep, string>> = {
  accept_notice: "The firm was told about the acceptance.",
  lawmatics_note: "Note added to Lawmatics.",
  loe_draft: "Engagement letter draft queued for approval.",
  accepted_file_upload: "Accepted proposal uploaded to Lawmatics.",
  loe_file_upload: "LOE file uploaded to Lawmatics.",
  custom_fields: "LOE fields written to Lawmatics.",
};

/** One step's outcome as the sentence the page prints. */
export function stepText(state: Pick<StepState, "step" | "outcome" | "reason">): string {
  const { step, outcome, reason } = state;
  if (outcome === STEP_SUCCESS[step]) return [SUCCESS_TEXT[step], step === "custom_fields" ? reason : null].filter(Boolean).join(" ");
  switch (step) {
    case "accepted_file_upload":
    case "loe_file_upload":
      // A request that went out and was refused carries the unverified-shape caution; "not connected" and "not linked" do not.
      return outcome === "failed" ? notUploadedText(reason ?? "the request failed") : (reason ?? "Not uploaded to Lawmatics.");
    case "custom_fields":
      return outcome === "failed" ? notWrittenText(reason ?? "the request failed") : (reason ?? "Not written to Lawmatics.");
    case "lawmatics_note":
      return `Lawmatics note not added${reason ? `: ${reason}` : ""}.`;
    case "accept_notice":
      return `The firm notice was not sent${reason ? `: ${reason}` : ""}.`;
    default:
      return reason ?? "This step did not finish.";
  }
}

function toneOf(state: Pick<StepState, "step" | "outcome">): Tone {
  if (state.outcome === STEP_SUCCESS[state.step]) return "ok";
  return state.outcome === "skipped" ? "mute" : "warn";
}

export type PanelLine = {
  key: string;
  label: string;
  text: string;
  tone: Tone;
  /** The step the Retry button runs; null for success, for "skipped" and for a person who can't act. */
  retry: RetryableStep | null;
  link: { href: string; label: string } | null;
};

const LINE_ORDER: ProposalStep[] = ["loe_draft", "loe_file_upload", "accepted_file_upload", "accept_notice", "lawmatics_note", "custom_fields"];
const RETRYABLE = new Set<ProposalStep>(["loe_draft", "accepted_file_upload", "custom_fields", "lawmatics_note", "loe_file_upload"]);

const LOE_FORM = (matterId: string) => `/dashboard/documents/new/${encodeURIComponent(matterId)}/loe/`;

export type PaidPanelInput = {
  proposalId: string;
  matterId: string | null;
  /** The version's step events; `null` when the read failed. */
  events: readonly StepEventInput[] | null;
  names: ReadonlyMap<string, string>;
  tz: string;
  /** Owner / admin / senior admin / intake. */
  canAct: boolean;
};

export type PaidPanelView = {
  marker: PaidMarker;
  /** "Marked by hand. LawPay isn't connected to proposals yet.", shown while paid (and beside Mark paid). */
  byHandNote: string;
  /** Shown only when the events could not be read. */
  unreadableHelp: string | null;
  showMark: boolean;
  showUndo: boolean;
  lines: PanelLine[];
  /** The unknown-package case: heading plus a link to the LOE form when a matter exists. */
  chooseTemplate: { text: string; href: string | null } | null;
};

export function buildPaidPanelView(input: PaidPanelInput): PaidPanelView {
  if (input.events === null) {
    return {
      marker: paidMarker("unreadable", input.names, input.tz),
      byHandNote: MARK_PAID_WORDS.byHand,
      unreadableHelp: MARK_PAID_WORDS.unreadableHelp,
      showMark: false,
      showUndo: false,
      lines: [],
      chooseTemplate: null,
    };
  }
  const paid = paidStateFromEvents(input.events);
  const steps = stepStates(input.events, input.proposalId);
  const lines: PanelLine[] = [];
  let chooseTemplate: PaidPanelView["chooseTemplate"] = null;

  for (const step of LINE_ORDER) {
    const s = steps[step];
    if (!s) continue;
    const success = s.outcome === STEP_SUCCESS[step];
    const retry = !success && s.outcome !== "skipped" && RETRYABLE.has(step) && input.canAct && paid.state === "paid" ? (step as RetryableStep) : null;
    let link: PanelLine["link"] = null;
    if (step === "loe_draft" && success && typeof s.payload.queue_item_id === "string") {
      link = { href: `/dashboard/queue/${encodeURIComponent(s.payload.queue_item_id)}/`, label: "Open the queued engagement letter" };
    }
    if (step === "loe_draft" && !success && s.payload.code === "unknown_package") {
      const matterId = typeof s.payload.matter_id === "string" ? s.payload.matter_id : input.matterId;
      chooseTemplate = { text: CHOOSE_LOE_TEMPLATE, href: matterId ? LOE_FORM(matterId) : null };
    }
    lines.push({ key: step, label: STEP_LABEL[step], text: stepText(s), tone: toneOf(s), retry, link });
  }

  // A queued letter that nobody has approved yet: say what happens next, so the missing upload isn't a silent gap.
  const queued = steps.loe_draft;
  if (queued && queued.outcome === STEP_SUCCESS.loe_draft && !steps.loe_file_upload) {
    const at = lines.findIndex((l) => l.key === "loe_draft");
    lines.splice(at + 1, 0, {
      key: "loe_file_upload",
      label: STEP_LABEL.loe_file_upload,
      text: "Waiting for approval in the queue. The file is uploaded to Lawmatics after it is approved.",
      tone: "mute",
      retry: null,
      link: null,
    });
  }

  return {
    marker: paidMarker(paid, input.names, input.tz),
    byHandNote: MARK_PAID_WORDS.byHand,
    unreadableHelp: null,
    showMark: input.canAct && paid.state === "not_paid",
    showUndo: input.canAct && paid.state === "paid",
    lines,
    chooseTemplate,
  };
}

/** What the action says after a flow: one clause per step that ran, plus the timeline caution. */
export function reportText(report: { step: ProposalStep; outcome: string; reason: string | null; recorded: boolean }): string {
  const text = stepText(report);
  return report.recorded ? text : `${text} ${STEP_TEXT.eventNotRecorded}`;
}
