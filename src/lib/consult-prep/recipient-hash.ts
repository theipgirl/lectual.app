import { hash } from "node:crypto";

/**
 * sha256 of the sorted, lower-cased final To + Cc list of one send. Only the hash is stored (never an address): a later run
 * compares it with the list the guard gives NOW, and a scheduled send whose list changed is cancelled and planned again.
 */
export function recipientsSha256(to: readonly string[], cc: readonly string[]): string {
  const all = [...to.map((a) => `to:${a.trim().toLowerCase()}`), ...cc.map((a) => `cc:${a.trim().toLowerCase()}`)].sort();
  return hash("sha256", all.join("\n"), "hex");
}
