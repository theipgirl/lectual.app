import type { AssistantRow, ProposalRecord } from "./types";

const norm = (s: string | null | undefined): string => (s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Resolves a name the model gave (a client or a mark) to a row when it returned no id. Exact, unique,
 * case-insensitive (whitespace collapsed) only; two rows sharing the name, or none, is "unmatched".
 * Never fuzzy.
 */
export function matchRecord(name: string | null | undefined, rows: readonly AssistantRow[]): ProposalRecord {
  const wanted = norm(name);
  if (!wanted) return "unmatched";
  const hits = rows.filter((r) => norm(r.client) === wanted || (r.mark != null && norm(r.mark) === wanted));
  return hits.length === 1 ? { kind: hits[0].kind, id: hits[0].id } : "unmatched";
}
