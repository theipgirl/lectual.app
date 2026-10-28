import "server-only";
import { orgHasModule } from "@/lib/org/modules";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listConnections } from "@/lib/mailbox/connections";
import { hasCalendarScope } from "@/lib/mailbox/providers";
import { ownZoomAccess } from "@/lib/meetings/connection";
import { listUpcomingZoomMeetings } from "@/lib/meetings/zoom";
import { loadConsultsForToday } from "./outlook-read";
import { joinKey, zoomMeetingKey, type ConsultDeps, type LeadRef } from "./consult-sources";

/**
 * The real reads behind Today's Consults card. Scoped client throughout; the only sealed-token read is
 * `ownZoomAccess` (the meetings module's own helper). A Zoom meeting is linked to a lead only when an
 * imported `crm_meeting` with a lead matches its meeting id or join link exactly.
 */
export const liveConsultDeps: ConsultDeps = {
  hasMailboxModule: () => orgHasModule("mailbox"),

  async outlookConnections() {
    const res = await listConnections();
    if (!res.ok) return { ok: false };
    const active = res.connections.filter((c) => c.provider === "microsoft" && c.status === "active");
    return { ok: true, active: active.length, withCalendar: active.filter((c) => hasCalendarScope(c.provider, c.scopes)).length };
  },

  outlook: (now, timeZone) => loadConsultsForToday(now, timeZone),

  async zoomAccess() {
    const access = await ownZoomAccess();
    return access.state === "ok" ? { state: "ok", accessToken: access.accessToken } : { state: access.state };
  },

  zoomUpcoming: (accessToken) => listUpcomingZoomMeetings({ accessToken }),

  async zoomLeads(meetings) {
    const out = new Map<string, LeadRef>();
    if (meetings.length === 0) return out;
    const supabase = await getScopedClient();
    const ids = meetings.map((m) => m.id);
    const { data, error } = await supabase
      .from("crm_meeting")
      .select("external_id, share_url, lead_id")
      .eq("provider", "zoom")
      .not("lead_id", "is", null)
      .in("external_id", ids);
    if (error) throw error;
    const byShare = await supabase
      .from("crm_meeting")
      .select("external_id, share_url, lead_id")
      .eq("provider", "zoom")
      .not("lead_id", "is", null)
      .in("share_url", meetings.map((m) => m.joinUrl).filter((u): u is string => !!u));
    if (byShare.error) throw byShare.error;
    const rows = [...(data ?? []), ...(byShare.data ?? [])];
    const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (leadIds.length > 0) {
      const { data: leads } = await supabase.from("crm_lead").select("id, first_name, last_name, business_name, email").in("id", leadIds);
      for (const l of leads ?? []) {
        const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.business_name || l.email;
        if (name) names.set(l.id, name);
      }
    }
    for (const m of meetings) {
      const key = joinKey(m.joinUrl);
      const row = rows.find((r) => r.external_id === m.id || (key !== null && joinKey(r.share_url) === key));
      if (row?.lead_id) out.set(zoomMeetingKey(m), { leadId: row.lead_id, leadName: names.get(row.lead_id) ?? null });
    }
    return out;
  },
};
