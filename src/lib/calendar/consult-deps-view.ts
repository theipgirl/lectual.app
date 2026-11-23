import "server-only";
import { listConnections } from "@/lib/mailbox/connections";
import { hasCalendarScope } from "@/lib/mailbox/providers";
import { liveConsultDeps } from "./consult-sources-live";
import type { ConsultDeps } from "./consult-sources";

/**
 * The deps for this request: the live ones, or, during an owner's View as preview, the same reads limited to the firm's
 * SHARED Outlook connections (never the owner's personal one) and no Zoom read (spec "Today Consults").
 */
export async function consultDepsForViewer(previewing: { name: string } | null): Promise<ConsultDeps> {
  if (!previewing) return liveConsultDeps;
  return {
    ...liveConsultDeps,
    preview: { name: previewing.name },
    async outlookConnections() {
      const res = await listConnections();
      if (!res.ok) return { ok: false };
      const active = res.connections.filter((c) => c.scope === "firm" && c.provider === "microsoft" && c.status === "active");
      return { ok: true, active: active.length, withCalendar: active.filter((c) => hasCalendarScope(c.provider, c.scopes)).length };
    },
    async zoomAccess() {
      return { state: "unreadable" };
    },
  };
}
