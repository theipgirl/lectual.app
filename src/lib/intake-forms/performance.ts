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
 * else (0079), so "Visited" is distinct sessions, not people — the page says
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
  /** Null = gave contact details but never sent answers (contact-first, 0093). */
  submitted_at?: string | null;
  /** Assessments only (0095): the server's score and the staff-only temperature. */
  score?: number | null;
  temperature?: string | null;
  last_active_at: string;
};

const TEMPERATURE_WORD: Record<string, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };

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
  finished: boolean;
};

/** "Sep 25, 8:04 AM", on the firm's clock (Vercel runs UTC; the firm doesn't). */
export function formatIntakeTime(iso: string, tz: string = FIRM_TIME_ZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function intakeTableRows(rows: SubmissionListRow[], now = Date.now(), tz: string = FIRM_TIME_ZONE): IntakeTableRow[] {
  return rows.map((r) => {
    const c = parseContact(r.contact);
    return {
      id: r.id,
      name: c.name || c.email || "No name given",
      company: c.company || "—",
      email: c.email,
      started: formatIntakeTime(r.started_at, tz),
      mode: submissionModeLabel(r.mode),
      // An assessment is scored, not screened: show its temperature and score instead.
      fit: r.temperature ? `${TEMPERATURE_WORD[r.temperature] ?? r.temperature}${typeof r.score === "number" ? ` · ${r.score}` : ""}` : submissionFitLabel(r.fit),
      fitKey: r.temperature ?? r.fit,
      status: submissionStatusLabel(r.status),
      statusKey: r.status,
      last: relativeTime(r.last_active_at, now),
      finished: r.submitted_at !== null,
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

export function intakeDetail(r: SubmissionDetailRow, tz: string = FIRM_TIME_ZONE): IntakeDetail {
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
    modeLine: `${submissionModeLabel(r.mode)} · ${formatIntakeTime(r.started_at, tz)}${r.submitted_at ? "" : " · not submitted"}`,
    why: r.screening_note?.trim() || "Not screened yet.",
    answers: [{ q: "Contact", a: contactLine }, ...answers.map((a) => ({ q: a.question || "Question", a: a.answer || "—" }))],
  };
}

// ── per-intake numbers (0093, contact-first) ─────────────────────────────────

/**
 * Since 0093 a person is filed at the contact step, before any question, so
 * the submissions themselves say how an intake is doing:
 *   captured    — people who gave their details (every row);
 *   completed   — of those, who also sent their answers (`submitted_at`);
 *   unfinished  — captured but not completed: still leads, worth a follow-up;
 *   median time — from opening the page to sending, over completed ones.
 * Rows from before 0093 were only ever written on completion; they count as
 * captured and completed, which is what happened.
 */
export type StatRow = { form_id?: string; started_at: string; submitted_at: string | null; temperature?: string | null };

export type SubmissionStats = {
  captured: number;
  completed: number;
  unfinished: number;
  /** "54.5%", or "—". */
  completionRate: string;
  /** Milliseconds, or null when nothing completed. */
  medianMs: number | null;
  /** Assessments: how many finished people were hot, warm, cold. */
  temperatures: { hot: number; warm: number; cold: number };
};

export function submissionStats(rows: readonly StatRow[]): SubmissionStats {
  const durations: number[] = [];
  const temperatures = { hot: 0, warm: 0, cold: 0 };
  let completed = 0;
  for (const r of rows) {
    if (!r.submitted_at) continue;
    completed++;
    if (r.temperature === "hot" || r.temperature === "warm" || r.temperature === "cold") temperatures[r.temperature]++;
    const ms = Date.parse(r.submitted_at) - Date.parse(r.started_at);
    if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
  }
  durations.sort((a, b) => a - b);
  const mid = durations.length >> 1;
  const medianMs = durations.length === 0 ? null : durations.length % 2 ? durations[mid] : Math.round((durations[mid - 1] + durations[mid]) / 2);
  return {
    captured: rows.length,
    completed,
    unfinished: rows.length - completed,
    completionRate: percent(completed, rows.length),
    medianMs,
    temperatures,
  };
}

/** Stats for each intake, keyed by form id (intakes with no rows are absent). */
export function statsByForm(rows: readonly StatRow[]): Map<string, SubmissionStats> {
  const groups = new Map<string, StatRow[]>();
  for (const r of rows) {
    if (!r.form_id) continue;
    const g = groups.get(r.form_id);
    if (g) g.push(r);
    else groups.set(r.form_id, [r]);
  }
  return new Map([...groups].map(([id, g]) => [id, submissionStats(g)]));
}

/** "45 sec", "3 min", "1 hr 12 min", or "—". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}
