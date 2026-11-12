import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getSiteOrigin } from "@/lib/site-origin";
import { unauthorizedResponse } from "@/lib/mcp/discovery";
import { runWithMcpClient } from "@/lib/mcp/request-client";
import { createLectualMcpServer } from "@/lib/mcp/server";
import { verifyBearer } from "@/lib/mcp/token-client";

/**
 * Lectual as a Claude connector: https://<origin>/api/mcp/ (the trailing-slash form; next.config.ts
 * redirects /api/mcp to it). Stateless Streamable HTTP, a fresh transport and server per request,
 * the same shape as lawmatics-mcp.
 *
 * No token, or one Supabase rejects or that carries no firm: 401 with the resource-metadata pointer
 * (RFC 9728), so Claude starts the OAuth flow. With a verified token, the request runs inside
 * runWithMcpClient, so every src/lib helper's getScopedClient() acts as that person under RLS.
 * No service role anywhere on this path.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  const caller = await verifyBearer(req.headers.get("authorization"));
  if (!caller) return unauthorizedResponse(await getSiteOrigin());

  return runWithMcpClient(caller.client, async () => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // Answer each POST with the JSON result once the tool has finished, so the call completes
      // inside this request's context (and its seam) rather than in a stream that outlives it.
      enableJsonResponse: true,
    });
    const server = createLectualMcpServer(caller.orgId);
    await server.connect(transport);
    return transport.handleRequest(req);
  });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
