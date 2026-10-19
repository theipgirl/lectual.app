import "server-only";
import { aiConfigured } from "@/lib/ai/claude";
import { env } from "@/lib/env";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { getProposalSettings } from "@/lib/proposals/store";
import { draftBlock, settingsReadiness, type DraftBlock, type QueueConnection } from "./draft-availability";

/**
 * Reads the three facts behind `draftBlock` for the active firm. Never throws
 * and never exposes a value: only booleans derived from env are consulted.
 */
export async function loadDraftBlock(): Promise<DraftBlock | null> {
  const [queue, settings] = await Promise.all([queueConnection(), settingsState()]);
  return draftBlock({ aiConfigured: aiConfigured(), queue, settings });
}

async function queueConnection(): Promise<QueueConnection> {
  try {
    if (!(await activeQueueOrgKey())) return "no-org-key";
    return env.QUEUE_API_URL && env.DASHBOARD_API_TOKEN ? "connected" : "no-env";
  } catch {
    return "unknown";
  }
}

async function settingsState() {
  try {
    return settingsReadiness({ status: "ok", row: await getProposalSettings() });
  } catch {
    return settingsReadiness({ status: "unavailable" });
  }
}
