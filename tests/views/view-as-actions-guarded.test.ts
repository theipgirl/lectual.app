import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * View as, Layer a (spec "The write block"): EVERY exported server action is wrapped in previewSafe (or, for an action that
 * writes nothing at all, previewReadOnly with its reason, on the named list below), and every mutating route handler in
 * previewSafeRoute. This parses the sources and fails CI on an unwrapped action, a re-export or a factory it can't see
 * through (rewrite those to the plain form rather than allowlisting them: spec risk R4).
 */
const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const files = walk(path.join(ROOT, "src"));
const serverFiles = files.filter((f) => /^\s*["']use server["'];?/.test(readFileSync(f, "utf8")));
const routeFiles = files.filter((f) => /\/route\.ts$/.test(f));

/** The named read-only allowlist: each writes nothing (no database write, no queue or provider call, no token refresh). */
export const READ_ONLY_ALLOWLIST: Record<string, string> = {
  searchContactsAction: "Contact search on a matter: reads contacts, writes nothing",
  loadCompareAction: "The leads compare panel: reads two leads and their counts, writes nothing",
  pickHubRecordsAction: "Getting started's record picker: reads one lead and one matter id, writes nothing",
  downloadSignedLetterStaffAction: "Signed letter download: builds a PDF from stored rows, writes nothing",
  downloadReviewLetterAction: "Public review-letter download: builds a PDF, writes nothing (its rate limit is in memory)",
  downloadSignedLetterAction: "Public signed-letter download: builds a PDF, writes nothing (its rate limit is in memory)",
};

/** Route handlers by path. Every route.ts must be named here. */
const FIXED_PATHS = ["src/app/dashboard/view-as/enter/route.ts", "src/app/dashboard/view-as/exit/route.ts", "src/app/auth/sign-out/route.ts"];
const NO_SIGNED_IN_CALLER: Record<string, string> = {
  "src/app/api/cron/agents/route.ts": "cron (CRON_SECRET), no signed-in caller",
  "src/app/api/cron/lawmatics-matters/route.ts": "cron (CRON_SECRET), no signed-in caller",
  "src/app/api/cron/mailbox-sync/route.ts": "cron (CRON_SECRET), no signed-in caller",
  "src/app/api/cron/meetings-import/route.ts": "cron (CRON_SECRET), no signed-in caller",
  "src/app/api/worksheet/route.ts": "the public worksheet form, no signed-in caller",
};
const READ_ONLY_ROUTES: Record<string, string> = {
  "src/app/dashboard/files/[id]/download/route.ts": "GET: mints a 60-second signed download link (a read)",
  "src/app/dashboard/documents/[id]/download/route.ts": "GET: streams a stored document (a read)",
  "src/app/dashboard/forms/export/route.ts": "GET: the CSV export (a read)",
  "src/app/dashboard/forms/event-export/route.ts": "GET: the event CSV export (a read)",
};
const MUTATING_ROUTES = [
  "src/app/api/matters-chat/route.ts",
  "src/app/api/mailbox/connect/[provider]/route.ts",
  "src/app/api/mailbox/callback/[provider]/route.ts",
  "src/app/api/meetings/zoom/connect/route.ts",
  "src/app/api/meetings/zoom/callback/route.ts",
  "src/app/api/lawpay/connect/route.ts",
  "src/app/api/lawpay/callback/route.ts",
  "src/app/auth/callback/route.ts",
];

type Finding = { file: string; name: string; kind: "safe" | "read-only" | "route-safe" | "plain" | "bad"; reason?: string; refusal?: string };

function exportsOf(file: string, source?: string): Finding[] {
  const src = source ?? readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Finding[] = [];
  const f = source === undefined ? rel(file) : file;
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []).map((m) => m.kind) : [];
    const exported = mods.includes(ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      out.push({ file: f, name: "export {...}", kind: "bad", reason: "re-export or export list" });
      continue;
    }
    if (ts.isExportAssignment(st)) {
      out.push({ file: f, name: "default", kind: "bad", reason: "export default" });
      continue;
    }
    if (!exported) continue;
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue;
    if (ts.isFunctionDeclaration(st)) {
      out.push({ file: f, name: st.name?.text ?? "?", kind: "plain" });
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : "?";
        const init = d.initializer;
        if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          const callee = init.expression.text;
          const fn = init.arguments[0];
          const fnOk = !!fn && (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn));
          if (callee === "previewSafe" && fnOk && init.arguments.length === 2) {
            out.push({ file: f, name, kind: "safe", refusal: init.arguments[1].getText(sf) });
            continue;
          }
          if (callee === "previewReadOnly" && fnOk && init.arguments.length === 2 && ts.isStringLiteral(init.arguments[1])) {
            out.push({ file: f, name, kind: "read-only", reason: init.arguments[1].text });
            continue;
          }
          if (callee === "previewSafeRoute" && fnOk && init.arguments.length === 1) {
            out.push({ file: f, name, kind: "route-safe" });
            continue;
          }
        }
        out.push({ file: f, name, kind: "bad", reason: "a value the test can't see through (factory, alias or constant)" });
      }
      continue;
    }
    out.push({ file: f, name: "?", kind: "bad", reason: ts.SyntaxKind[st.kind] });
  }
  return out;
}

