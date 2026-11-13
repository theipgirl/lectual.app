/**
 * Display only: a brand name used as a trademark is shown in typographic quotation marks on the client proposal page
 * (“LOVE AS INFRASTRUCTURE”). Wraps the trimmed name unless it is already wrapped in straight or curly quotes, so a name a
 * firm typed with quotes is never doubled. The stored content is never changed, and the engagement letter, Exhibit A, the
 * agreement text, the Lawmatics note, the emails and the staff list do NOT use this: a signed letter is verified by
 * rebuilding its text, so those words must stay as they were.
 */
export function quotedMark(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return t;
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"],
    ["‘", "’"],
    ["'", "'"],
  ];
  const first = t[0];
  const last = t[t.length - 1];
  if (t.length >= 2 && pairs.some(([a, b]) => a === first && b === last)) return t;
  return `“${t}”`;
}
