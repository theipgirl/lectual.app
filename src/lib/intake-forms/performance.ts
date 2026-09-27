import { FIRM_TIME_ZONE } from "@/lib/quotes/firm-time";
import { relativeTime } from "@/lib/relative-time";
import {
  parseAnswers,
  parseContact,
  submissionFitLabel,
  submissionModeLabel,
  submissionStatusLabel,
  type IntakeAnswer,
} from "./submission";

/**
 * The Performance tab, as pure functions over rows already read: the funnel
 * (visited → started, chat or form → completed) from `crm_intake_event`, and
 * the "All intakes" table and drawer from `crm_intake_submission`. The reads
 * themselves, with their three states, are in `load-performance.ts`.
 *
 * Visits are anonymous. An event carries a salted `session_hash` and nothing
 * else (0075), so "Visited" is distinct sessions, not people — the page says
 * "estimated". An event with no hash counts once on its own.
 */

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export function parseRange(v: unknown): RangeDays {
  const n = Number(v);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30;
}

export type FunnelEvent = { kind: string; session_hash: string | null };

export type Funnel = {
  visited: number;
  chat: number;
  form: number;
  started: number;
  completed: number;
  /** "12.4%", or "—" when there is nothing to divide by. */
  startRate: string;
  completeRate: string;
};

export function percent(a: number, b: number): string {
  return b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—";
}

export function buildFunnel(events: FunnelEvent[]): Funnel {
  const sets: Record<string, Set<string>> = {
    visit: new Set(),
    start_conversation: new Set(),
    start_form: new Set(),
    complete: new Set(),
  };
  events.forEach((e, i) => {
    const set = sets[e.kind];
    if (set) set.add(e.session_hash ?? `#${i}`);
  });
  const chat = sets.start_conversation.size;
  const form = sets.start_form.size;
  const started = chat + form;
  const completed = sets.complete.size;
  // A visit is logged when the page loads, so everyone who started visited.
  // If visit logging lagged (or a hash rotated), don't show fewer visits than starts.
  const visited = Math.max(sets.visit.size, started);
  return {
    visited,
    chat,
    form,
    started,
    completed,
    startRate: percent(started, visited),
    completeRate: percent(completed, started),
  };
}

export type SubmissionListRow = {
  id: string;
  mode: string;
  contact: unknown;
  fit: string;
  status: string;
  started_at: string;
  last_active_at: string;
};

export type IntakeTableRow = {
  id: string;
  name: string;
  company: string;
  email: string;
  started: string;
  mode: string;
  fit: string;
  fitKey: string;
  status: string;
  statusKey: string;
  last: string;
};

/** "Sep 25, 8:04 AM", on the firm's clock (Vercel runs UTC; the firm doesn't). */
export function formatIntakeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FIRM_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function intakeTableRows(rows: SubmissionListRow[], now = Date.now()): IntakeTableRow[] {
  return rows.map((r) => {
    const c = parseContact(r.contact);
    return {
      id: r.id,
      name: c.name || c.email || "No name given",
      company: c.company || "—",
      email: c.email,
      started: formatIntakeTime(r.started_at),
      mode: submissionModeLabel(r.mode),
      fit: submissionFitLabel(r.fit),
      fitKey: r.fit,
      status: submissionStatusLabel(r.status),
      statusKey: r.status,
      last: relativeTime(r.last_active_at, now),
    };
  });
}

export type SubmissionDetailRow = SubmissionListRow & { answers: unknown; screening_note: string | null; submitted_at: string | null };

export type IntakeDetail = {
  id: string;
  name: string;
  sub: string;
  fit: string;
  fitKey: string;
  status: string;
  statusKey: string;
  modeLine: string;
  why: string;
  answers: { q: string; a: string }[];
};

export function intakeDetail(r: SubmissionDetailRow): IntakeDetail {
  const c = parseContact(r.contact);
  const answers: IntakeAnswer[] = parseAnswers(r.answers);
  const contactLine = [c.name, c.email, c.phone].filter(Boolean).join(" · ") || "Not given";
  return {
    id: r.id,
    name: c.name || c.email || "No name given",
    sub: [c.company, c.email].filter(Boolean).join(" · "),
    fit: submissionFitLabel(r.fit),
    fitKey: r.fit,
    status: submissionStatusLabel(r.status),
    statusKey: r.status,
    modeLine: `${submissionModeLabel(r.mode)} · ${formatIntakeTime(r.started_at)}${r.submitted_at ? "" : " · not submitted"}`,
    why: r.screening_note?.trim() || "Not screened yet.",
    answers: [{ q: "Contact", a: contactLine }, ...answers.map((a) => ({ q: a.question || "Question", a: a.answer || "—" }))],
  };
}
