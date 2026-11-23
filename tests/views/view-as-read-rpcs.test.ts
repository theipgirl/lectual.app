import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Read RPCs are called as GET (`rpc(fn, args, { get: true })`), so they pass View as's database net. A read RPC left as
 * POST would simply fail in a preview ("couldn't be read"), so the net fails closed, but these are named: each must be
 * STABLE in the database (lectual 0002, 0050, 0031; 0108's mailbox_connections_for_owner).
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
const READ_RPCS = ["current_org_id", "current_org_role", "is_platform_admin", "platform_admin_orgs", "mailbox_connections_for_owner"];
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("every read RPC call is a GET", () => {
  const files = walk(path.join(ROOT, "src"));

  it("each call of a read RPC passes { get: true }", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      for (const fn of READ_RPCS) {
        const re = new RegExp(`rpc\\(\\s*"${fn}"([^)]*)\\)`, "g");
        for (const m of src.matchAll(re)) {
          seen++;
          if (!/get:\s*true/.test(m[1])) bad.push(`${path.relative(ROOT, f)}: ${m[0]}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(45);
  });

  it("org_member_directory goes through callMemberRpc as a GET; the two writing member RPCs stay POST", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/members/rpc.ts"), "utf8");
    expect(src).toMatch(/fn === "org_member_directory" \? untyped\.rpc\(fn, args, \{ get: true \}\)/);
  });

  it("no other read-RPC spelling slips through (a typed wrapper's rpc(name) call)", () => {
    const hits = files.flatMap((f) => {
      const src = strip(readFileSync(f, "utf8"));
      return READ_RPCS.flatMap((fn) => (new RegExp(`rpc\\(\\s*["'\`]${fn}["'\`]\\s*\\)`).test(src) ? [`${path.relative(ROOT, f)} ${fn}`] : []));
    });
    expect(hits).toEqual([]);
  });
});
