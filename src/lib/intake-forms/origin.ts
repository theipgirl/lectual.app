import "server-only";
import { env } from "@/lib/env";
import { getSiteOrigin } from "@/lib/site-origin";

/**
 * The origin to put in a link a firm pastes into its own website. SITE_URL
 * (the canonical deployment) wins over the request: a link copied while
 * browsing a preview deployment must not point prospects at that preview.
 */
export async function intakeOrigin(): Promise<string> {
  const configured = env.SITE_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\//.test(configured)) return configured;
  return getSiteOrigin();
}
