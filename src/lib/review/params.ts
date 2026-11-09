import type { ReviewKind, ReviewRow } from "./buckets";
import { isUuid } from "./input";
import { openToken, parseOpenParam, type OpenRef } from "./open";

/** The page's URL state: who (Mine | Everyone), which kind (Matters | Leads | Both) and a search term. Pure. */
export type ReviewWho = "all" | "mine";
export type ReviewScope = "both" | ReviewKind;

export type ReviewView = "agenda" | "board" | "meeting" | "stage" | "cards";
export const REVIEW_VIEWS: readonly ReviewView[] = ["agenda", "board", "meeting", "stage", "cards"];
/** The view with no `view` param: the Monday agenda. */
export const DEFAULT_REVIEW_VIEW: ReviewView = "agenda";

export type ReviewParams = { who: ReviewWho; kind: ReviewScope; q: string; view: ReviewView; i: number; /** The Cards view's person (a user id), or null for the default. */ person: string | null; /** The record whose detail panel is open. */ open: OpenRef | null };

export const SEARCH_MAX = 80;

export function parseReviewParams(raw: { who?: string | string[]; kind?: string | string[]; q?: string | string[]; view?: string | string[]; i?: string | string[]; person?: string | string[]; open?: string | string[] }): ReviewParams {
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
  return { who, kind, q, view, i, person: isUuid(p) ? p.toLowerCase() : null, open: parseOpenParam(raw.open) };
}

export function reviewHref(p: ReviewParams): string {
  const qs = new URLSearchParams();
  if (p.who === "mine") qs.set("who", "mine");
  if (p.kind !== "both") qs.set("kind", p.kind === "matter" ? "matters" : "leads");
  if (p.q) qs.set("q", p.q);
  if (p.view !== DEFAULT_REVIEW_VIEW) qs.set("view", p.view);
  if (p.view === "cards" && p.person) qs.set("person", p.person);
  if ((p.view === "meeting" || p.view === "cards") && p.i > 1) qs.set("i", String(p.i));
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

export function applyReviewFilters(rows: readonly ReviewRow[], p: ReviewParams, userId: string | null): ReviewRow[] {
  return rows.filter(
    (r) => (p.kind === "both" || r.kind === p.kind) && (p.who === "all" || isMine(r, userId)) && matchesSearch(r, p.q),
  );
}
