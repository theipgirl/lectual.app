/**
 * The canonical form of what a client is about to sign. Pure and free of node imports so the browser (Web Crypto) and
 * the server (`fingerprint.ts`, node:crypto) hash exactly the same string.
 *
 * Canonical = object keys sorted at every level, no insignificant whitespace, `undefined` keys dropped; array order and
 * every character of every string count.
 */

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return "null";
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      return "null";
  }
}

export type AgreementParts = { letter: unknown; details: unknown; exhibit: unknown };

/** The string that is hashed: the letter, the client's details and the exhibit, nothing else. */
export function agreementCanonical(parts: AgreementParts): string {
  return canonicalJson({ letter: parts.letter, details: parts.details, exhibit: parts.exhibit });
}
