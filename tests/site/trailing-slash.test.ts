import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { needsTrailingSlash, SLASH_EXEMPT_PATHS, trailingSlashTarget } from "@/lib/site/trailing-slash";

describe("needsTrailingSlash: today's redirect, except /api/mcp", () => {
  it("redirects an address with no final slash (pages, API routes, public pages)", () => {
    for (const p of ["/dashboard", "/dashboard/leads", "/sign-in", "/i/ugw-2026", "/api/cron/agents", "/api/matters-chat", "/p/abc123", "/auth/confirm", "/oauth/consent", "/api/oauth/decision"]) {
      expect(needsTrailingSlash(p), p).toBe(true);
    }
  });

  it("leaves an address that already ends in a slash", () => {
    for (const p of ["/", "/dashboard/", "/api/mcp/", "/api/oauth/decision/"]) expect(needsTrailingSlash(p), p).toBe(false);
  });

  it("lets /api/mcp answer directly (Claude will not follow a redirect), and nothing else under it", () => {
    expect(SLASH_EXEMPT_PATHS).toEqual(["/api/mcp"]);
    expect(needsTrailingSlash("/api/mcp")).toBe(false);
    expect(needsTrailingSlash("/api/mcp/extra")).toBe(true);
    expect(needsTrailingSlash("/api/mcpx")).toBe(true);
  });

  it("leaves .well-known, Next's own paths and files with an extension alone", () => {
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp", "/_next/static/chunks/a.js", "/_next/image", "/_next/data/abc/x.json", "/favicon.ico", "/brand/rpb-logo-dark.png", "/robots.txt"]) {
      expect(needsTrailingSlash(p), p).toBe(false);
    }
  });

  it("a dot in a folder name is not a file", () => {
    expect(needsTrailingSlash("/v1.2/leads")).toBe(true);
  });
});

describe("trailingSlashTarget: the redirect goes to a DIFFERENT address, never to itself", () => {
  it("adds the slash to the path and keeps the query and hash", () => {
    expect(trailingSlashTarget("https://app.lectual.app/sign-in")).toBe("https://app.lectual.app/sign-in/");
    expect(trailingSlashTarget("https://app.lectual.app/sign-in?next=%2Fdash%2F&x=1")).toBe("https://app.lectual.app/sign-in/?next=%2Fdash%2F&x=1");
    expect(trailingSlashTarget("https://app.lectual.app/i/ugw-2026?utm_source=ig")).toBe("https://app.lectual.app/i/ugw-2026/?utm_source=ig");
  });

  it("never returns the address it was given, and answers null once the slash is there", () => {
    for (const u of ["https://x.test/a", "https://x.test/a/b?q=1", "https://x.test/oauth/consent?authorization_id=abcdefgh12345678"]) {
      const t = trailingSlashTarget(u);
      expect(t).not.toBeNull();
      expect(t).not.toBe(u);
      expect(trailingSlashTarget(t as string)).toBeNull();
    }
  });

  it("is null for /api/mcp, .well-known, files, a bad URL", () => {
    for (const u of ["https://x.test/api/mcp", "https://x.test/api/mcp/", "https://x.test/.well-known/oauth-protected-resource/api/mcp", "https://x.test/logo.png", "https://x.test/", "not a url"]) {
      expect(trailingSlashTarget(u), u).toBeNull();
    }
  });
});

describe("the wiring", () => {
  it("next.config.ts skips Next's own redirect and still sets trailingSlash", () => {
    const cfg = readFileSync("next.config.ts", "utf8");
    expect(cfg).toMatch(/trailingSlash:\s*true/);
    expect(cfg).toMatch(/skipTrailingSlashRedirect:\s*true/);
  });

  it("proxy.ts redirects with a 308 through trailingSlashTarget (a plain URL, not NextURL.clone)", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain("trailingSlashTarget(request.url)");
    expect(proxy).toMatch(/NextResponse\.redirect\(slashTarget, 308\)/);
    expect(proxy).not.toMatch(/nextUrl\.clone\(\)/);
  });
});
