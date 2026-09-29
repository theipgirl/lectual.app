import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { readRows, type TableRead } from "@/lib/reports/db";
import type { NeedsYouConnection, NeedsYouPayment, NeedsYouSubmission } from "./needs-you";

/**
 * The reads "Needs you" adds on top of what Today already loads (queue,
 * deadlines, tasks, matters, leads, agent runs). All through the caller's
 * scoped client, so RLS decides what is visible: a personal mailbox that
 * needs reconnecting is only ever seen by its owner.
 *
 * Each returns null on a real read failure (the list then names the source as
 * unreadable). A table this environment doesn't have yet reads as "nothing
 * there", because nothing can be waiting in a table that doesn't exist.
 */

const ok = <T>(r: TableRead<T>): T[] | null => (r.status === "unavailable" ? null : r.rows);

export type QuoteRowForNeeds = {
  id: string;
  title: string;
  status: string;
  expires_at: string | null;
  accepted_at: string | null;
  lead_id: string | null;
  created_by: string | null;
};

export async function loadOpenQuotes(): Promise<{ quotes: QuoteRowForNeeds[] | null; payments: NeedsYouPayment[] | null }> {
  const supabase = await getScopedClient();
  const quotes = ok(
    await readRows<QuoteRowForNeeds>(() =>
      supabase.from("crm_quote").select("id, title, status, expires_at, accepted_at, lead_id, created_by").in("status", ["sent", "accepted"]).limit(300),
    ),
  );
  if (!quotes) return { quotes: null, payments: null };
  const acceptedIds = quotes.filter((q) => q.status === "accepted").map((q) => q.id);
  if (acceptedIds.length === 0) return { quotes, payments: [] };
  const payments = ok(
    await readRows<{ quote_id: string | null; purpose: string; status: string }>(() =>
      supabase.from("crm_payment").select("quote_id, purpose, status").in("quote_id", acceptedIds),
    ),
  );
  return { quotes, payments: payments?.map((p) => ({ quoteId: p.quote_id, purpose: p.purpose, status: p.status })) ?? null };
}

/** Connections waiting on someone to sign in again. Secret columns are never named. */
export async function loadConnectionsNeedingReauth(): Promise<NeedsYouConnection[] | null> {
  const supabase = await getScopedClient();
  const [mail, lawmatics, lawpay, meetings] = await Promise.all([
    readRows<{ id: string; email: string; scope: string; user_id: string | null }>(() =>
      supabase.from("mailbox_connection").select("id, email, scope, user_id").eq("status", "reauth"),
    ),
    readRows<{ id: string }>(() => supabase.from("lawmatics_connection").select("id").eq("status", "invalid")),
    readRows<{ id: string }>(() => supabase.from("lawpay_connection").select("id").eq("status", "reauth")),
    readRows<{ id: string; provider: string }>(() => supabase.from("meeting_source_connection").select("id, provider").eq("status", "reauth")),
  ]);
  if ([mail, lawmatics, lawpay, meetings].some((r) => r.status === "unavailable")) return null;

  const out: NeedsYouConnection[] = [];
  for (const m of mail.rows) {
    out.push({
      key: `mail-${m.id}`,
      service: "mailbox",
      label: m.scope === "personal" ? `Your mailbox ${m.email}` : `The firm mailbox ${m.email}`,
      ownerId: m.scope === "personal" ? m.user_id : null,
      href: "/dashboard/settings/mailboxes/",
    });
  }
  for (const l of lawmatics.rows) out.push({ key: `lm-${l.id}`, service: "lawmatics", label: "Lawmatics", ownerId: null, href: "/dashboard/settings/integrations/lawmatics/" });
  for (const l of lawpay.rows) out.push({ key: `lp-${l.id}`, service: "lawpay", label: "LawPay", ownerId: null, href: "/dashboard/settings/integrations/lawpay/" });
  for (const m of meetings.rows) {
    const service = m.provider === "zoom" ? "zoom" : "fathom";
    out.push({ key: `mt-${m.id}`, service, label: service === "zoom" ? "Zoom" : "Fathom", ownerId: null, href: "/dashboard/settings/integrations/meetings/" });
  }
  return out;
}

function contactName(contact: unknown): string {
  const c = (contact && typeof contact === "object" ? contact : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
  return s("business_name") || `${s("first_name")} ${s("last_name")}`.trim() || s("name") || s("email") || "A new submission";
}

/** Public intake submissions still marked `new` (0075). */
export async function loadUnreviewedSubmissions(): Promise<NeedsYouSubmission[] | null> {
  const supabase = await getScopedClient();
  const rows = ok(
    await readRows<{ id: string; contact: unknown; submitted_at: string }>(() =>
      supabase
        .from("crm_intake_submission")
        .select("id, contact, submitted_at")
        .eq("status", "new")
        .not("submitted_at", "is", null)
        .order("submitted_at", { ascending: false })
        .limit(50),
    ),
  );
  return rows?.map((r) => ({ id: r.id, name: contactName(r.contact), submittedAt: r.submitted_at })) ?? null;
}

/** Deadlines closed this month, for "Deadlines met". Through RLS. */
export async function loadDeadlinesClosedSince(sinceIso: string): Promise<{ due_date: string; satisfied_at: string | null; status: string }[] | null> {
  const supabase = await getScopedClient();
  return ok(
    await readRows<{ due_date: string; satisfied_at: string | null; status: string }>(() =>
      supabase.from("crm_matter_deadline").select("due_date, satisfied_at, status").eq("status", "satisfied").gte("satisfied_at", sinceIso),
    ),
  );
}
