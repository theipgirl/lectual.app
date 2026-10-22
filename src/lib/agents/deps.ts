import "server-only";
import { getAdminClient } from "@/lib/db/admin";
import { callClaude } from "@/lib/ai/claude";
import { createDraft, listQueue } from "@/lib/queue/api";
import { providerCredentials, rootKeyOrNull } from "@/lib/mailbox/config";
import { getSiteOrigin } from "@/lib/site-origin";
import { DB_FETCH_TIMEOUT_MS } from "@/lib/http/timeout";
import type { RunnerDeps } from "./runner";

/** Production wiring for the agent runner. Tests build their own RunnerDeps. */
export function productionRunnerDeps(): RunnerDeps {
  // Every statement an agent sends has a deadline (see src/lib/http/timeout.ts).
  const admin = getAdminClient({ timeoutMs: DB_FETCH_TIMEOUT_MS });
  const root = rootKeyOrNull();
  return {
    admin,
    llm: callClaude,
    createDraft,
    listPending: (orgKey) => listQueue(orgKey, "pending"),
    // The cron request's own host, else SITE_URL; null when neither is usable.
    siteOrigin: async () => {
      try {
        return await getSiteOrigin();
      } catch {
        return null;
      }
    },
    mailbox: root ? { admin, root, credentials: providerCredentials } : undefined,
  };
}
