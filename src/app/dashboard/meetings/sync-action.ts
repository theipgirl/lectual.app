"use server";

import { resolveFirmSession } from "@/lib/firm/session";
import { listMeetingConnections } from "@/lib/meetings/connection";
import { canSyncMeetings } from "@/lib/meetings/sync-access";
import { mergeSyncResults, type SourceSync, type SyncSummary } from "@/lib/meetings/sync-result";
import { MEETING_PROVIDERS } from "@/lib/meetings/types";
import { importNowAction } from "@/app/dashboard/settings/integrations/meetings/actions";

/**
 * "Sync new meetings" on the Meetings and Proposals pages. It owns no import logic: for each source the firm has
 * connected it calls the same `importNowAction` Settings -> Integrations -> Meetings uses (which re-checks the role,
 * the connection and the integrations switch itself), and merges the outcomes into one result line.
 */

export type SyncMeetingsState = { summary?: SyncSummary };

export async function syncNewMeetingsAction(): Promise<SyncMeetingsState> {
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !canSyncMeetings(session.role)) return { summary: mergeSyncResults([{ provider: "fathom", outcome: { kind: "refused" } }]) };

  const conns = await listMeetingConnections();
  // An unreadable connection list is a failure of every source, never "No new meetings".
  if (!conns.ok) return { summary: mergeSyncResults(MEETING_PROVIDERS.map((provider) => ({ provider, outcome: { kind: "failed" } }))) };

  const results: SourceSync[] = [];
  for (const provider of MEETING_PROVIDERS) {
    if (!conns.connections.some((c) => c.provider === provider)) {
      results.push({ provider, outcome: { kind: "not-connected" } });
      continue;
    }
    const form = new FormData();
    form.set("provider", provider);
    const state = await importNowAction({}, form);
    results.push({ provider, outcome: state.sync ?? { kind: "failed" } });
  }
  return { summary: mergeSyncResults(results) };
}