describe("every exported server action is wrapped", () => {
  const all = serverFiles.flatMap((f) => exportsOf(f));

  it("finds every \"use server\" file (69 at the time of writing, more allowed)", () => {
    expect(serverFiles.length).toBeGreaterThanOrEqual(69);
  });

  it("no export is unwrapped, re-exported or made by a factory", () => {
    const bad = all.filter((x) => x.kind !== "safe" && x.kind !== "read-only").map((x) => `${x.file} ${x.name}: ${x.kind}${x.reason ? ` (${x.reason})` : ""}`);
    expect(bad).toEqual([]);
  });

  it("the read-only allowlist is exactly the named list, each with its reason", () => {
    const ro = Object.fromEntries(all.filter((x) => x.kind === "read-only").map((x) => [x.name, x.reason]));
    expect(ro).toEqual(READ_ONLY_ALLOWLIST);
  });

  it("previewReconcileAction is refused, not allowlisted (it refreshes mailbox tokens)", () => {
    expect(all.find((x) => x.name === "previewReconcileAction")?.kind).toBe("safe");
  });

  it("counts every wrapped action", () => {
    expect(all.filter((x) => x.kind === "safe").length).toBeGreaterThanOrEqual(230);
  });
});

describe("every mutating route handler is wrapped", () => {
  it("every route.ts is classified", () => {
    const known = new Set([...FIXED_PATHS, ...Object.keys(NO_SIGNED_IN_CALLER), ...Object.keys(READ_ONLY_ROUTES), ...MUTATING_ROUTES]);
    expect(routeFiles.map(rel).filter((f) => !known.has(f))).toEqual([]);
  });

  it("the mutating ones are previewSafeRoute(...)", () => {
    for (const f of MUTATING_ROUTES) {
      const found = exportsOf(path.join(ROOT, f)).filter((x) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(x.name));
      expect(found.length, f).toBeGreaterThan(0);
      for (const x of found) expect(x.kind, `${f} ${x.name}`).toBe("route-safe");
    }
  });

  it("the read-only routes export only GET", () => {
    for (const f of Object.keys(READ_ONLY_ROUTES)) {
      const names = exportsOf(path.join(ROOT, f)).filter((x) => /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(x.name)).map((x) => x.name);
      expect(names, f).toEqual(["GET"]);
    }
  });

  it("the three fixed paths are plain POST handlers", () => {
    for (const f of FIXED_PATHS) expect(exportsOf(path.join(ROOT, f)).map((x) => `${x.name}:${x.kind}`), f).toEqual(["POST:plain"]);
  });
});

describe("the test sees through what it must", () => {
  const kinds = (src: string) => exportsOf("mem.ts", src).map((x) => x.kind);
  it("flags a bare export, a re-export, a default export and a factory", () => {
    expect(kinds("export async function a() {}")).toEqual(["plain"]);
    expect(kinds('export { a } from "./b";')).toEqual(["bad"]);
    expect(kinds('export * from "./b";')).toEqual(["bad"]);
    expect(kinds("const a = async () => {}; export default a;")).toEqual(["bad"]);
    expect(kinds("export const a = makeAction(async () => {});")).toEqual(["bad"]);
    expect(kinds("export const a = previewSafe(other, \"state\");")).toEqual(["bad"]);
    expect(kinds("export const a = previewSafe(async function a() {});")).toEqual(["bad"]);
  });
  it("accepts the three wrapped forms", () => {
    expect(kinds('export const a = previewSafe(async function a() {}, "state");')).toEqual(["safe"]);
    expect(kinds('export const a = previewReadOnly(async function a() {}, "reads only");')).toEqual(["read-only"]);
    expect(kinds("export const GET = previewSafeRoute(async function GET() { return new Response(); });")).toEqual(["route-safe"]);
    expect(kinds("export type T = { a: 1 };")).toEqual([]);
  });
});
