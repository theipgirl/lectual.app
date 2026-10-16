import "server-only";
import { getAdminClient } from "@/lib/db/admin";
import { callClaude } from "@/lib/ai/claude";
import { createDraft } from "@/lib/queue/api";
import { providerCredentials, rootKeyOrNull } from "@/lib/mailbox/config";
import type { RunnerDeps } from "./runner";

/** Production wiring for the agent runner. Tests build their own RunnerDeps. */
export function productionRunnerDeps(): RunnerDeps {
  const admin = getAdminClient();
  const root = rootKeyOrNull();
  return {
    admin,
    llm: callClaude,
    createDraft,
    mailbox: root ? { admin, root, credentials: providerCredentials } : undefined,
  };
}
