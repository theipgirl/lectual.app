import type { ReviewKind, ReviewRow } from "./buckets";
import { isUuid } from "./input";
import { openToken, parseOpenParam, type OpenRef } from "./open";

/** The page's URL state: who (Mine | Everyone), which kind (Matters | Leads | Both) and a search term. Pure. */
export type ReviewWho = "all" | "mine";
export type ReviewScope = "both" | ReviewKind;

export type ReviewView = "board" | "sheet" | "cards";
export const REVIEW_VIEWS: readonly ReviewView[] = ["board", "sheet", "cards"];
/** The view with no `view` param: the Board. An old `?view=agenda|meeting|stage` is not a view any more and reads as the Board. */
export const DEFAULT_REVIEW_VIEW: ReviewView = "board";

/** The firm-wide "since" display filter: rows last touched before this date are hidden (never ones that need a person). `?since=all` shows everything. */
export const REVIEW_SINCE = "2026-02-01";
export type ReviewSince = "default" | "all";

export type ReviewParams = { /** `all` shows rows older than REVIEW_SINCE too. */ since: ReviewSince; who: ReviewWho; kind: ReviewScope; q: string; view: ReviewView; i: number; /** The Cards view's person (a user id), or null for the default. */ person: string | null; /** The record whose detail panel is open. */ open: OpenRef | null };

export const SEARCH_MAX = 80;

export function parseReviewParams(raw: { who?: string | string[]; kind?: string | string[]; q?: string | string[]; view?: string | string[]; since?: string | string[]; i?: string | string[]; person?: string | string[]; open?: string | string[] }): ReviewParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const who = one(raw.who) === "mine" ? "mine" : "all";
  const k = one(raw.kind);
  const kind: ReviewScope = k === "matters" ? "matter" : k === "leads" ? "lead" : "both";
  const q = (one(raw.q) ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
  const v = one(raw.view);
  const view: ReviewView = REVIEW_VIEWS.find((x) => x === v) ?? DEFAULT_REVIEW_VIEW;
  const n = Number.parseInt(one(raw.i) ?? "", 10);
  const i = Number.isFinite(n) && n >= 1 && n <= 100_000 ? n : 1;
  const p = (one(raw.person) ?? "").trim();
  const since: ReviewSince = one(raw.since) === "all" ? "all" : "default";
  return { since, who, kind, q, view, i, person: isUuid(p) ? p.toLowerCase() : null, open: parseOpenParam(raw.open) };
}

export function reviewHref(p: ReviewParams): string {
  const qs = new URLSearchParams();
  if (p.who === "mine") qs.set("who", "mine");
  if (p.kind !== "both") qs.set("kind", p.kind === "matter" ? "matters" : "leads");
  if (p.q) qs.set("q", p.q);
  if (p.since === "all") qs.set("since", "all");
  if (p.view !== DEFAULT_REVIEW_VIEW) qs.set("view", p.view);
  if (p.view === "cards" && p.person) qs.set("person", p.person);
  if (p.view === "cards" && p.i > 1) qs.set("i", String(p.i));
  if (p.open) qs.set("open", openToken(p.open));
  const s = qs.toString();
  return `/dashboard/review/${s ? `?${s}` : ""}`;
}

/** Mine = the next step is assigned to me, or the matter/lead is assigned to me. Without a known user it matches nothing. */
export function isMine(row: ReviewRow, userId: string | null): boolean {
  if (!userId) return false;
  return row.assignedTo === userId || row.nextStep?.assigneeId === userId;
}

export function matchesSearch(row: ReviewRow, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  return `${row.client} ${row.mark ?? ""}`.toLowerCase().includes(term);
}

/**
 * True when the "since" filter would hide this row. The date used is the row's LAST CONTACT (`lastContact.date`, the
 * newest email / call / note), the only "last touched" field a review row carries. A row with no contact at all is
 * treated as older (it has never been touched). NEVER hidden: an open next step, an open USPTO deadline or a
 * USPTO wait, a pending approval, a live (not expired) proposal, or contact history that could not be read.
 */
export function isOlderThanSince(row: ReviewRow): boolean {
  if (!row.contactKnown) return false;
  if (row.nextStep) return false;
  if (row.deadline || row.waiting === "uspto") return false;
  if (row.waiting === "approval") return false;
  if (row.proposalExpiry && !row.proposalExpiry.expired) return false;
  const last = row.lastContact?.date ?? null;
  return last === null || last < REVIEW_SINCE;
}

function passesOtherFilters(r: ReviewRow, p: ReviewParams, userId: string | null): boolean {
  return (p.kind === "both" || r.kind === p.kind) && (p.who === "all" || isMine(r, userId)) && matchesSearch(r, p.q);
}

export function applyReviewFilters(rows: readonly ReviewRow[], p: ReviewParams, userId: string | null): ReviewRow[] {
  return rows.filter((r) => passesOtherFilters(r, p, userId) && (p.since === "all" || !isOlderThanSince(r)));
}

/** How many rows the since filter hides right now (rows that pass the other filters), whatever `p.since` is. */
export function olderHiddenCount(rows: readonly ReviewRow[], p: ReviewParams, userId: string | null): number {
  return rows.filter((r) => passesOtherFilters(r, p, userId) && isOlderThanSince(r)).length;
}
