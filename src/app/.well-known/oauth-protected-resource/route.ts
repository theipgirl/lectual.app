import { protectedResourceGET } from "@/lib/mcp/discovery-route";

/**
 * OAuth protected-resource metadata (RFC 9728) for the Claude connector at /api/mcp/. Paths under
 * /.well-known/ are exempt from next.config.ts's trailing-slash redirect, so this answers as written.
 */
export const dynamic = "force-dynamic";

export const GET = protectedResourceGET;
