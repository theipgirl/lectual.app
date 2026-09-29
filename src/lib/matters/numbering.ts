/**
 * Matter numbers are `${type}-${year}-${4 digits}` (TM-2026-0001), one sequence
 * per type per year. The next number is the highest existing suffix IN THAT
 * SEQUENCE plus one — never the firm's total matter count, which skipped ahead
 * whenever a firm had matters of other types, other years or imported numbers
 * in another scheme (a demo firm's ninth matter made its first trademark
 * TM-2026-0010). `skip` moves past a number another request just took; the
 * (org_id, matter_number) unique constraint remains the real guard.
 */
export function nextMatterNumber(type: string, year: string, existing: readonly string[], skip = 0): string {
  const prefix = `${type}-${year}-`;
  const taken = new Set(existing);
  let max = 0;
  for (const n of existing) {
    if (!n.startsWith(prefix)) continue;
    const suffix = n.slice(prefix.length);
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  let n = max + 1 + skip;
  let candidate = `${prefix}${String(n).padStart(4, "0")}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${prefix}${String(n).padStart(4, "0")}`;
  }
  return candidate;
}
