import { createHash } from "node:crypto";

/**
 * sha256 (hex) over a CANONICAL form of what a client is about to sign: the
 * letter, their details and the exhibit. Canonical = object keys sorted at every
 * level, no insignificant whitespace, `undefined` keys dropped; array order and
 * every character of every string count. So two objects that differ only in key
 * order or in how they were serialised agree, and changing one letter, one
 * detail or one exhibit character does not.
 *
 * Pure and deterministic. The server builds the agreement text itself and
 * compares its fingerprint with the one the browser saw; a mismatch means the
 * page was stale and nothing is written.
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

export function agreementFingerprint(parts: AgreementParts): string {
  const canonical = canonicalJson({ letter: parts.letter, details: parts.details, exhibit: parts.exhibit });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
