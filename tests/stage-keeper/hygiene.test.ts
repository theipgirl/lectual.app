import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 16 hygiene: the Stage Keeper files hold the line the sprint was judged on. The forbidden
 * patterns are built from pieces so that a grep over this sprint's files for those same patterns
 * stays clean.
 */

const SERVICE_ROLE_CALL = ["get", "AdminClient", "\\("].join("");
const ADMIN_IMPORT = ["@/lib/db/", "admin"].join("");
const SERVICE_KEY = ["SUPABASE_", "SERVICE", "_ROLE"].join("");
const RAW_HTML = ["dangerously", "SetInnerHTML"].join("");
const EM_DASH = String.fromCharCode(0x2014);
const MODEL_CALL = new RegExp([["call", "Claude"].join(""), ["llm", "\\("].join(""), ["ctx\\.", "llm"].join("")].join("|"));
const QUEUE_CALL = ["create", "Draft"].join("");
const ROUTING = ["la", "ne"].join("");

const ls = (dir: string, ext: RegExp) => fs.readdirSync(dir).filter((f) => ext.test(f)).map((f) => path.join(dir, f));
const read = (f: string) => fs.readFileSync(f, "utf8");

const agentFiles = ls("src/lib/agents/stage-keeper", /\.ts$/);
const libFiles = ls("src/lib/stage-keeper", /\.ts$/);
const uiFiles = [
  "src/components/leads/StageKeeperControls.tsx",
  "src/app/dashboard/intake/_components/AgentMoveChip.tsx",
  "src/app/dashboard/leads/[id]/stage-keeper-actions.ts",
];
const sprintFiles = [...agentFiles, ...libFiles, ...uiFiles, "src/lib/pipeline/move-as.ts", "src/lib/pipeline/evidence-date.ts"];

describe("Sprint 16 hygiene", () => {
  it("finds the files it is meant to check", () => {
    expect(agentFiles.length).toBeGreaterThanOrEqual(4);
    expect(libFiles.length).toBeGreaterThanOrEqual(6);
  });

  it("no service-role use of its own: no admin client, no admin import, no service key (the client arrives in the context)", () => {
    for (const f of [...sprintFiles, "src/app/api/cron/mailbox-sync/route.ts"]) {
      const src = read(f);
      const calls = src.match(new RegExp(SERVICE_ROLE_CALL, "g")) ?? [];
      expect(calls.length, f).toBe(f.endsWith("mailbox-sync/route.ts") ? 1 : 0); // the route's one pre-existing call
      if (!f.endsWith("route.ts")) expect(src, f).not.toContain(ADMIN_IMPORT);
      expect(src, f).not.toContain(SERVICE_KEY);
    }
  });

  it("the readers and the components use the scoped client only", () => {
    for (const f of ["src/lib/stage-keeper/read.ts", "src/lib/stage-keeper/readiness-read.ts", ...uiFiles]) {
      expect(read(f), f).not.toContain(ADMIN_IMPORT);
    }
    expect(read("src/lib/stage-keeper/read.ts")).toContain("getScopedClient");
  });

  it("no raw HTML injection and no console output in any file of the sprint", () => {
    for (const f of sprintFiles) {
      const src = read(f);
      expect(src, f).not.toContain(RAW_HTML);
      expect(src, f).not.toMatch(/\bconsole\./);
    }
  });

  it("the agent calls no model, queues no draft, sends nothing and writes no routing column", () => {
    for (const f of [...agentFiles, "src/lib/pipeline/move-as.ts", "src/lib/stage-keeper/held-consult.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(MODEL_CALL);
      expect(src, f).not.toContain(QUEUE_CALL);
      expect(src, f).not.toMatch(/sendMail|sendEmail|\/send\b|\.send\(/);
      expect(src, f).not.toMatch(new RegExp(`\\b${ROUTING}\\b|${ROUTING}_set`));
      expect(src, f).not.toMatch(/\bTODO\b|\bFIXME\b/);
    }
  });

  it("the only place a stage name is written is the one default-name table", () => {
    const names = ["LOE & Invoice Sent", "Consultation Scheduled", "Questionnaire Sent", "Post Consultation Email Sent", "Signed LOE"];
    for (const f of [...agentFiles, "src/lib/pipeline/move-as.ts", ...libFiles]) {
      if (f.endsWith("mapping.ts")) continue;
      for (const n of names) expect(read(f), `${f} names ${n}`).not.toContain(n);
    }
    expect(read("src/lib/agents/stage-keeper/mapping.ts")).toContain("DEFAULT_STAGE_NAMES");
  });

  it("no hard-coded org id", () => {
    for (const f of sprintFiles) expect(read(f), f).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("no em dash in the copy this sprint wrote", () => {
    for (const f of sprintFiles) expect(read(f), f).not.toContain(EM_DASH);
  });

  it("the agent's name on a move is defined once, and only moveLeadStageAs writes a move with it", () => {
    const mentions = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && read(f).includes("agent:stage-keeper"));
    expect(mentions.map((f) => f.split(path.sep).join("/"))).toEqual(["src/lib/stage-keeper/moves.ts"]);
    const writers = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /\bAGENT_ACTOR\b/.test(read(f)) && /actor:\s*AGENT_ACTOR/.test(read(f)));
    expect(writers.map((f) => f.split(path.sep).join("/"))).toEqual(["src/lib/pipeline/move-as.ts"]);
  });

  it("the global stylesheet, the dashboard layout, the home page and the rail are untouched by this sprint's code", () => {
    expect(read("src/app/globals.css")).not.toMatch(/stage-keeper|agent-chip/);
    for (const f of ["src/app/dashboard/layout.tsx", "src/app/dashboard/page.tsx", "src/lib/nav.ts"]) expect(read(f), f).not.toMatch(/stage-keeper|Stage Keeper/i);
  });

  it("vercel.json names no Stage Keeper route and the migrations folder does not exist here", () => {
    expect(read("vercel.json")).not.toMatch(/stage/i);
    expect(fs.existsSync("supabase")).toBe(false);
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
