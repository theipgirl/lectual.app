import type { HubFlow, HubRecordKind, HubStep } from "./hub";
import { HUB_CENTERED } from "./hub";
import type { TourStep } from "./tour";

/**
 * The flow runner's decisions, pure so cross-page resume, Back, Skip and Finish
 * are tested without a browser. The component only reads and writes the two
 * sessionStorage values and calls the router with what these return.
 */

/** `flowId:index`, the one place a flow in progress is remembered. */
export const HUB_FLOW_KEY = "lectual_hub_flow";
/** The records picked when the flow started, so every page of a flow shows the same lead or matter. */
export const HUB_RECORDS_KEY = "lectual_hub_records";
/** Flows finished in this browser whose save did not land. */
export const HUB_LOCAL_DONE_KEY = "lectual_hub_local_done";
/** Dispatched on `window` when a flow is started from the page, so an already-mounted runner picks it up. */
export const HUB_START_EVENT = "lectual:hub-start";

export type HubRecords = { lead: string | null; matter: string | null; failed: boolean };
export const NO_RECORDS: HubRecords = { lead: null, matter: null, failed: false };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeFlowState(flowId: string, index: number): string {
  return `${flowId}:${index}`;
}

export type ResumeResult =
  | { kind: "none" }
  | { kind: "resume"; flow: HubFlow; index: number }
  | { kind: "restart"; flow: HubFlow };

/**
 * Reads the stored `flowId:index` against the flows this person can see.
 * Malformed, unknown, or no longer visible clears it; a known flow with an index
 * that is not a step of it restarts from the first step. Never throws.
 */
export function resumeFlow(raw: string | null | undefined, flows: readonly HubFlow[]): ResumeResult {
  if (typeof raw !== "string") return { kind: "none" };
  const at = raw.lastIndexOf(":");
  if (at <= 0) return { kind: "none" };
  const flow = flows.find((f) => f.id === raw.slice(0, at));
  if (!flow) return { kind: "none" };
  const text = raw.slice(at + 1);
  if (!/^\d{1,3}$/.test(text)) return { kind: "restart", flow };
  const index = Number(text);
  return index < flow.steps.length ? { kind: "resume", flow, index } : { kind: "restart", flow };
}

export function encodeRecords(records: HubRecords): string {
  return JSON.stringify(records);
}

/** A stored value that is not exactly what `encodeRecords` writes reads as "no records"; ids are checked before they can reach a path. */
export function decodeRecords(raw: string | null | undefined): HubRecords {
  if (typeof raw !== "string") return NO_RECORDS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return NO_RECORDS;
    const r = value as Record<string, unknown>;
    const id = (v: unknown) => (typeof v === "string" && ID_PATTERN.test(v) ? v : null);
    return { lead: id(r.lead), matter: id(r.matter), failed: r.failed === true };
  } catch {
    return NO_RECORDS;
  }
}

export function flowNeedsRecords(flow: HubFlow): boolean {
  return flow.steps.some((s) => s.record);
}

export function recordIdFor(records: HubRecords, kind: HubRecordKind): string | null {
  return kind === "lead" ? records.lead : records.matter;
}

/** Where a record step falls back to when there is nothing to open: the list it would be opened from. */
const LIST_PATH: Record<HubRecordKind, string> = { lead: "/dashboard/intake/", matter: "/dashboard/matters/" };

export type StepView = {
  stepId: string;
  /** The page the step is on, with a record's id filled in. */
  path: string;
  /** A `data-tour` token, or null for a centered card. */
  target: string | null;
  title: string;
  body: string;
  side: HubStep["side"];
  centered: boolean;
};

const MISSING_RECORD: Record<"none" | "failed", string> = {
  none: "Nothing here yet.",
  failed: "Your records couldn't be loaded.",
};

/** The step as it will be drawn. A record step with no record is a centered card saying what the page would show. */
export function stepView(step: HubStep, records: HubRecords): StepView {
  if (step.record) {
    const id = recordIdFor(records, step.record);
    if (id) {
      return {
        stepId: step.id,
        path: step.path.replace("[id]", encodeURIComponent(id)),
        target: step.target === HUB_CENTERED ? null : step.target,
        title: step.title,
        body: step.body,
        side: step.side,
        centered: step.target === HUB_CENTERED,
      };
    }
    return {
      stepId: step.id,
      path: LIST_PATH[step.record],
      target: null,
      title: step.title,
      body: `${records.failed ? MISSING_RECORD.failed : MISSING_RECORD.none} ${step.unseen ?? ""}`.trim(),
      side: step.side,
      centered: true,
    };
  }
  return {
    stepId: step.id,
    path: step.path,
    target: step.target === HUB_CENTERED ? null : step.target,
    title: step.title,
    body: step.body,
    side: step.side,
    centered: step.target === HUB_CENTERED,
  };
}

