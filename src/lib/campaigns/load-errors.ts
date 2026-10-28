export type CampaignLoadKind = "list" | "steps" | "enrollments" | "templates";

/** What a Campaigns page says when a read fails. Fixed sentences: the cause is logged, never drawn. */
export const CAMPAIGN_LOAD_ERRORS: Record<CampaignLoadKind, string> = {
  list: "Couldn't load campaigns. Refresh to try again.",
  steps: "Couldn't load this campaign's steps. Refresh to try again.",
  enrollments: "Couldn't load who's enrolled. Refresh to try again.",
  templates: "Couldn't load templates. Refresh to try again.",
};

/**
 * The text for a failed Campaigns read. The thrown value can carry database text, so only its kind
 * of error reaches the server log and the page shows the fixed sentence for that read.
 */
export function campaignLoadError(kind: CampaignLoadKind, err: unknown): string {
  console.error(`[campaigns] ${kind} read failed:`, err instanceof Error ? err.name : typeof err);
  return CAMPAIGN_LOAD_ERRORS[kind];
}
