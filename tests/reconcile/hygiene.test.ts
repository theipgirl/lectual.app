import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(rel: string): string[] {
  return readdirSync(path.join(root, rel)).flatMap((name) => {
    const full = `${rel}/${name}`;
    return statSync(path.join(root, full)).isDirectory() ? walk(full) : [full];
  });
}

/** Every file this screen added. (Files it only edited are checked separately below.) */
const NEW_FILES = [
  ...walk("src/lib/reconcile"),
  ...walk("src/components/reconcile"),
  ...walk("src/app/dashboard/intake/reconcile"),
  "src/lib/intake/sheet-csv.ts",
  "src/lib/intake/sheet-limits.ts",
  "src/lib/intake/sheet-read.ts",
  "src/lib/intake/sheet-records.ts",
  "src/lib/intake/sheet-import.ts",
];
const CODE = NEW_FILES.filter((f) => /\.(ts|tsx)$/.test(f));
// Built from pieces so this file does not itself contain the strings the repo-wide greps look for.
const FORBIDDEN_ADMIN = new RegExp([["getAdmin", "Client\\("], ["@/lib/db/", "admin"], ["SUPABASE_SERVICE", "_ROLE"]].map((p) => p.join("")).join("|"));
const FORBIDDEN_HTML = new RegExp(["dangerously", "SetInnerHTML"].join(""));
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("what the screen is allowed to touch", () => {
  it("the forbidden-string patterns do match what they are meant to catch", () => {
    expect(FORBIDDEN_ADMIN.test("x = getAdmin" + "Client();")).toBe(true);
    expect(FORBIDDEN_ADMIN.test('from "@/lib/db/' + 'admin"')).toBe(true);
    expect(FORBIDDEN_ADMIN.test("process.env.SUPABASE_SERVICE" + "_ROLE_KEY")).toBe(true);
    expect(FORBIDDEN_HTML.test("dangerously" + "SetInnerHTML={{}}")).toBe(true);
    expect(FORBIDDEN_ADMIN.test("getScopedClient()")).toBe(false);
  });

  it("lists the files it expects", () => {
    expect(CODE.length).toBeGreaterThan(25);
  });

  it("no service-role client, admin import or service-role key", () => {
    for (const f of CODE) {
      const src = read(f);
      expect(src, f).not.toMatch(FORBIDDEN_ADMIN);
    }
  });

  it("no direct write to a table: the only write is the existing stage move", () => {
    for (const f of CODE) {
      const src = strip(read(f));
      // (`createHash(...).update(...)` in fingerprint.ts is a hash, not a table write.)
      if (!f.endsWith("fingerprint.ts")) expect(src, f).not.toMatch(/\.(update|insert|upsert|delete)\(/);
      expect(src, f).not.toMatch(/stage_entered_at/);
      expect(src, f).not.toMatch(/current_stage_id\s*:/);
    }
    const actions = read("src/app/dashboard/intake/reconcile/actions.ts");
    expect(actions.match(/moveLeadStage\(/g)).toHaveLength(1);
    expect(actions).toMatch(/import \{ moveLeadStage \} from "@\/lib\/pipeline"/);
  });

  it("reads only named columns and only existing tables", () => {
    const sources = read("src/lib/reconcile/sources.ts") + read("src/app/dashboard/intake/reconcile/actions.ts");
    expect(sources).not.toMatch(/select\(\s*["'`]\*/);
    const tables = [...sources.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(["crm_activity", "crm_lead", "crm_stage"]);
  });

  it("nothing is written to Lawmatics: no write module, no HTTP verb, no write call", () => {
    for (const f of CODE) {
      const src = read(f);
      expect(src, f).not.toMatch(/lawmatics\/writes/);
      expect(src, f).not.toMatch(/lawmatics\/contact-payload/);
      expect(strip(src), f).not.toMatch(/["'`](POST|PATCH|PUT|DELETE)["'`]/);
    }
    const lawmaticsImports = CODE.flatMap((f) => [...read(f).matchAll(/from "(@\/lib\/lawmatics\/[a-z-]+)"/g)].map((m) => m[1]));
    expect([...new Set(lawmaticsImports)].sort()).toEqual(["@/lib/lawmatics/connection", "@/lib/lawmatics/import", "@/lib/lawmatics/normalize", "@/lib/lawmatics/stage-map"]);
  });

  it("sends no mail, uses no queue, notifies no one and builds no client-facing link", () => {
    for (const f of CODE) {
      const src = strip(read(f));
      expect(src, f).not.toMatch(/sendMail|resend|notify\(|\bqueue\b|enqueue|\/q\/|\/p\//i);
    }
  });

  it("no raw HTML injection, no SQL, no placeholder text", () => {
    for (const f of NEW_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(FORBIDDEN_HTML);
      expect(src, f).not.toMatch(/create table|alter table|insert into|drop table|create policy/i);
      expect(src, f).not.toMatch(/\bTODO\b|FIXME|coming soon|lorem ipsum/i);
    }
  });

  it("reads no spreadsheet workbook: no xlsx dependency", () => {
    for (const f of CODE) expect(read(f), f).not.toMatch(/from ["']xlsx["']|require\(["']xlsx/);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain("xlsx");
  });

  it("uses node's built-in crypto for the fingerprint", () => {
    const src = read("src/lib/reconcile/fingerprint.ts");
    expect(src).toMatch(/from "node:crypto"/);
    expect(src).toMatch(/createHash\("sha256"\)/);
  });
});

describe("the role gate is in both places", () => {
  it("the page resolves the role itself and answers not-found", () => {
    const page = read("src/app/dashboard/intake/reconcile/page.tsx");
    expect(page).toMatch(/resolveFirmSession/);
    expect(page).toMatch(/canReconcile\(session\.role\)\) notFound\(\)/);
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("both actions authorize before anything else, and take no org from the browser", () => {
    const actions = read("src/app/dashboard/intake/reconcile/actions.ts");
    expect(actions).toMatch(/^"use server";/);
    for (const name of ["previewReconcileAction", "applyReconcileAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      expect(body.indexOf("await authorize()")).toBeGreaterThan(0);
      expect(body.indexOf("await authorize()")).toBeLessThan(body.indexOf("getScopedClient") === -1 ? Infinity : body.indexOf("getScopedClient"));
    }
    expect(actions).not.toMatch(/org_?id|orgId/i);
  });

  it("only the admin tier can reconcile", async () => {
    const { RECONCILE_ROLES, canReconcile } = await import("../../src/lib/reconcile/roles");
    expect([...RECONCILE_ROLES]).toEqual(["owner", "admin", "senior_admin"]);
    expect(canReconcile("attorney")).toBe(false);
    expect(canReconcile(null)).toBe(false);
  });
});

describe("the design-session files and the dependencies are untouched", () => {
  it("the files this sprint promised not to edit carry nothing about reconciliation", () => {
    for (const f of ["src/app/globals.css", "src/lib/nav.ts", "src/app/dashboard/layout.tsx", "src/app/dashboard/page.tsx"]) {
      expect(read(f), f).not.toMatch(/reconcil/i);
    }
  });
});

describe("ported files and docs", () => {
  it("each ported file names its lectual source in a header comment", () => {
    expect(read("src/lib/intake/sheet-import.ts").slice(0, 400)).toMatch(/Ported from theipgirl\/lectual `src\/lib\/intake\/sheet-import\.ts`/);
    expect(read("src/lib/intake/sheet-records.ts").slice(0, 400)).toMatch(/Ported from theipgirl\/lectual `src\/lib\/matters\/tracker-import-plan\.ts`/);
  });

  it("PORTED_FROM.md has a row for each", () => {
    const ported = read("PORTED_FROM.md");
    expect(ported).toMatch(/src\/lib\/intake\/sheet-import\.ts/);
    expect(ported).toMatch(/src\/lib\/intake\/sheet-records\.ts/);
    expect(ported).toMatch(/recordsFromSheetRows/);
  });

  it("AGENTS.md has the Stage reconciliation section with its rules", () => {
    const agents = read("AGENTS.md");
    const section = agents.slice(agents.indexOf("## Stage reconciliation"), agents.indexOf("## JSX text spacing"));
    expect(section.length).toBeGreaterThan(500);
    for (const phrase of ["sheet wins", "needs_matter", "CSV only", "stored mail", "fingerprint", "Lawmatics", "won"]) {
      expect(section.toLowerCase(), phrase).toContain(phrase.toLowerCase());
    }
  });
});
