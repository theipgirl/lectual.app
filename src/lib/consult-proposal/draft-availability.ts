/**
 * Why "Draft from a transcript" is unavailable on a lead, so the lead page can
 * say so instead of silently dropping the control.
 *
 * Pure on purpose: the server gathers three facts (see `./draft-gate.ts`), this
 * decides. Order is the order the run itself refuses in (queue, then model,
 * then settings), but the user-facing fix differs for each, so each gets its
 * own reason:
 *
 *   no-ai        the deployment has no ANTHROPIC_API_KEY
 *   no-queue     no approval queue for this firm (no crm_org.queue_org_key, or
 *                the deployment has no QUEUE_API_URL / DASHBOARD_API_TOKEN)
 *   no-settings  no proposal settings saved, or no named approver
 *
 * `unknown` means we could not read the fact. That is NOT a block: the action
 * re-checks everything and refuses with its own message, and hiding a working
 * control because of a transient read failure would be the original bug again.
 */

export type DraftBlock = "no-ai" | "no-queue" | "no-settings";

export type QueueConnection = "connected" | "no-org-key" | "no-env" | "unknown";
export type SettingsReadiness = "ready" | "missing" | "unknown";

/** Settings are ready only with a saved row that names at least one approver. */
export function settingsReadiness(
  read: { status: "ok"; row: { approver_user_ids: unknown } | null } | { status: "unavailable" },
): SettingsReadiness {
  if (read.status !== "ok") return "unknown";
  const approvers = read.row?.approver_user_ids;
  return Array.isArray(approvers) && approvers.length > 0 ? "ready" : "missing";
}

export function draftBlock(input: {
  aiConfigured: boolean;
  queue: QueueConnection;
  settings: SettingsReadiness;
}): DraftBlock | null {
  if (!input.aiConfigured) return "no-ai";
  if (input.queue === "no-org-key" || input.queue === "no-env") return "no-queue";
  if (input.settings === "missing") return "no-settings";
  return null;
}

/** The note shown in place of the disclosure. Never includes a secret value. */
export const DRAFT_BLOCK_NOTE: Record<DraftBlock, string> = {
  "no-ai":
    "Drafting from a transcript isn't switched on for your firm yet. Lectual will turn it on.",
  "no-queue": "Drafting from a transcript needs your firm's approvals set up, and they aren't connected yet. Lectual will connect them.",
  "no-settings": "Set up Settings → Client proposals (approvers and prices) first.",
};
