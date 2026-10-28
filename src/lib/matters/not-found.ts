/**
 * The sentence for a record the caller's scoped client cannot see. A row in
 * another firm and a row that never existed read the same, on purpose: RLS
 * hides the first, and the person is told nothing that tells them apart.
 * The wording passes through friendlyMatterError unchanged.
 */
import { ReadableError } from "@/lib/ui/readable-error";

export type MatterRecordKind = "matter" | "contact" | "deadline" | "task";

export function recordNotFoundError(kind: MatterRecordKind): Error {
  return new ReadableError(`That ${kind} couldn't be found. It may have been removed.`);
}
