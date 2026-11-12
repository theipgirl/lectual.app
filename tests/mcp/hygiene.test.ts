import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES } from "@/lib/settings/modules-copy";

/**
 * Grep fences for the Claude connector. They repeat the lint fence (eslint.config.mjs) so a rule
 * switched off by mistake still fails here.
 */
const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

const CONNECTOR_FILES = [
  ...walk("src/app/api/mcp"),
  ...walk("src/lib/mcp"),
  ...walk("src/app/api/oauth"),
  ...walk("src/app/oauth"),
  ...walk("src/app/.well-known"),
];
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("Claude connector hygiene", () => {
  it("finds the connector files", () => {
    expect(CONNECTOR_FILES).toContain(path.join("src/app/api/mcp/route.ts"));
    expect(CONNECTOR_FILES).toContain(path.join("src/lib/mcp/request-client.ts"));
    expect(CONNECTOR_FILES.some((f) => f.startsWith("src/app/.well-known/"))).toBe(true);
  });

  it("never touches the service role", () => {
    for (const f of CONNECTOR_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/db\/admin|getAdminClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("imports no send, approve or mail path", () => {
    for (const f of CONNECTOR_FILES) {
      const imports = read(f).match(/from\s+["'][^"']+["']/g) ?? [];
      for (const i of imports) {
        expect(i, f).not.toMatch(/outlook-send|internal-mail|review-core|queue\/api|queue\/actions|\/mail\/|resend/i);
      }
    }
  });

  it("runWithMcpClient is imported only by the connector route", () => {
    const importers = walk("src").filter((f) => /import[^;]*\brunWithMcpClient\b/.test(read(f)));
    expect(importers).toEqual([path.join("src/app/api/mcp/route.ts")]);
  });

  it("getScopedClient reads the seam through currentMcpClient only", () => {
    const src = read("src/lib/db/scoped-client.ts");
    expect(src).toMatch(/import \{ currentMcpClient \} from "@\/lib\/mcp\/request-client";/);
    expect(src).not.toMatch(/runWithMcpClient/);
  });

  it("the lint config fences the setter and lets only the route use it", () => {
    const cfg = read("eslint.config.mjs");
    expect(cfg).toContain('importNames: ["runWithMcpClient"]');
    expect(cfg).toContain('files: ["src/app/api/mcp/**"]');
  });

  it("createClient appears only in the anon-key token client among connector files", () => {
    const users = CONNECTOR_FILES.filter((f) => /\bcreateClient\b/.test(read(f)));
    expect(users).toEqual([path.join("src/lib/mcp/token-client.ts")]);
    expect(read("src/lib/mcp/token-client.ts")).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("`claude-connector` is a rollout switch, not in Settings -> Features", () => {
    expect(MODULES.map((m) => m.key)).not.toContain("claude-connector");
    expect(read("src/lib/org/modules.ts")).toMatch(/\| "claude-connector"/);
  });

  it("the consent page is never indexed", () => {
    expect(read("src/app/oauth/consent/page.tsx")).toMatch(/robots: \{ index: false, follow: false \}/);
  });
});
