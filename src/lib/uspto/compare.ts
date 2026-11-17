import type { FetchStatusResult } from "./fetch-status";
import { stripStageCode } from "@/lib/stages/code";
import { suggestStage } from "./stage-map";

export type CompareResult = {
  verdict: "agree" | "differs" | "unknown";
  /** The stage names USPTO's status suggests (empty when unknown or unread). */
  usptoStageNames: readonly string[];
  /** The firm's own stage label as given. */
  lectualStage: string | null;
  /** Why the verdict is "unknown". */
  unknownBecause?: "not-set-up" | "unavailable" | "unmapped" | "conflict" | "no-lectual-stage";
};

/** "19A. OA Issued" -> "oa issued"; "Registered" -> "registered". */
function normalise(label: string): string {
  return stripStageCode(label).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * "USPTO says X, Lectual says Y". An unread, unavailable or unmapped status is `unknown`, NEVER agreement,
 * and a missing Lectual stage is `unknown` too.
 */
export function compareStatusToStage(read: FetchStatusResult, lectualStage: string | null): CompareResult {
  const lectual = lectualStage && lectualStage.trim() !== "" ? lectualStage : null;
  if (read.status === "not-set-up") {
    return { verdict: "unknown", usptoStageNames: [], lectualStage: lectual, unknownBecause: "not-set-up" };
  }
  if (read.status === "unavailable") {
    return { verdict: "unknown", usptoStageNames: [], lectualStage: lectual, unknownBecause: "unavailable" };
  }
  const suggestion = suggestStage(read.result);
  if (suggestion.stageNames.length === 0) {
    const conflict = suggestion.matchedBy === "code+text-conflict";
    return { verdict: "unknown", usptoStageNames: [], lectualStage: lectual, unknownBecause: conflict ? "conflict" : "unmapped" };
  }
  if (lectual === null) {
    return { verdict: "unknown", usptoStageNames: suggestion.stageNames, lectualStage: null, unknownBecause: "no-lectual-stage" };
  }
  const mine = normalise(lectual);
  const agrees = suggestion.stageNames.some((n) => normalise(n) === mine);
  return { verdict: agrees ? "agree" : "differs", usptoStageNames: suggestion.stageNames, lectualStage: lectual };
}
