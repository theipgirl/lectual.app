/**
 * OAuth protected-resource metadata (RFC 9728) for the Claude connector, and the 401 that points to
 * it. Pure: the site origin and the Supabase URL are passed in.
 *
 * Every URL is the form WITHOUT a trailing slash, which is what Claude's "Add custom connector" dialog
 * keeps (it strips a typed slash) and what RFC 9728 expects the `resource` to equal. `/api/mcp` answers
 * directly (next.config.ts skips Next's slash redirect and proxy.ts redirects every other path), the
 * slash form `/api/mcp/` answers the same, and paths under `/.well-known/` are exempt from the slash
 * redirect in both directions.
 */
export const MCP_PATH = "/api/mcp";
export const METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function mcpResourceUrl(origin: string): string {
  return `${trimSlash(origin)}${MCP_PATH}`;
}

export function metadataUrl(origin: string): string {
  return `${trimSlash(origin)}${METADATA_PATH}`;
}

/** Supabase Auth's OAuth 2.1 server is the authorization server: `<project url>/auth/v1`. */
export function authorizationServer(supabaseUrl: string): string {
  return `${trimSlash(supabaseUrl)}/auth/v1`;
}

export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
};

export function protectedResourceMetadata(origin: string, supabaseUrl: string): ProtectedResourceMetadata {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [authorizationServer(supabaseUrl)],
    bearer_methods_supported: ["header"],
  };
}

/** The `WWW-Authenticate` value on a 401 from `/api/mcp/`. */
export function wwwAuthenticate(origin: string): string {
  return `Bearer resource_metadata="${metadataUrl(origin)}"`;
}

/** The discovery document as a response: public, no cookies, readable cross-origin. */
export function metadataResponse(origin: string, supabaseUrl: string): Response {
  return Response.json(protectedResourceMetadata(origin, supabaseUrl), {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** The 401 for a missing or bad token. The body says nothing about why. */
export function unauthorizedResponse(origin: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": wwwAuthenticate(origin),
      "Cache-Control": "no-store",
    },
  });
}
