import { describe, expect, it } from "vitest";
import { candidatesOf, walk } from "./_scan";

/**
 * Sprint 37: a firm reads "Campaign", never "Sequence". This scans string literals and JSX text only,
 * so identifiers, imports, comments, routes, table and column names (`crm_drip_sequence`, `sequenceId`)
 * are not hit. Allow-list entries each carry a reason.
 */
const ALLOW: Array<{ file: RegExp; reason: string }> = [
  { file: /^src\/lib\/(db\/types|automation\/(drips|rules|engine))\.ts$/, reason: "table names, select lists and developer errors" },
];

const WORD = /\bsequences?\b/i;
// A snake_case or camelCase code token (table, column, field) is not text.
const CODE_TOKEN = /^[A-Za-z0-9_.\-/]+$/;

export function sequenceHits(): string[] {
  const files = ["src/app", "src/components", "src/lib"].flatMap((r) => walk(r)).filter((f) => !f.endsWith(".d.ts"));
  const hits: string[] = [];
  for (const file of files) {
    if (ALLOW.some((a) => a.file.test(file))) continue;
    for (const c of candidatesOf(file)) {
      // A template's own ${expression} is code; a "[campaigns] ..." string is a server log line.
      const text = c.text.replace(/\$\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
      if (text.startsWith("[")) continue;
      if (!WORD.test(text) || CODE_TOKEN.test(text)) continue;
      // A comma list of column names in a select is not text either.
      if (/^[a-z0-9_, *().:!>-]+$/.test(text)) continue;
      hits.push(`${file}:${c.line}\t${text.slice(0, 120)}`);
    }
  }
  return hits;
}

describe("no visible 'Sequence' word", () => {
  it("finds none in strings or JSX text", () => {
    const hits = sequenceHits();
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
