import { describe, expect, it } from "vitest";
import {
  MCP_PATH,
  METADATA_PATH,
  metadataResponse,
  protectedResourceMetadata,
  unauthorizedResponse,
  wwwAuthenticate,
} from "@/lib/mcp/discovery";

const ORIGIN = "https://app.lectual.app";
const SUPABASE = "https://abcdefgh.supabase.co";

describe("Claude connector discovery (RFC 9728)", () => {
  it("names the trailing-slash resource and Supabase's auth server", () => {
    expect(protectedResourceMetadata(ORIGIN, SUPABASE)).toEqual({
      resource: "https://app.lectual.app/api/mcp/",
      authorization_servers: ["https://abcdefgh.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
    });
  });

  it("never doubles a slash when the origin or Supabase URL ends with one", () => {
    const m = protectedResourceMetadata(`${ORIGIN}/`, `${SUPABASE}/`);
    expect(m.resource).toBe("https://app.lectual.app/api/mcp/");
    expect(m.authorization_servers[0]).toBe("https://abcdefgh.supabase.co/auth/v1");
  });

  it("uses trailing-slash paths only", () => {
    expect(MCP_PATH).toBe("/api/mcp/");
    expect(METADATA_PATH).toBe("/.well-known/oauth-protected-resource/api/mcp/");
  });

  it("the 401 points at the absolute metadata URL", async () => {
    expect(wwwAuthenticate(ORIGIN)).toBe('Bearer resource_metadata="https://app.lectual.app/.well-known/oauth-protected-resource/api/mcp/"');
    const res = unauthorizedResponse(ORIGIN);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(wwwAuthenticate(ORIGIN));
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("the metadata response is JSON, readable cross-origin, never cached", async () => {
    const res = metadataResponse(ORIGIN, SUPABASE);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(protectedResourceMetadata(ORIGIN, SUPABASE));
  });
});
