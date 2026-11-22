import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Director's ruling C (Nov 22): 0113's replacement of `client_proposal_signature_guard()` is 0106's body copied EXACTLY plus ONE
 * narrow exception (a referential-action null-out of `esign_request_id`). This diffs the two line by line, the way 0106's own
 * migration-text test held its lifecycle against 0101's: every 0106 line is there, in order, unchanged, and the only added
 * lines are that exception.
 */
const HEADER_LINES = 2;
const OLD = readFileSync("tests/esign/__fixtures__/0106-signature-guard.sql.txt", "utf8").split("\n").slice(HEADER_LINES).join("\n").trimEnd().split("\n");
const SQL = readFileSync("docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt", "utf8");

function newGuard(): string[] {
  const at = SQL.indexOf("create or replace function public.client_proposal_signature_guard()");
  expect(at).toBeGreaterThan(-1);
  const end = SQL.indexOf("\n$$;", at) + "\n$$;".length;
  return SQL.slice(at, end).split("\n");
}

const EXCEPTION = [
  "    -- 0113: the same for esign_request_id (the signing request's ON DELETE SET NULL).",
  "    if pg_trigger_depth() > 1",
  "       and (to_jsonb(new) - 'esign_request_id') = (to_jsonb(old) - 'esign_request_id')",
  "       and new.esign_request_id is null then",
  "      return new;",
  "    end if;",
];

/** Longest-common-subsequence diff: the lines only in `a` (removed) and only in `b` (added). */
function diff(a: string[], b: string[]): { removed: string[]; added: string[] } {
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (L[i + 1][j] >= L[i][j + 1]) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  while (i < n) removed.push(a[i++]);
  while (j < m) added.push(b[j++]);
  return { removed, added };
}

describe("ruling C: 0113's signature guard is 0106's plus one narrow exception", () => {
  it("the fixture is 0106's whole guard function", () => {
    expect(OLD[0]).toBe("create or replace function public.client_proposal_signature_guard()");
    expect(OLD[OLD.length - 1]).toBe("$$;");
    expect(OLD.join("\n")).toContain("new.template_id is null then");
  });

  it("no 0106 line is removed or changed, and the only added lines are the esign_request_id exception", () => {
    const { removed, added } = diff(OLD, newGuard());
    expect(removed).toEqual([]);
    expect(added).toEqual(EXCEPTION);
  });

  it("the exception sits right after the template_id one, inside the UPDATE branch, before the refusal", () => {
    const g = newGuard();
    const tpl = g.indexOf("       and new.template_id is null then");
    const exc = g.indexOf(EXCEPTION[0]);
    const raise = g.findIndex((l) => l.includes("raise exception 'loe_signature_append_only"));
    expect(tpl).toBeGreaterThan(-1);
    expect(exc).toBe(tpl + 3);
    expect(raise).toBe(exc + EXCEPTION.length);
  });
});
