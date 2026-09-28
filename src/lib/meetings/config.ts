import "server-only";
import { env } from "@/lib/env";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import type { ZoomClientCredentials } from "./zoom";

/**
 * Deployment configuration for Meetings. Every accessor returns null / a
 * reason rather than throwing, so the pages can say "not set up yet".
 *
 * Deliberately NO deployment-wide Fathom or Zoom credential: each firm
 * connects its own account (lectual 0077).
 */

export function zoomClientCredentials(): ZoomClientCredentials | null {
  const clientId = (env.ZOOM_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.ZOOM_OAUTH_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function zoomRedirectUri(origin: string): string {
  const override = (env.ZOOM_OAUTH_REDIRECT_URI ?? "").trim();
  // Trailing slash: next.config sets trailingSlash, and Zoom compares exactly.
  return override || `${origin}/api/meetings/zoom/callback/`;
}

export type ZoomSetup = { ready: true; creds: ZoomClientCredentials; root: Buffer } | { ready: false; missing: "oauth-app" | "encryption-key" };

export function zoomSetup(): ZoomSetup {
  const creds = zoomClientCredentials();
  if (!creds) return { ready: false, missing: "oauth-app" };
  const root = rootKeyOrNull();
  if (!root) return { ready: false, missing: "encryption-key" };
  return { ready: true, creds, root };
}

/** Fathom needs only the encryption key to seal what a firm pastes. */
export function fathomReady(): boolean {
  return rootKeyOrNull() !== null;
}
