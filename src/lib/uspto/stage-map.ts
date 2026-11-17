import type { DeadlineKind } from "@/lib/matters/deadline-rules";
import type { TsdrStatus } from "./parse";

/**
 * ONE table: a USPTO status -> the docket stage NAMES it suggests and the deadline type it usually starts.
 * Nothing here resolves a name to a firm's stage (the caller does that, by the firm's own labels) and
 * nothing here writes anything. Names are the stage LABELS without the numeric code ("17. Application Filed"
 * is "Application Filed"; the code is an ordering aid, see src/lib/matters/list-view.ts).
 *
 * UNVERIFIED: the numeric TSDR status codes below come from memory of the public code list, not from a
 * current USPTO page (README.md). Text patterns are the wider net. A status neither matches is "unknown":
 * never guessed, never mapped to a stage.
 *
 * Row order matters: the first row whose code or text matches wins. Terminal and specific rows come first.
 */
export type StageSuggestion = {
  key: string;
  /** Acceptable docket stage names, best first. Empty only for "unknown". */
  stageNames: readonly string[];
  /** Deadline type to suggest (the matter deadline kinds), or null. A SUGGESTION: an attorney confirms it. */
  deadlineKind: DeadlineKind | null;
  matchedBy: "code" | "text" | "none";
};

type Row = {
  key: string;
  codes: readonly number[];
  text: readonly RegExp[];
  stageNames: readonly string[];
  deadlineKind: DeadlineKind | null;
};

export const STAGE_MAP: readonly Row[] = [
  { key: "abandoned", codes: [602], text: [/\babandon/i], stageNames: ["Abandoned"], deadlineKind: null },
  { key: "registered", codes: [700], text: [/^registered\b/i], stageNames: ["Registered"], deadlineKind: "section_8_declaration" },
  {
    key: "response_filed",
    codes: [],
    text: [/response (after|to) .*(entered|received|filed)/i, /(suspension|suspended)/i],
    stageNames: ["Awaiting Trademark Registration"],
    deadlineKind: null,
  },
  {
    key: "notice_of_allowance",
    codes: [],
    text: [/notice of allowance/i],
    stageNames: ["Awaiting Trademark Registration"],
    deadlineKind: "statement_of_use",
  },
  {
    key: "published",
    codes: [680],
    text: [/published for opposition/i, /\bpublication\b/i],
    stageNames: ["Publication for Opposition"],
    deadlineKind: "opposition_window",
  },
  {
    key: "office_action",
    codes: [641],
    text: [/non-?final action/i, /final refusal/i, /office action/i],
    stageNames: ["OA Issued"],
    deadlineKind: "office_action_response",
  },
  {
    key: "new_application",
    codes: [630],
    text: [/new application/i],
    stageNames: ["Application Filed"],
    deadlineKind: null,
  },
  {
    key: "pending_examination",
    codes: [],
    text: [/awaiting examination/i, /assigned to (an )?examin/i, /examining attorney/i],
    stageNames: ["Awaiting Trademark Registration"],
    deadlineKind: null,
  },
];

export const UNKNOWN_SUGGESTION: StageSuggestion = {
  key: "unknown",
  stageNames: [],
  deadlineKind: null,
  matchedBy: "none",
};

/** Code first, then text. Unknown when neither matches. */
export function suggestStage(status: Pick<TsdrStatus, "statusCode" | "statusText">): StageSuggestion {
  for (const row of STAGE_MAP) {
    if (row.codes.includes(status.statusCode)) {
      return { key: row.key, stageNames: row.stageNames, deadlineKind: row.deadlineKind, matchedBy: "code" };
    }
  }
  const text = status.statusText ?? "";
  if (text !== "") {
    for (const row of STAGE_MAP) {
      if (row.text.some((re) => re.test(text))) {
        return { key: row.key, stageNames: row.stageNames, deadlineKind: row.deadlineKind, matchedBy: "text" };
      }
    }
  }
  return UNKNOWN_SUGGESTION;
}
