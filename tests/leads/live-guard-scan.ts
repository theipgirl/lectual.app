/** The scanner behind tests/leads/live-guard.test.ts (M5). Pure: source text in, offending line numbers out. */

const MARKER = /\/\/\s*live-guard:\s*(.{10,})/;
/** The table name as a string in any quote: "crm_lead", 'crm_lead' or `crm_lead`. */
const TABLE = /(["'`])crm_lead\1/g;

/** Line numbers (1-based) of every crm_lead string that is a table name (not a type reference, not in a comment). */
export function scanForLeadTable(code: string): number[] {
  const out: number[] = [];
  code.split("\n").forEach((line, i) => {
    if (/^\s*(\/\*|\*)/.test(line)) return; // a block or doc comment line
    const text = line.replace(/\/\/.*$/, "");
    for (const m of text.matchAll(TABLE)) {
      const before = text.slice(0, m.index);
      if (!/\[\s*$/.test(before)) out.push(i + 1); // ["crm_lead"] is a type reference
    }
  });
  return [...new Set(out)];
}

/**
 * The lines that break the rule. A table name passes only when it is wrapped in `live(...)`, when its statement is an
 * insert (a new lead is never merged), or when a `// live-guard: <reason>` comment sits on its line or in the three
 * lines above. Naming merged_into_id is NOT enough on its own: a read of the pointer says why with a marker.
 */
export function guardOffenders(code: string): number[] {
  const lines = code.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  return scanForLeadTable(code).filter((lineNo) => {
    const lineText = lines[lineNo - 1];
    const col = lineText.search(/(["'`])crm_lead\1/);
    const at = offsets[lineNo - 1] + Math.max(0, col);
    const before = code.slice(Math.max(0, at - 140), at);
    const end = code.indexOf(";", at);
    const statement = code.slice(at, end === -1 ? undefined : end);
    if (/live\(\s*[\w.]*\s*\.from\(\s*$/.test(before)) return false;
    if (/\.insert\(/.test(statement)) return false;
    for (let k = lineNo - 1; k >= Math.max(0, lineNo - 4); k -= 1) if (MARKER.test(lines[k])) return false;
    return true;
  });
}
