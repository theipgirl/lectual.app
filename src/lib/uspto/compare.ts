import type { FetchStatusResult } from "./fetch-status";
import { stripStageCode } from "@/lib/stages/code";
import { suggestStage } from "./stage-map";
import { isMatterStageRole, type MatterStageRole } from "@/lib/stages/roles";

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

/** The matter-stage role (lectual 0119) each suggested stage NAME stands for. */
const NAME_ROLES: Record<string, MatterStageRole> = {
  "application filed": "application_filed",
  "oa issued": "oa_issued",
  "awaiting trademark registration": "awaiting_registration",
  "publication for opposition": "publication",
  registered: "registered",
  abandoned: "abandoned",
};

/**
 * "USPTO says X, Lectual says Y".
 *
 * ROLE FIRST (lectual 0119): when the firm's stage holds a USPTO role (`lectualRole`), it agrees exactly when the status suggests a
 * stage of that role, whatever the stage is called now, so a rename never turns an "agree" into a false "differs". A stage with no
 * role is compared by its label, as before. An unread, unavailable or unmapped status is `unknown`, NEVER agreement,
 * and a missing Lectual stage is `unknown` too.
 */
export function compareStatusToStage(read: FetchStatusResult, lectualStage: string | null, lectualRole?: string | null): CompareResult {
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
  const role = isMatterStageRole(lectualRole) && lectualRole !== "signed_loe" ? lectualRole : null;
  const mine = normalise(lectual);
  const agrees = role
    ? suggestion.stageNames.some((n) => NAME_ROLES[normalise(n)] === role)
    : suggestion.stageNames.some((n) => normalise(n) === mine);
  return { verdict: agrees ? "agree" : "differs", usptoStageNames: suggestion.stageNames, lectualStage: lectual };
}
