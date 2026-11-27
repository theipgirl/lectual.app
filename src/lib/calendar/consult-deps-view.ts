import "server-only";
import { listConnections } from "@/lib/mailbox/connections";
import { hasCalendarScope } from "@/lib/mailbox/providers";
import { liveConsultDeps } from "./consult-sources-live";
import type { ConsultDeps } from "./consult-sources";

/** What a preview means for these reads: no provider read at all, and (when a teammate is shown) shared connections only. */
export type ConsultPreview = { name: string | null; sharedOnly: boolean };

/**
 * The deps for this request: the live ones, or, while View as's flag is on OR couldn't be checked, no Zoom read (its token
 * refresh would rotate the firm's token) and, when a teammate is being shown, only the firm's SHARED Outlook connections
 * (never the owner's personal one) (spec "Today Consults", Layer d).
 */
export async function consultDepsForViewer(preview: ConsultPreview | null): Promise<ConsultDeps> {
  if (!preview) return liveConsultDeps;
  return {
    ...liveConsultDeps,
    preview: { name: preview.name },
    async outlookConnections() {
      const res = await listConnections();
      if (!res.ok) return { ok: false };
      const active = res.connections.filter((c) => (!preview.sharedOnly || c.scope === "firm") && c.provider === "microsoft" && c.status === "active");
      return { ok: true, active: active.length, withCalendar: active.filter((c) => hasCalendarScope(c.provider, c.scopes)).length };
    },
    async zoomAccess() {
      return { state: "unreadable" };
    },
  };
}
