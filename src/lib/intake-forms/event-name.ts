/**
 * An event code as a name: "legal-assessment" -> "Legal Assessment",
 * "urban-golf-2026" -> "Urban Golf 2026". Words split on hyphens, underscores
 * and spaces; each gets a capital first letter and keeps the rest as typed
 * (digits and "2profit" stay put). A code with no words reads as itself.
 */
export function eventDisplayName(code: string): string {
  const words = code.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return code;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
