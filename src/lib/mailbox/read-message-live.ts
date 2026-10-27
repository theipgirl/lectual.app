import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { searchableMailboxAccess } from "./my-mailbox";
import { fetchLiveInbox, fetchMessageToRead } from "./fetch";
import { MAILBOX_ACTIVITY_SOURCE } from "./apply";
import type { ClientRef } from "./my-mail";
import type { MailReadDeps } from "./read-message";
import { matterDisplayTitle } from "@/lib/matters/display-title";

/**
 * The real reads behind the My Mail reading pane and live Inbox tab. Scoped client for every row; the sealed
 * mailbox token is reached only through my-mailbox.ts's helper, after the scoped read has shown the person
 * the connection. No write of any kind.
 */
export const liveMailReadDeps: MailReadDeps = {
  async readActivity(id) {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_activity")
      .select("id, type, payload")
      .eq("id", id)
      .eq("payload->>source", MAILBOX_ACTIVITY_SOURCE)
      .maybeSingle();
    if (error) return { ok: false };
    return { ok: true, row: data ? { id: data.id, type: data.type, payload: data.payload } : null };
  },

  mailboxes: searchableMailboxAccess,

  fetchMessage: (provider, args) => fetchMessageToRead(provider, args),
  fetchInbox: (provider, args) => fetchLiveInbox(provider, args),

  async tagsFor(messageIds) {
    const out = new Map<string, ClientRef>();
    if (messageIds.length === 0) return out;
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_activity")
      .select("lead_id, matter_id, payload")
      .in("type", ["email_received", "email_sent"])
      .eq("payload->>source", MAILBOX_ACTIVITY_SOURCE)
      .in("payload->>message_id", [...messageIds])
      .limit(200);
    if (error) throw error;
    const rows = data ?? [];
    const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((x): x is string => !!x))];
    const matterIds = [...new Set(rows.map((r) => r.matter_id).filter((x): x is string => !!x))];
    const [leads, matters] = await Promise.all([
      leadIds.length ? supabase.from("crm_lead").select("id, first_name, last_name, business_name, email").in("id", leadIds) : Promise.resolve({ data: [] as never[] }),
      matterIds.length ? supabase.from("crm_matter").select("id, mark_text, title, matter_number, owner_name").in("id", matterIds) : Promise.resolve({ data: [] as never[] }),
    ]);
    const leadName = new Map((leads.data ?? []).map((l) => [l.id, l.business_name || `${l.first_name} ${l.last_name}`.trim() || l.email] as [string, string]));
    const matterName = new Map((matters.data ?? []).map((m) => [m.id, matterDisplayTitle(m).title] as [string, string]));
    for (const r of rows) {
      const id = (r.payload as { message_id?: unknown } | null)?.message_id;
      if (typeof id !== "string") continue;
      if (r.matter_id && matterName.has(r.matter_id)) out.set(id, { label: matterName.get(r.matter_id)!, href: `/dashboard/matters/${r.matter_id}/` });
      else if (r.lead_id && leadName.has(r.lead_id)) out.set(id, { label: leadName.get(r.lead_id)!, href: `/dashboard/leads/${r.lead_id}/` });
    }
    return out;
  },
};
