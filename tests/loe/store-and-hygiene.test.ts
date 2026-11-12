import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  approveLetterDraft,
  createLetterDraft,
  getApprovedLetter,
  listLetterVersions,
  saveLetterDraft,
} from "@/lib/loe/templates-store";

const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** A chainable fake of the parts of the Supabase query builder the store uses. */
function fakeDb(result: { data?: unknown; error?: unknown }, spy: { calls: Array<[string, unknown[]]> } = { calls: [] }) {
  const chain: Record<string, unknown> = {};
  const settle = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  for (const m of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
    chain[m] = (...args: unknown[]) => {
      spy.calls.push([m, args]);
      return chain;
    };
  }
  chain.single = () => settle();
  chain.maybeSingle = () => settle();
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
  return { db: { from: vi.fn(() => chain) } as never, spy };
}

const ROW = { id: "i", kind: "trademark", version: 2, status: "approved", title: "T", body: "B", updated_at: "2026-11-12T00:00:00Z", approved_at: "2026-11-12T00:00:00Z" };

describe("templates-store reads are three-state", () => {
  it("ok with versions", async () => {
    const { db } = fakeDb({ data: [ROW] });
    const r = await listLetterVersions(db);
    expect(r.status).toBe("ok");
  });
  it("an empty list that WAS read is ok and empty", async () => {
    const { db } = fakeDb({ data: [] });
    expect(await listLetterVersions(db)).toEqual({ status: "ok", versions: [] });
  });
  it("a missing table is not-set-up, judged on the code", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const { db } = fakeDb({ error: { code, message: "x" } });
      expect(await listLetterVersions(db)).toEqual({ status: "not-set-up" });
      expect(await getApprovedLetter(db, "trademark")).toEqual({ status: "not-set-up" });
    }
  });
  it("any other failure is unavailable, never an empty list", async () => {
    const { db } = fakeDb({ error: { code: "XX000", message: "boom" } });
    expect(await listLetterVersions(db)).toEqual({ status: "unavailable" });
    const thrown = { from: () => { throw new Error("net"); } } as never;
    expect(await listLetterVersions(thrown)).toEqual({ status: "unavailable" });
  });
  it("a row it cannot read makes the read unavailable instead of dropping it", async () => {
    const { db } = fakeDb({ data: [ROW, { ...ROW, id: "j", status: "weird" }] });
    expect(await listLetterVersions(db)).toEqual({ status: "unavailable" });
  });
  it("getApprovedLetter returns the letter, or null when the firm has none", async () => {
    expect((await getApprovedLetter(fakeDb({ data: ROW }).db, "trademark"))).toEqual({
      status: "ok",
      letter: { id: "i", kind: "trademark", version: 2, title: "T", body: "B" },
    });
    expect(await getApprovedLetter(fakeDb({ data: null }).db, "general")).toEqual({ status: "ok", letter: null });
  });
});

