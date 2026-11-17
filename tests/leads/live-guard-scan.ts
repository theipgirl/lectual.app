/** The scanner behind tests/leads/live-guard.test.ts (M5). Pure: source text in, offending line numbers out. */

const MARKER = /\/\/\s*live-guard:\s*(.{10,})/;

/** Line numbers (1-based) of every "crm_lead" string that is a table name (not a type reference, not in a comment). */
export function scanForLeadTable(code: string): number[] {
  const out: number[] = [];
  const lines = code.split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    let at = code.indexOf('"crm_lead"');
    while (at !== -1) {
      const before = code.slice(0, at);
      if (!/\[\s*$/.test(before)) out.push(i + 1); // ["crm_lead"] is a type reference
      at = code.indexOf('"crm_lead"', at + 1);
    }
  });
  return [...new Set(out)];
}

export function guardOffenders(code: string): number[] {
  const lines = code.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  return scanForLeadTable(code).filter((lineNo) => {
    const start = offsets[lineNo - 1];
    const at = code.indexOf('"crm_lead"', start);
    const before = code.slice(Math.max(0, at - 140), at);
    const end = code.indexOf(";", at);
    const statement = code.slice(at, end === -1 ? undefined : end);
    if (/live\(\s*[\w.]*\s*\.from\(\s*$/.test(before)) return false;
    if (/merged_into_id|merged \?/.test(statement)) return false;
    if (/\.insert\(/.test(statement)) return false;
    for (let k = lineNo - 1; k >= Math.max(0, lineNo - 4); k -= 1) if (MARKER.test(lines[k])) return false;
    return true;
  });
}
