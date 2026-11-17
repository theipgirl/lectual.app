import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 10 Part 1 (the record card): no service role, no send, the pure files free of server-only, scoped client only,
 * fixed sentences only, nothing wired into a page yet.
 */
const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "src/lib/record-card");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"));
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The runtime import graph from a file (type-only imports skipped); every path that reaches server-only or a node: built-in. */
function forbiddenPaths(start: string): string[] {
  const seen = new Set<string>();
  const hits: string[] = [];
  const resolve = (from: string, spec: string): string | null => {
    let p: string;
    if (spec.startsWith("@/")) p = path.join(ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) p = path.resolve(path.dirname(from), spec);
    else return null;
    for (const c of [p, `${p}.ts`, `${p}.tsx`, path.join(p, "index.ts")]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    return null;
  };
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    const here = [...chain, path.relative(ROOT, file)];
    for (const m of src.matchAll(/^(?:import|export)\s+(type\s+)?[^"';]*?from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm)) {
      if (m[1]) continue;
      const spec = m[2] ?? m[3];
      if (spec === "server-only" || spec.startsWith("node:") || spec === "next/headers") {
        hits.push(`${here.join(" -> ")} -> ${spec}`);
        continue;
      }
      const next = resolve(file, spec);
      if (next) walk(next, here);
    }
  };
  walk(path.join(DIR, start), []);
  return hits;
}

const PURE = ["rules.ts", "model.ts", "open.ts"];

describe("the record card library", () => {
  it("has the files it is meant to have", () => {
    expect(files.sort()).toEqual(["actions.ts", "load.ts", "model.ts", "open.ts", "rules.ts"]);
  });

  it("its pure files reach neither server-only, next/headers nor a node: built-in, through any import", () => {
    for (const f of PURE) expect(forbiddenPaths(f), f).toEqual([]);
  });

  it("the walk does find server-only where it is (load.ts), so it isn't passing by accident", () => {
    expect(forbiddenPaths("load.ts").length).toBeGreaterThan(0);
    expect(read("load.ts")).toMatch(/^import "server-only";/);
    expect(read("actions.ts")).toMatch(/^"use server";/);
  });

  it("never uses the service role", () => {
    for (const f of files) expect(code(f), f).not.toMatch(/@\/lib\/db\/admin|getAdminClient|SERVICE_ROLE|service_role/);
  });

  it("never sends: no send call, endpoint or scope (the repo-wide send pattern)", () => {
    const SEND = new RegExp(["send", "Mail"].join("") + "|" + ["Mail", "\\.", "Send"].join("") + "|" + ["/", "send", "\\b"].join("") + "|" + ["\\.", "send", "\\("].join(""), "i");
    for (const f of files) expect(read(f), f).not.toMatch(SEND);
    for (const f of files) expect(code(f), f).not.toMatch(/sendFromMyOutlook|outlook-send|createMailboxDraft|resend/i);
  });

  it("writes only through the existing data layer: no insert, update, upsert or delete of its own", () => {
    // (URLSearchParams' own `params.delete` in open.ts is an address being built, not a write.)
    for (const f of files) expect(code(f), f).not.toMatch(/(?<!params)\.(insert|update|upsert|delete)\(/);
    // The two new actions call exactly the existing writes.
    const actions = code("actions.ts");
    expect(actions).toMatch(/await updateLead\(lead, values\)/);
    expect(actions).toMatch(/applyTag\(lead, tagId, \{ source: "human" \}\)/);
    expect(actions).toMatch(/removeTag\(lead, tagId\)/);
  });

  it("never writes, confirms or closes a deadline", () => {
    for (const f of files) expect(code(f), f).not.toMatch(/confirmDeadline|updateDeadline|closeDeadline|deleteDeadline|createDeadline|crm_matter_deadline/);
  });

  it("reads go through the scoped client; nothing logs or shows raw error text", () => {
    expect(code("load.ts")).toMatch(/getScopedClient/);
    expect(code("actions.ts")).toMatch(/getScopedClient/);
    for (const f of files) {
      expect(code(f), f).not.toMatch(/console\./);
      expect(code(f), f).not.toMatch(/\.message\b|String\(err/);
      expect(code(f), f).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("the top card reuses Sprint 9's engine rather than re-implementing it", () => {
    expect(code("model.ts")).toMatch(/import \{ buildLeadStepView[^}]*\} from "@\/lib\/lead-step\/view-model"/);
    expect(code("model.ts")).not.toMatch(/decideTopCard/);
    expect(code("open.ts")).toMatch(/from "@\/lib\/review\/open"/);
    expect(code("open.ts")).not.toMatch(/new RegExp|\/\^\(matter/);
  });

  it("is not wired to a page yet (Part 2 draws it)", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const users = [...walk(path.join(ROOT, "src/app")), ...walk(path.join(ROOT, "src/components"))].filter((f) => /@\/lib\/record-card\//.test(fs.readFileSync(f, "utf8")));
    expect(users).toEqual([]);
  });
});