/** The engine's step shape, so the first-sign-in tour's markup draws it. */
export function toTourStep(view: StepView): TourStep {
  return { id: view.stepId, target: view.target, title: view.title, body: view.body, side: view.side };
}

function samePath(a: string, b: string): boolean {
  const normal = (p: string) => {
    const base = p.split(/[?#]/)[0];
    return base.endsWith("/") ? base : `${base}/`;
  };
  return normal(a) === normal(b);
}

export type RunnerMove = {
  index: number;
  view: StepView;
  /** The stored `flowId:index`. */
  state: string;
  /** The page to go to, or null when the step is on the page already showing. */
  navigate: string | null;
};

export function moveTo(flow: HubFlow, index: number, records: HubRecords, currentPath: string | null): RunnerMove {
  const clamped = Math.min(Math.max(Math.trunc(index) || 0, 0), flow.steps.length - 1);
  const view = stepView(flow.steps[clamped], records);
  return {
    index: clamped,
    view,
    state: encodeFlowState(flow.id, clamped),
    navigate: currentPath !== null && samePath(currentPath, view.path) ? null : view.path,
  };
}

/** Starting always begins at the first step, and goes to its page unless the person is already there. */
export function startFlow(flow: HubFlow, records: HubRecords, currentPath: string | null): RunnerMove {
  return moveTo(flow, 0, records, currentPath);
}

export type RunnerAction = "next" | "back" | "skip";
export type RunnerStep =
  | { kind: "move"; move: RunnerMove }
  | { kind: "end"; outcome: "finished" | "skipped"; markDone: string | null };

/**
 * Next on the last step finishes (and marks the flow done); Skip or Esc ends it
 * without marking anything; Back on a first step stays put. Moving to a step on
 * another page asks for navigation, and Back across pages does the same.
 */
export function advanceFlow(flow: HubFlow, index: number, action: RunnerAction, records: HubRecords, currentPath: string | null): RunnerStep {
  if (action === "skip") return { kind: "end", outcome: "skipped", markDone: null };
  if (action === "next") {
    if (index >= flow.steps.length - 1) return { kind: "end", outcome: "finished", markDone: flow.id };
    return { kind: "move", move: moveTo(flow, index + 1, records, currentPath) };
  }
  return { kind: "move", move: moveTo(flow, index - 1, records, currentPath) };
}

/** True when the person left the step's page by their own navigation, so the flow should close rather than point at the wrong page. */
export function leftFlowPage(pathname: string, view: StepView, expectingNavigation: boolean): boolean {
  return !expectingNavigation && !samePath(pathname, view.path);
}

export type SavedResult = { ok: boolean } | null | undefined;

/**
 * Progress after a flow ends. Finish is optimistic: the flow counts as done
 * locally whether or not the save landed, and a failed save returns no notice,
 * because nothing about it is the person's to fix.
 */
export function afterFinish(localDone: readonly string[], flowId: string, saved: SavedResult): { done: string[]; notice: null; saved: boolean } {
  const done = localDone.includes(flowId) ? [...localDone] : [...localDone, flowId];
  return { done, notice: null, saved: !!saved && saved.ok === true };
}

// ── storage ────────────────────────────────────────────────────────────

export type StorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };

/** Remembers a flow at its first step and the records it will use. Storage that throws (private mode) just means no resume. */
export function storeStart(storage: StorageLike | null | undefined, flow: HubFlow, records: HubRecords): void {
  try {
    storage?.setItem(HUB_RECORDS_KEY, encodeRecords(records));
    storage?.setItem(HUB_FLOW_KEY, encodeFlowState(flow.id, 0));
  } catch {
    // The flow still runs on this page; it just cannot resume after a reload.
  }
}

export function storeState(storage: StorageLike | null | undefined, state: string): void {
  try {
    storage?.setItem(HUB_FLOW_KEY, state);
  } catch {
    // See storeStart.
  }
}

export function clearFlow(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(HUB_FLOW_KEY);
    storage?.removeItem(HUB_RECORDS_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Flow ids finished in this session whose save failed. Malformed values read as none. */
export function readLocalDone(storage: StorageLike | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(HUB_LOCAL_DONE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function writeLocalDone(storage: StorageLike | null | undefined, done: readonly string[]): void {
  try {
    if (done.length === 0) storage?.removeItem(HUB_LOCAL_DONE_KEY);
    else storage?.setItem(HUB_LOCAL_DONE_KEY, JSON.stringify(done));
  } catch {
    // Progress for this page view only.
  }
}
