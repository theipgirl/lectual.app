import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

const ESIGN = [...walk("src/lib/esign"), ...walk("src/app/api/esign")];
const read = (p: string) => readFileSync(p, "utf8");
/** Code only: comments stripped, so a sentence explaining a rule is not mistaken for breaking it. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ADMIN_ALLOWED = new Set([
  "src/lib/esign/adobe-connection.ts",
  "src/lib/esign/start.ts",
  "src/lib/esign/path.ts",
  "src/lib/esign/complete.ts",
  "src/lib/esign/files.ts",
  "src/lib/esign/webhook.ts",
  "src/lib/esign/sweep.ts",
  "src/lib/esign/disconnect.ts",
  "src/lib/esign/return-check.ts",
  "src/app/api/esign/webhook/route.ts",
]);

describe("AT20: hygiene over src/lib/esign and src/app/api/esign", () => {
  it("AT20: the folders exist and hold the 5a files", () => {
    expect(ESIGN.length).toBeGreaterThan(10);
  });

  it("AT20: no mail import or send call", () => {
    for (const f of ESIGN) {
      const src = code(f);
      expect(src, f).not.toMatch(/@\/lib\/mail\//);
      expect(src, f).not.toMatch(/resend/i);
      expect(src, f).not.toMatch(/sendInternalMail|sendMail|Mail\.Send|\/sendMail/);
    }
  });

  it("AT20: no ALL email option, no /reminders, no x-api-user, no HOST / IN_PERSON_SIGNER, no :account / :group, no includeSignedDocuments", () => {
    for (const f of ESIGN) {
      const src = code(f);
      expect(src, f).not.toMatch(/["']ALL["']/);
      expect(src, f).not.toContain("/reminders");
      expect(src, f).not.toMatch(/x-api-user/i);
      expect(src, f).not.toMatch(/["'](HOST|IN_PERSON_SIGNER)["']/);
      expect(src, f).not.toMatch(/:account\b|:group\b/);
      expect(src, f).not.toContain("includeSignedDocuments");
    }
  });

  it("AT20: no code_challenge, no frameParent, no <iframe (and none on the client page)", () => {
    for (const f of [...ESIGN, ...walk("src/components/client-proposal"), ...walk("src/app/p")]) {
      const src = code(f);
      expect(src, f).not.toContain("code_challenge");
      expect(src, f).not.toContain("frameParent");
      expect(src, f).not.toMatch(/<iframe/i);
    }
  });

  it("AT20: no /api/adobe-sign/ path anywhere in src", () => {
    for (const f of walk("src")) expect(read(f), f).not.toContain("/api/adobe-sign/");
  });

  it("AT20: @/lib/db/admin only in the allow-listed e-sign files; never under src/app/dashboard", () => {
    for (const f of ESIGN) if (read(f).includes("@/lib/db/admin")) expect(ADMIN_ALLOWED.has(f), f).toBe(true);
    // Under src/app/dashboard: nothing new. The one file there at the base commit (49efd5e),
    // src/app/dashboard/settings/integrations/meetings/actions.ts (the Meetings import), is a PRE-EXISTING exception tracked
    // separately (AGENTS.md, Sprint 5a note); it is not e-sign code.
    const before = new Set(execFileSync("git", ["grep", "-l", "@/lib/db/admin", "49efd5e", "--", "src/app/dashboard"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.replace(/^49efd5e:/, "")));
    expect([...before]).toEqual(["src/app/dashboard/settings/integrations/meetings/actions.ts"]);
    for (const f of walk("src/app/dashboard")) if (!before.has(f)) expect(read(f), f).not.toContain("@/lib/db/admin");
    for (const f of walk("src/components")) expect(read(f), f).not.toContain("@/lib/db/admin");
  });

  it("AT20: no ADOBE_SIGN_*TOKEN* or API-key env name anywhere", () => {
    for (const f of [...walk("src"), ".env.example"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/ADOBE_SIGN_\w*TOKEN\w*/);
      expect(src, f).not.toMatch(/ADOBE_SIGN_\w*(API_?KEY|INTEGRATION_KEY)\w*/);
    }
  });

  it("no e-sign file logs (the signing URL, tokens and Adobe's text are never logged)", () => {
    for (const f of ESIGN) expect(code(f), f).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("sealed tokens use their own context, and no scoped select names an _enc column", () => {
    expect(read("src/lib/mailbox/crypto.ts")).toContain('"lectual-adobe-sign"');
    const conn = read("src/lib/esign/adobe-connection.ts");
    expect(conn).toContain('TOKEN_CONTEXT = "lectual-adobe-sign"');
    const columns = /CONNECTION_COLUMNS =\s*"([^"]+)"/.exec(conn)![1];
    expect(columns).not.toMatch(/_enc/);
    for (const f of [...walk("src/app/dashboard"), ...walk("src/components"), "src/lib/esign/settings-view.ts", "src/lib/esign/path.ts"]) {
      expect(read(f), f).not.toMatch(/\.select\([^)]*_token_enc/);
    }
  });
});

