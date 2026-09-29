/**
 * My Mail: the client mail the sync matched from the mailboxes this person can
 * see (their own, plus the firm's shared ones). Built from crm_activity rows
 * the sync wrote (source "mailbox-sync"), so it holds exactly what the
 * timelines hold: sender, recipients, subject, date and a link back to the
 * mail client. No bodies, no previews, and never a message that matched no
 * client (those were never stored). Pure, so the shaping is tested.
 */

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

/** Today / Yesterday / Earlier this week / Earlier, as in the design. Local civil days. */
export function groupMailByDay(rows: readonly MailRow[], now: Date = new Date()): MailGroup[] {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOf(now);
  const DAY = 86_400_000;
  const groups: MailGroup[] = [
    { key: "today", label: "Today", rows: [] },
    { key: "yesterday", label: "Yesterday", rows: [] },
    { key: "week", label: "Earlier this week", rows: [] },
    { key: "earlier", label: "Earlier", rows: [] },
  ];
  for (const r of rows) {
    const t = Date.parse(r.at);
    const i = t >= today ? 0 : t >= today - DAY ? 1 : t >= today - 6 * DAY ? 2 : 3;
    groups[i].rows.push(r);
  }
  return groups.filter((g) => g.rows.length > 0);
}

/** The time label on a row: a clock time today, a weekday this week, else a date. */
export function mailTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
