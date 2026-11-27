/**
 * My Mail: the client mail the sync matched from the mailboxes this person can
 * see (their own, plus the firm's shared ones). Built from crm_activity rows
 * the sync wrote (source "mailbox-sync"), so it holds exactly what the
 * timelines hold: sender, recipients, subject, date and a link back to the
 * mail client. No bodies, no previews, and never a message that matched no
 * client (those were never stored). Pure, so the shaping is tested.
 */

import { civilDay, formatDay, formatTime } from "@/lib/ui/dates";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";

export type MailActivity = {
  id: string;
  type: string;
  created_at: string;
  lead_id: string | null;
  matter_id: string | null;
  payload: unknown;
};

export type ClientRef = { label: string; href: string };

export type MailRow = {
  id: string;
  direction: "in" | "out";
  from: string;
  to: string[];
  subject: string;
  at: string;
  link: string | null;
  connectionId: string | null;
  client: ClientRef | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function toMailRows(
  rows: readonly MailActivity[],
  names: { leads: ReadonlyMap<string, string>; matters: ReadonlyMap<string, string> },
): MailRow[] {
  return rows
    .map((r): MailRow => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const client: ClientRef | null =
        r.matter_id && names.matters.has(r.matter_id)
          ? { label: names.matters.get(r.matter_id)!, href: `/dashboard/matters/${r.matter_id}/` }
          : r.lead_id && names.leads.has(r.lead_id)
            ? { label: names.leads.get(r.lead_id)!, href: `/dashboard/leads/${r.lead_id}/` }
            : null;
      return {
        id: r.id,
        direction: r.type === "email_sent" ? "out" : "in",
        from: str(p.from) ?? "Unknown sender",
        to: Array.isArray(p.to) ? (p.to as unknown[]).map(str).filter((x): x is string => !!x) : [],
        subject: str(p.subject) ?? "(no subject)",
        at: str(p.at) ?? r.created_at,
        // Only ever a link into the provider's own web client.
        link: safeMailLink(str(p.web_link)),
        connectionId: str(p.connection_id),
        client,
      };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** A web_link is rendered as an href, so only https links to the two mail clients pass. */
export function safeMailLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    if (u.protocol !== "https:") return null;
    return /(^|\.)(mail\.google\.com|outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com)$/.test(u.hostname) ? link : null;
  } catch {
    return null;
  }
}

export type MailGroup = { key: string; label: string; rows: MailRow[] };

/** Whole days since the epoch of a civil "YYYY-MM-DD" day. */
function dayNumber(civil: string): number {
  const [y, m, d] = civil.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Today / Yesterday / Earlier this week / Earlier, as in the design. Civil days in the FIRM's zone. */
export function groupMailByDay(rows: readonly MailRow[], now: Date = new Date(), tz: string = DEFAULT_TIME_ZONE): MailGroup[] {
  const today = dayNumber(civilDay(now, tz) ?? "1970-01-01");
  const groups: MailGroup[] = [
    { key: "today", label: "Today", rows: [] },
    { key: "yesterday", label: "Yesterday", rows: [] },
    { key: "week", label: "Earlier this week", rows: [] },
    { key: "earlier", label: "Earlier", rows: [] },
  ];
  for (const r of rows) {
    const civil = civilDay(r.at, tz);
    const age = civil ? today - dayNumber(civil) : Number.POSITIVE_INFINITY;
    const i = age <= 0 ? 0 : age === 1 ? 1 : age <= 6 ? 2 : 3;
    groups[i].rows.push(r);
  }
  return groups.filter((g) => g.rows.length > 0);
}

/** The time label on a row: a clock time today, else a date ("Nov 16"), in the firm's zone. */
export function mailTime(iso: string, now: Date = new Date(), tz: string = DEFAULT_TIME_ZONE): string {
  if (Number.isNaN(Date.parse(iso))) return "";
  if (civilDay(iso, tz) === civilDay(now, tz)) return formatTime(iso, { tz }) ?? "";
  return formatDay(iso, { tz, now }) ?? "";
}
