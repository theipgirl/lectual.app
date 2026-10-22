import type { SupabaseClient } from "@supabase/supabase-js";
import type { StopDb, StopDbQuery } from "@/lib/campaigns/stop-db";
import { classifyEmail, isPlaceholderEmail } from "@/lib/intake/email-match";
import { resolveTimeZone } from "@/lib/org/profile-rules";
import { JudgmentBoundaryError } from "@/lib/prep-consult/prep-consult";

/**
 * Small helpers the drafting agents (morning-brief, consult-prep, inbox-summary) share.
 * Pure apart from the two reads, which take the context's client and fence on `orgId`.
 */

export const DAY_MS = 86_400_000;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Values per `.in(...)`: the filter rides in the GET URL. */
export const IN_CHUNK = 100;

/** "1 mailbox", "3 mailboxes". */
export const mailboxCount = (n: number): string => `${n} mailbox${n === 1 ? "" : "es"}`;

export const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * A read-only adapter over the service-role client whose every `select` already carries
 * `.eq("org_id", orgId)`, so a shared resolver written for a signed-in client (whose rows RLS
 * scopes) issues only statements that name the firm. Only `select` exists, so the adapter cannot
 * be used to write.
 */
export function orgFencedReader(admin: SupabaseClient, orgId: string): StopDb {
  return {
    from: (table: string) => ({ select: (columns: string) => admin.from(table).select(columns).eq("org_id", orgId) }) as unknown as StopDbQuery,
  };
}

// ── text handed to a model ───────────────────────────────────────────────────

/** Text written by other people goes to the model inside tags, with any tag-like `<` or `>` made inert. */
export function neutralise(value: string): string {
  return value.replace(/</g, "‹").replace(/>/g, "›");
}

/** One line, bounded, tag characters neutralised. */
export function oneLine(value: string | null | undefined, max: number): string {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return neutralise(flat.length > max ? `${flat.slice(0, max - 1)}…` : flat);
}

// ── people and addresses ─────────────────────────────────────────────────────

export type NamedLead = { first_name?: string | null; last_name?: string | null; business_name?: string | null; email?: string | null };

/** "Dana Ruiz", else the business name, else a plain fallback. */
export function leadLabel(lead: NamedLead | undefined | null, fallback = "A lead"): string {
  if (!lead) return fallback;
  const person = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  return person || lead.business_name?.trim() || fallback;
}

/** A real, deliverable-looking address: not a placeholder, not the reserved `.invalid`, and with an `@`. */
export function realAddress(email: string | null | undefined): string | null {
  const value = email?.trim();
  if (!value || !value.includes("@") || isPlaceholderEmail(value)) return null;
  return value;
}

/** A subject or title that reads like a dispute (the six sensitive phrases). */
export function isSensitiveText(...parts: Array<string | null | undefined>): boolean {
  return classifyEmail(parts.filter(Boolean).join(" "), "").sensitive;
}

// ── dates in the firm's zone ─────────────────────────────────────────────────

/** YYYY-MM-DD of `at` on the firm's clock. */
export function civilDay(at: Date | number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** "Thu Oct 22, 2:00 PM" in the firm's zone. */
export function whenInZone(iso: string | number | Date, tz: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "a time that could not be read";
  const part = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(at);
  return `${part({ weekday: "short" })} ${part({ month: "short" })} ${part({ day: "numeric" })}, ${part({ hour: "numeric", minute: "2-digit" })}`;
}

/** "Thu Oct 22" in the firm's zone. */
export function dayInZone(iso: string | number | Date, tz: string): string {
  const at = new Date(iso);
  const part = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(at);
  return `${part({ weekday: "short" })} ${part({ month: "short" })} ${part({ day: "numeric" })}`;
}

/** A civil date (YYYY-MM-DD) plus `days`, as a civil date. Calendar arithmetic only, no zone involved. */
export function addCivilDays(civil: string, days: number): string {
  const [y, m, d] = civil.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "Oct 22" for a civil date. */
export function civilLabel(civil: string): string {
  const [y, m, d] = civil.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ── the firm profile ─────────────────────────────────────────────────────────

export type FirmStyle = { timeZone: string; signOff: string | null };

/**
 * The firm's time zone and email sign-off. A failed read gives the defaults: a label in the default
 * zone is a lesser failure than no brief, and nothing here decides anything.
 */
export async function readFirmStyle(admin: SupabaseClient, orgId: string): Promise<FirmStyle> {
  try {
    const { data, error } = await admin.from("crm_org_profile").select("time_zone, email_signature").eq("org_id", orgId).maybeSingle();
    if (error || !data) return { timeZone: resolveTimeZone(null), signOff: null };
    return {
      timeZone: resolveTimeZone(data.time_zone as string | null),
      signOff: (data.email_signature as string | null | undefined)?.trim() || null,
    };
  } catch {
    return { timeZone: resolveTimeZone(null), signOff: null };
  }
}

/** The system-prompt line for the firm's own sign-off, as the post-consult drafter words it. */
export function signOffRule(signOff: string | null): string {
  return signOff
    ? `End the email with exactly this sign-off, unchanged:\n<sign_off>\n${signOff}\n</sign_off>`
    : `Sign off with "[Attorney name]" as a placeholder; the attorney edits and sends it.`;
}

/** A model or provider failure as a short category word. Never the message: it can carry names or addresses. */
export function failureCategory(err: unknown): string {
  if (err instanceof JudgmentBoundaryError) return "it contained attorney-judgment content";
  const code = (err as { code?: string } | null)?.code;
  if (code === "reauth") return "reconnect the mailbox";
  const message = err instanceof Error ? err.message : "";
  if (/declined|cut off|expected shape|ANTHROPIC|AI key/i.test(message)) return "the model did not return a usable draft";
  return "an error";
}

/**
 * True when the run's time budget has less than `reserveMs` left, or the run has already been stopped
 * (its signal aborted: the runner gave up waiting, so nothing more should be written). An agent working
 * through a list stops starting new items once this is true. No budget (`timeLeftMs` absent) is never spent.
 */
export function budgetNearlySpent(ctx: { timeLeftMs?: () => number; signal?: AbortSignal }, reserveMs: number): boolean {
  if (ctx.signal?.aborted) return true;
  return ctx.timeLeftMs !== undefined && ctx.timeLeftMs() < reserveMs;
}

/**
 * The model answered but the answer can't be used: refused, cut off at max_tokens, or not the
 * schema's shape (`AiOutputError` from claude.ts, matched by name so this file stays free of the SDK,
 * or the SDK's own "Failed to parse structured output"). A list-working agent skips that ONE item
 * and carries on; a transport failure, a missing key or a database error is not this.
 */
export function isUnusableModelAnswer(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AiOutputError") return true;
  return /Failed to parse structured output|cut off before it finished|didn't match the expected shape|declined this request/i.test(err.message);
}
