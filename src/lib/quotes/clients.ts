import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { contactDisplayName, leadDisplayName } from "@/lib/matters/client-name";
import { leadPickerLabel } from "./client-labels";

/**
 * Who a quote is FOR, for the quote list and builder — and the options the
 * "New quote" picker offers. New in lectual.app (the source list showed titles
 * only and the builder resolved one link at a time).
 *
 * Every read goes through the caller's scoped client, so RLS decides what can
 * be named: a lead the caller cannot read simply yields no label. All reads are
 * best-effort — a name is not worth failing a page over — and a failure
 * returns empty, which the pages render as "—", never as a guess.
 */

export type QuoteClientRef = {
  /** What to call the client on screen. */
  label: string;
  /** Where the name links, or null (a bare contact has no page of its own). */
  href: string | null;
  kind: "lead" | "matter" | "contact";
};

/** Same precedence as `matterLabel` (docket-summary), which wants a whole
 * docket row; the mark is what a firm calls a trademark matter. */
function matterName(m: { mark_text: string | null; title: string | null; matter_number: string }): string {
  return m.mark_text?.trim() || m.title?.trim() || m.matter_number;
}

type QuoteLinks = { id: string; lead_id: string | null; matter_id: string | null; contact_id: string | null };

/**
 * One label per quote, in three `.in()` reads over the page's own ids — never
 * one read per quote. Precedence: contact, then lead, then matter, the same
 * order `resolveMatterClientName` uses (a contact is the party; a matter title
 * is a description of the work, not a name).
 */
export async function quoteClientLabels(quotes: readonly QuoteLinks[]): Promise<Map<string, QuoteClientRef>> {
  const out = new Map<string, QuoteClientRef>();
  if (quotes.length === 0) return out;
  const unique = (ids: (string | null)[]) => [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const leadIds = unique(quotes.map((q) => q.lead_id));
  const matterIds = unique(quotes.map((q) => q.matter_id));
  const contactIds = unique(quotes.map((q) => q.contact_id));

  try {
    const supabase = await getScopedClient();
    const [leads, matters, contacts] = await Promise.all([
      leadIds.length
        ? supabase.from("crm_lead").select("id, business_name, first_name, last_name").in("id", leadIds)
        : Promise.resolve({ data: [] as { id: string; business_name: string | null; first_name: string; last_name: string }[] }),
      matterIds.length
        ? supabase.from("crm_matter").select("id, mark_text, title, matter_number").in("id", matterIds)
        : Promise.resolve({ data: [] as { id: string; mark_text: string | null; title: string | null; matter_number: string }[] }),
      contactIds.length
        ? supabase.from("crm_contact").select("id, business_name, first_name, last_name").in("id", contactIds)
        : Promise.resolve({ data: [] as { id: string; business_name: string | null; first_name: string | null; last_name: string | null }[] }),
    ]);
    const leadName = new Map((leads.data ?? []).map((l) => [l.id, leadDisplayName(l)]));
    const matterNames = new Map((matters.data ?? []).map((m) => [m.id, matterName(m)]));
    const contactName = new Map((contacts.data ?? []).map((c) => [c.id, contactDisplayName(c)]));

    for (const q of quotes) {
      const contact = q.contact_id ? contactName.get(q.contact_id) : null;
      const lead = q.lead_id ? leadName.get(q.lead_id) : null;
      const matter = q.matter_id ? matterNames.get(q.matter_id) : null;
      if (contact) out.set(q.id, { label: contact, href: q.matter_id ? `/dashboard/matters/${q.matter_id}/` : null, kind: "contact" });
      else if (lead) out.set(q.id, { label: lead, href: `/dashboard/leads/${q.lead_id}/`, kind: "lead" });
      else if (matter) out.set(q.id, { label: matter, href: `/dashboard/matters/${q.matter_id}/`, kind: "matter" });
    }
  } catch (err) {
    console.error("[quotes] client names unreachable:", err);
  }
  return out;
}

export type QuoteClientOption = { value: string; label: string };
export type QuoteClientOptions = { leads: QuoteClientOption[]; matters: QuoteClientOption[]; contacts: QuoteClientOption[] };

/**
 * The "New quote" picker's choices: open leads, open matters, and contacts.
 * Values are `lead:<id>` / `matter:<id>` / `contact:<id>` so one select can
 * carry all three; the create action splits them and the composite FK on
 * `crm_quote` refuses any id that is not in the caller's org.
 */
export async function quoteClientOptions(): Promise<QuoteClientOptions> {
  const empty: QuoteClientOptions = { leads: [], matters: [], contacts: [] };
  try {
    const supabase = await getScopedClient();
    const [leads, matters, contacts] = await Promise.all([
      supabase
        .from("crm_lead")
        .select("id, business_name, first_name, last_name, email")
        .order("updated_at", { ascending: false })
        .limit(300),
      supabase
        .from("crm_matter")
        .select("id, mark_text, title, matter_number, status")
        .neq("status", "closed")
        .order("updated_at", { ascending: false })
        .limit(300),
      supabase
        .from("crm_contact")
        .select("id, business_name, first_name, last_name")
        .order("updated_at", { ascending: false })
        .limit(300),
    ]);
    return {
      leads: (leads.data ?? []).map((l) => ({
        value: `lead:${l.id}`,
        label: leadPickerLabel(l),
      })),
      matters: (matters.data ?? []).map((m) => ({
        value: `matter:${m.id}`,
        label: `${matterName(m)} · ${m.matter_number}`,
      })),
      contacts: (contacts.data ?? []).map((c) => ({
        value: `contact:${c.id}`,
        label: contactDisplayName(c) ?? "Unnamed contact",
      })),
    };
  } catch (err) {
    console.error("[quotes] client picker unreachable:", err);
    return empty;
  }
}

/**
 * The matter a quote is linked to (`crm_quote.matter_id`) — its number and
 * page, for the builder's "matter opened" line. Scoped read, best-effort: a
 * failure is null and the builder simply does not mention the matter.
 */
export async function quoteMatterRef(matterId: string | null): Promise<{ href: string; number: string } | null> {
  if (!matterId) return null;
  try {
    const supabase = await getScopedClient();
    const { data } = await supabase.from("crm_matter").select("id, matter_number").eq("id", matterId).maybeSingle();
    return data ? { href: `/dashboard/matters/${data.id}/`, number: data.matter_number } : null;
  } catch {
    return null;
  }
}