describe("templates-store writes", () => {
  it("inserts only org_id, kind, title and body (the database owns version, status and stamps)", async () => {
    const spy = { calls: [] as Array<[string, unknown[]]> };
    const { db } = fakeDb({ data: { id: "new" } }, spy);
    const r = await createLetterDraft(db, { orgId: "o", kind: "trademark", title: "T", body: "B" });
    expect(r).toEqual({ ok: true, id: "new" });
    const insert = spy.calls.find(([m]) => m === "insert")!;
    expect(Object.keys(insert[1][0] as object).sort()).toEqual(["body", "kind", "org_id", "title"]);
  });

  it("save is fenced on the row still being a draft and sends only title and body", async () => {
    const spy = { calls: [] as Array<[string, unknown[]]> };
    const { db } = fakeDb({ data: [{ id: "x" }] }, spy);
    expect(await saveLetterDraft(db, "x", { title: "T", body: "B" })).toEqual({ ok: true, id: "x" });
    expect(Object.keys(spy.calls.find(([m]) => m === "update")![1][0] as object).sort()).toEqual(["body", "title"]);
    expect(spy.calls).toContainEqual(["eq", ["status", "draft"]]);
  });

  it("a save or approve that touches no row is a fixed refusal, not success", async () => {
    const saved = await saveLetterDraft(fakeDb({ data: [] }).db, "x", { title: "T", body: "B" });
    expect(saved.ok).toBe(false);
    const approved = await approveLetterDraft(fakeDb({ data: [] }).db, "x");
    expect(approved).toMatchObject({ ok: false, error: "Only the firm's named approvers can approve the engagement letter." });
  });

  it("approve sends only status, and a trigger refusal becomes its fixed sentence", async () => {
    const spy = { calls: [] as Array<[string, unknown[]]> };
    const { db } = fakeDb({ error: { code: "23514", message: "loe_template_body_invalid: the letter uses a merge field that does not exist" } }, spy);
    const r = await approveLetterDraft(db, "x");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).not.toContain("loe_template");
    expect(spy.calls.find(([m]) => m === "update")![1][0]).toEqual({ status: "approved" });
  });
});

describe("hygiene: the letter code", () => {
  const files = [...walk("src/lib/loe"), ...walk("src/components/loe"), "src/app/dashboard/settings/proposals/engagement-letter/page.tsx", "src/app/dashboard/settings/proposals/engagement-letter/actions.ts"].filter((f) => /\.tsx?$/.test(f));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no dangerouslySetInnerHTML anywhere in it", () => {
    for (const f of files) expect(code(read(f)), f).not.toContain("dangerouslySetInnerHTML");
  });

  it("no logging of any kind in src/lib/loe or the components", () => {
    for (const f of files) expect(code(read(f)), f).not.toMatch(/\bconsole\s*\./);
  });

  it("imports no admin or service-role client", () => {
    for (const f of files) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/db\/admin|getAdminClient|service[_-]?role/i);
    }
  });

  it("the pure library has no server-only import and no HTML output", () => {
    for (const f of walk("src/lib/loe").filter((x) => /(fields|render|validate|fingerprint|kinds|index|errors|page-model|letter-actions)\.ts$/.test(x))) {
      expect(read(f), f).not.toContain("server-only");
    }
    for (const f of ["fields", "render", "validate", "fingerprint"]) {
      expect(code(read(`src/lib/loe/${f}.ts`)), f).not.toMatch(/innerHTML|<\/?(p|div|span|br|b|strong|em|script)[ >\/]/);
    }
  });

  it("missing-table handling keys on the error code (42P01 / PGRST205) only", () => {
    const store = code(read("src/lib/loe/templates-store.ts"));
    expect(store).toContain("isMissingTableError");
    expect(store).not.toMatch(/does not exist|schema cache/i);
    expect(read("src/lib/files/errors.ts")).toMatch(/PGRST205/);
  });

  it("the store uses the hand-added table types", () => {
    const types = read("src/lib/db/types.ts");
    expect(types).toContain("client_proposal_loe_template: {");
    expect(types).toContain("client_proposal_signature: {");
    expect(code(read("src/lib/loe/templates-store.ts"))).toContain('from("client_proposal_loe_template")');
    expect(code(read("src/lib/loe/templates-store.ts"))).toContain('Database');
  });

  it("every server action goes through the gate and role inside run*, and uses the scoped client", () => {
    const actions = code(read("src/app/dashboard/settings/proposals/engagement-letter/actions.ts"));
    expect(actions).toContain("getScopedClient");
    expect(actions).toContain("requireProposalsModule");
    const logic = code(read("src/lib/loe/letter-actions.ts"));
    expect((logic.match(/await deps\.requireModule\(\)/g) ?? []).length).toBe(2); // gateEdit + approve
    expect(logic.match(/export async function run/g)).toHaveLength(4);
  });
});