describe("AT25: lock order and the race", () => {
  it("AT25: start calls client_proposal_esign_open and never inserts into the request table", () => {
    const src = code("src/lib/esign/start-core.ts") + code("src/lib/esign/start.ts");
    expect(src).toContain('"client_proposal_esign_open"');
    expect(src).not.toMatch(/from\("client_proposal_esign_request"\)\s*\.insert/);
    for (const f of ESIGN) expect(code(f), f).not.toMatch(/client_proposal_esign_request"\)\s*\.insert/);
  });

  const SQL = read("docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt");
  const fn = (name: string) => {
    const at = SQL.indexOf(`create or replace function public.${name}(`);
    expect(at, name).toBeGreaterThan(-1);
    return SQL.slice(at, SQL.indexOf("\n$$;", at));
  };

  it("AT25: esign_open and the amended sign_and_accept lock the proposal FOR UPDATE; sign_and_accept checks open requests after it", () => {
    expect(fn("client_proposal_esign_open")).toMatch(/from public\.client_proposal p where p\.id = p_proposal_id for update/);
    const sa = fn("client_proposal_sign_and_accept");
    const lock = sa.indexOf("for update");
    const check = sa.indexOf("loe_sign_esign_open");
    expect(lock).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(lock);
  });

  it("AT25: adobe_complete locks the request first, then the proposal", () => {
    const c = fn("client_proposal_adobe_complete");
    const req = c.indexOf("from public.client_proposal_esign_request r where r.id = p_request_id for update");
    const prop = c.indexOf("from public.client_proposal p where p.id = v_req.proposal_id for update");
    expect(req).toBeGreaterThan(-1);
    expect(prop).toBeGreaterThan(req);
  });

  it("AT25: search_path = '' on every function", () => {
    const fns = SQL.match(/create or replace function[\s\S]*?\n\$\$;/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(5);
    for (const f of fns) expect(f, f.slice(0, 80)).toContain("set search_path = ''");
  });
});

describe("AT22 (5a part): the 0113 proposal file", () => {
  const SQL = read("docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt");

  it("AT22: exists, is marked not applied, and is the only 0113 file in docs/pge", () => {
    expect(SQL).toContain("PROPOSAL ONLY");
    expect(SQL).toContain("NOT APPLIED ANYWHERE");
    const all = walk("docs").concat(readdirSync("docs/pge/2026-11-17-agentic-ip-os").map((f) => join("docs/pge/2026-11-17-agentic-ip-os", f)));
    expect(all.filter((f) => /0113/.test(f) && !f.endsWith(".md"))).toEqual(["docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt"]);
    // Never a migration of this repo.
    expect(existsSync("supabase/migrations")).toBe(false);
  });

  it("AT22: holds every table, function, grant, FK and the fifteen isolation cases", () => {
    for (const needle of [
      "create table if not exists public.adobe_sign_connection",
      "create table if not exists public.client_proposal_esign_request",
      "add column if not exists provider",
      "add column if not exists adobe_agreement_id",
      "add column if not exists esign_request_id",
      "public.client_proposal_esign_open(",
      "public.client_proposal_adobe_complete(",
      "public.client_proposal_sign_and_accept(",
      "client_proposal_esign_request_one_open",
      "where status in ('creating', 'out_for_signature')",
      "references public.adobe_sign_connection(id) on delete set null",
      "references public.client_proposal_signature(id) on delete set null",
      "references public.crm_file(id) on delete set null",
      "references public.client_proposal_esign_request(id) on delete set null",
      "references auth.users(id) on delete set null",
      "references public.client_proposal (id, org_id) on delete cascade",
      "'adobe_unavailable', 'adobe_rate_limited', 'adobe_timeout', 'adobe_refused', 'creation_interrupted',",
      "'webhook_not_registered', 'esign_proposal_changed', 'signed_after_close'",
      "esign_request_closed", "esign_text_mismatch", "esign_bad_signed_at", "loe_sign_esign_open",
    ]) {
      expect(SQL, needle).toContain(needle);
    }
    for (let i = 1; i <= 15; i += 1) expect(SQL, `case ${i}`).toContain(`0113 case ${i}:`);
    // The withheld request columns have no grant.
    const grant = /grant select \(([^)]*)\) on public\.client_proposal_esign_request to authenticated/.exec(SQL)![1];
    for (const col of ["agreement_text", "agreement_sha256", "signer_title", "entity_name", "address", "template_version", "details", "signer_email", "snapshot", "selection"]) {
      expect(grant.split(/[\s,]+/), col).not.toContain(col);
    }
    const connGrant = /grant select \(([^)]*)\) on public\.adobe_sign_connection to authenticated/.exec(SQL)![1];
    expect(connGrant).not.toMatch(/_enc/);
  });

  it("AT22: the 0113 file's error codes are the app's closed set", async () => {
    const { LAST_ERROR_CODES } = await import("@/lib/esign/adobe-errors");
    for (const c of LAST_ERROR_CODES) expect(SQL).toContain(`'${c}'`);
  });

  it("AT22: this sprint's diff does not touch AGENTS.md's 0106 lines, and pricing.ts has no diff", () => {
    const diff = execFileSync("git", ["diff", "49efd5e", "--", "AGENTS.md"], { encoding: "utf8" });
    const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(removed).toEqual([]);
    expect(execFileSync("git", ["diff", "49efd5e", "--", "src/lib/proposals/pricing.ts"], { encoding: "utf8" })).toBe("");
  });
});
