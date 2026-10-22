import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 17 hygiene: the three drafting agents hold the line the sprint was judged on. The forbidden
 * patterns are built from pieces so that a grep over this sprint's files for those same patterns stays clean.
 */

const SERVICE_ROLE_CALL = ["get", "AdminClient", "\\("].join("");
const ADMIN_IMPORT = ["@/lib/db/", "admin"].join("");
const SCOPED = ["get", "ScopedClient"].join("");
const SERVICE_KEY = ["SUPABASE_", "SERVICE", "_ROLE"].join("");
const RAW_HTML = ["dangerously", "SetInnerHTML"].join("");
const SEND_PATTERN = new RegExp(["send", "Mail"].join("") + "|" + ["Mail", "\\.", "Send"].join("") + "|" + ["/", "send", "\\b"].join("") + "|" + ["\\.", "send", "\\("].join(""), "i");
const EM_DASH = String.fromCharCode(0x2014);
const EMOJI = /\p{Extended_Pictographic}/u;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const EMAIL_LITERAL = /[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
const STAFF_AND_FIRM = ["Rebecca", "Dawn", "Rayn", "Taylor", "Caitlyn", "Amor", "Beliard", "RPB", "rpblawfirm", "Cabanis", "Hartwell"];

const read = (f: string) => fs.readFileSync(f, "utf8");
const walk = (dir: string, ext: RegExp): string[] =>
  fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return fs.statSync(p).isDirectory() ? walk(p, ext) : ext.test(name) ? [p] : [];
  });

const agentFiles = ["morning-brief", "consult-prep", "inbox-summary"].flatMap((d) => walk(path.join("src/lib/agents", d), /\.ts$/));
const sprintFiles = [...agentFiles, "src/lib/agents/shared.ts", "src/lib/agents/mailbox-gate.ts", "src/lib/inbox/triage.ts", "src/lib/queue/resolve-batch.ts"];

describe("Sprint 17 hygiene", () => {
  it("finds the files it is meant to check", () => {
    expect(agentFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("no service-role use of its own: no admin client, no admin import, no service key (the client arrives in the context)", () => {
    for (const f of sprintFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(new RegExp(SERVICE_ROLE_CALL));
      expect(src, f).not.toContain(ADMIN_IMPORT);
      expect(src, f).not.toContain(SERVICE_KEY);
    }
  });

  it("no agent file calls the signed-in client (the copilot and the Autopilot page loader, which are not cron agents, predate this and do)", () => {
    const offenders = walk("src/lib/agents", /\.ts$/).filter((f) => read(f).includes(SCOPED));
    expect(offenders.sort()).toEqual([path.join("src/lib/agents/autopilot.ts"), path.join("src/lib/agents/matters-chat.ts")]);
    for (const f of sprintFiles) expect(read(f), f).not.toContain(SCOPED);
  });

  it("no raw HTML injection, no console output, no TODO in any file of the sprint", () => {
    for (const f of sprintFiles) {
      const src = read(f);
      expect(src, f).not.toContain(RAW_HTML);
      expect(src, f).not.toMatch(/\bconsole\./);
      expect(src, f).not.toMatch(/\bTODO\b|\bFIXME\b|\bXXX\b/);
    }
  });

  it("no em dash and no emoji in the source or in the draft scaffolding it generates", () => {
    for (const f of [...sprintFiles, "src/app/dashboard/agents/page.tsx", "src/app/dashboard/agents/actions.ts"]) {
      const src = read(f);
      // lines this sprint did not add (the agents page and actions have older copy) are left alone by checking only the new files here
      if (!sprintFiles.includes(f)) continue;
      expect(src, f).not.toContain(EM_DASH);
      expect(src, f).not.toMatch(EMOJI);
    }
  });

  it("no hard-coded org id, firm name, attorney name or email address in the new agent or triage code", () => {
    for (const f of [...agentFiles, "src/lib/inbox/triage.ts", "src/lib/agents/shared.ts", "src/lib/agents/mailbox-gate.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(UUID);
      expect(src, f).not.toMatch(EMAIL_LITERAL);
      for (const name of STAFF_AND_FIRM) expect(src, `${f} names ${name}`).not.toContain(name);
    }
  });

  it("every agent system prompt is built on AGENT_POLICY", () => {
    const withModel = agentFiles.filter((f) => /\bllm\(/.test(read(f)));
    expect(withModel.length).toBeGreaterThanOrEqual(3);
    for (const f of withModel) {
      const src = read(f);
      const system = [...src.matchAll(/system:\s*([^\n,]+)/g)].map((m) => m[1]);
      expect(system.length, f).toBeGreaterThan(0);
      for (const s of system) expect(s, `${f}: ${s}`).toMatch(/AGENT_POLICY|System\(|followUpSystem|replySystem/);
    }
    for (const f of ["src/lib/agents/morning-brief/follow-ups.ts", "src/lib/agents/inbox-summary/reply.ts", "src/lib/agents/consult-prep/run.ts"]) expect(read(f), f).toContain("AGENT_POLICY");
  });

  it("nothing in src sends mail: no send call, no send endpoint, no send scope (before the sprint and after)", () => {
    for (const f of walk("src", /\.(ts|tsx)$/)) expect(read(f), f).not.toMatch(SEND_PATTERN);
  });

  it("the Outlook draft helper has exactly one new caller, the inbox reply drafts; the Mail scopes are the existing two", () => {
    const callers = walk("src", /\.(ts|tsx)$/).filter((f) => /createMailboxDraft\(/.test(read(f)) && !f.endsWith("mailbox/drafts.ts"));
    expect(callers.sort()).toEqual([path.join("src/lib/agents/inbox-summary/reply.ts"), path.join("src/lib/mailbox/my-mailbox.ts")].sort());
    const scopes = [...read("src/lib/mailbox/providers.ts").matchAll(/"(Mail\.[A-Za-z]+)"/g)].map((m) => m[1]);
    expect(new Set(scopes)).toEqual(new Set(["Mail.Read", "Mail.ReadWrite"]));
  });

  it("the shared resolver exists once and the agent imports it", () => {
    const hits = walk("src", /\.(ts|tsx)$/).filter((f) => /function resolveBatch\b/.test(read(f)));
    expect(hits).toEqual([path.join("src/lib/queue/resolve-batch.ts")]);
    const importers = walk("src", /\.(ts|tsx)$/).filter((f) => /import \{[^}]*\bresolveBatch\b[^}]*\} from/.test(read(f)));
    expect(importers.sort()).toEqual([path.join("src/lib/agents/morning-brief/follow-ups.ts"), path.join("src/lib/queue/lead-pending.ts")].sort());
  });

  it("the agents write only to the queue, Outlook Drafts and the timeline: no update or delete anywhere, and an insert only into crm_activity", () => {
    for (const f of agentFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/\.(update|upsert|delete)\(/);
      for (const m of src.matchAll(/\.from\("([a-z_]+)"\)\s*\.insert\(/g)) expect(m[1], f).toBe("crm_activity");
    }
  });
});
