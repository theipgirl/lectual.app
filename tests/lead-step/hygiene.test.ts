import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 9 Part 1 (the lead step engine): no service role, no send, no write of its own. The only writes are the
 * existing approval core's (`runQueueReview`), which makes a DRAFT at most.
 */
const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "src/lib/lead-step");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"));
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Walks the runtime import graph from a file (type-only imports are erased, so they are skipped) and returns every
 * path that reaches `server-only` or a `node:` built-in. The pure files must reach neither.
 */
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
      if (spec === "server-only" || spec.startsWith("node:")) {
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

const PURE = ["closer-look.ts", "decide.ts", "did.ts", "facts.ts", "gaps.ts", "next-actions.ts", "schedule.ts", "view-model.ts", "actions-core.ts"];

describe("the lead step engine", () => {
  it("its pure files reach neither server-only nor a node: built-in, through any import", () => {
    for (const f of PURE) expect(forbiddenPaths(f), f).toEqual([]);
  });

  it("the walk does find server-only where it is (load.ts), so it isn't passing by accident", () => {
    expect(forbiddenPaths("load.ts").length).toBeGreaterThan(0);
  });

  it("has the files it is meant to have", () => {
    expect(files.sort()).toEqual(["actions-core.ts", "actions.ts", "closer-look.ts", "decide.ts", "did.ts", "facts.ts", "gaps.ts", "load.ts", "next-actions.ts", "schedule.ts", "view-model.ts"]);
  });

  it("never uses the service role", () => {
    for (const f of files) {
      expect(code(f), f).not.toMatch(/@\/lib\/db\/admin|getAdminClient|SERVICE_ROLE/);
    }
  });

  it("never sends: no send call, endpoint or scope (the repo-wide send pattern)", () => {
    const SEND = new RegExp(["send", "Mail"].join("") + "|" + ["Mail", "\\.", "Send"].join("") + "|" + ["/", "send", "\\b"].join("") + "|" + ["\\.", "send", "\\("].join(""), "i");
    for (const f of files) expect(read(f), f).not.toMatch(SEND);
    for (const f of files) expect(code(f), f).not.toMatch(/sendFromMyOutlook|outlook-send/);
  });

  it("writes nothing itself: no insert, update, upsert or delete, and no mailbox draft of its own", () => {
    for (const f of files) {
      expect(code(f), f).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(code(f), f).not.toMatch(/draftInMyMailbox|createMailboxDraft|mailbox\/drafts|saveQueueEdit|resolveQueueItem|createDraft\(/);
    }
  });

  it("every Yes / Edit / Not this goes through the existing approve core, unchanged", () => {
    const wiring = code("actions.ts");
    expect(wiring).toMatch(/review: runQueueReview/);
    expect(wiring).toMatch(/^"use server";/m);
    const core = code("actions-core.ts");
    expect(core.match(/deps\.review\(/g)?.length).toBe(3);
    expect(core).toMatch(/intent: "approve", withReceipt: true \}/);
    expect(core).not.toMatch(/confirmStale/);
    expect(core).toMatch(/intent: "reject", note: reason/);
    expect(core).toMatch(/intent: "save", body/);
  });

  it("dashboard reads go through the scoped client, and nothing logs record text or shows raw error text", () => {
    expect(code("load.ts")).toMatch(/getScopedClient/);
    for (const f of files) {
      expect(code(f), f).not.toMatch(/console\./);
      expect(code(f), f).not.toMatch(/\.message\b|String\(err/);
      expect(code(f), f).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("is used by the lead page and its cards only (Part 2), nowhere else", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const users = [...walk(path.join(ROOT, "src/app")), ...walk(path.join(ROOT, "src/components"))].filter((f) => /@\/lib\/lead-step\//.test(fs.readFileSync(f, "utf8")));
    expect(users.map((f) => path.relative(ROOT, f)).sort()).toEqual([
      "src/app/dashboard/leads/[id]/page.tsx",
      "src/components/leads/FourFacts.tsx",
      "src/components/leads/NeedsYourYes.tsx",
      "src/components/leads/TopCard.tsx",
      "src/components/leads/WhatLectualDid.tsx",
    ]);
  });
});
