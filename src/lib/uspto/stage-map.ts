import type { DeadlineKind } from "@/lib/matters/deadline-rules";
import type { TsdrStatus } from "./parse";

/**
 * ONE table: a USPTO status -> the docket stage NAMES it suggests and the deadline type it usually starts.
 * Nothing here resolves a name to a firm's stage (the caller does that, by the firm's own labels) and
 * nothing here writes anything. Names are the stage LABELS without the numeric code ("17. Application Filed"
 * is "Application Filed"; the code is an ordering aid, see src/lib/matters/list-view.ts).
 *
 * UNVERIFIED: the numeric TSDR status codes were not confirmed against a real response, so every row's `codes`
 * is EMPTY on purpose (README.md); the code mechanism stays and is tested with an injected table. Text patterns
 * decide. A status nothing matches is "unknown": never guessed, never mapped to a stage.
 *
 * Row order matters: the first row whose TEXT matches wins. Exclusion rows (empty `stageNames`) come first, so a
 * revived, withdrawn or cancelled status never lands on the abandoned / published / registered rows.
 * When a code row and a text row both match and DISAGREE the answer is unknown, `matchedBy: "code+text-conflict"`.
 */
export type StageSuggestion = {
  key: string;
  /** Acceptable docket stage names, best first. Empty only for "unknown". */
  stageNames: readonly string[];
  /** Deadline type to suggest (the matter deadline kinds), or null. A SUGGESTION: an attorney confirms it. */
  deadlineKind: DeadlineKind | null;
  matchedBy: "code" | "text" | "none" | "code+text-conflict";
};

export type Row = {
  key: string;
  codes: readonly number[];
  text: readonly RegExp[];
  stageNames: readonly string[];
  deadlineKind: DeadlineKind | null;
};

const AWAITING = ["Awaiting Trademark Registration"] as const;

export const STAGE_MAP: readonly Row[] = [
  // Exclusions: no stage. A petition to revive is not an abandonment, a withdrawn publication is not a publication.
  {
    key: "excluded",
    codes: [],
    text: [/\brevive/i, /\breinstat/i, /\bwithdrawn\b/i, /\bcancel/i],
    stageNames: [],
    deadlineKind: null,
  },
  { key: "abandoned", codes: [], text: [/\babandon/i], stageNames: ["Abandoned"], deadlineKind: null },
  {
    key: "registered_maintained",
    codes: [],
    text: [/^registered\b.*\b(renewed|sec(tion|\.)?\s*(8|9|15|71)|accepted)/i],
    stageNames: ["Registered"],
    deadlineKind: null,
  },
  { key: "registered", codes: [], text: [/^registered\b/i], stageNames: ["Registered"], deadlineKind: "section_8_declaration" },
  {
    key: "response_filed",
    codes: [],
    text: [
      /response (after|to) .*(entered|received|filed)/i,
      /(suspension|suspended)/i,
      /request for reconsideration/i,
      /\bpetition/i,
    ],
    stageNames: AWAITING,
    deadlineKind: null,
  },
  { key: "notice_of_allowance", codes: [], text: [/notice of allowance/i], stageNames: AWAITING, deadlineKind: "statement_of_use" },
  // Approved but not yet published: still waiting. Product call: it is not "Publication for Opposition" yet.
  { key: "approved_for_publication", codes: [], text: [/approved for publication/i], stageNames: AWAITING, deadlineKind: null },
  {
    key: "published",
    codes: [],
    text: [/published for opposition/i, /notice of publication/i],
    stageNames: ["Publication for Opposition"],
    deadlineKind: "opposition_window",
  },
  {
    key: "office_action",
    codes: [],
    text: [/non-?final action/i, /final refusal/i, /office action/i],
    stageNames: ["OA Issued"],
    deadlineKind: "office_action_response",
  },
  { key: "new_application", codes: [], text: [/new application/i], stageNames: ["Application Filed"], deadlineKind: null },
  {
    key: "pending_examination",
    codes: [],
    text: [/awaiting examination/i, /assigned to (an )?examin/i, /examining attorney/i],
    stageNames: AWAITING,
    deadlineKind: null,
  },
];

export const UNKNOWN_SUGGESTION: StageSuggestion = {
  key: "unknown",
  stageNames: [],
  deadlineKind: null,
  matchedBy: "none",
};

function from(row: Row, matchedBy: "code" | "text"): StageSuggestion {
  return { key: row.key, stageNames: row.stageNames, deadlineKind: row.deadlineKind, matchedBy };
}

/** The table-injectable core (tests use it to exercise code rows). Code and text must agree or the answer is unknown. */
export function suggestStageWith(
  table: readonly Row[],
  status: Pick<TsdrStatus, "statusCode" | "statusText">,
): StageSuggestion {
  const byCode = table.find((r) => r.codes.includes(status.statusCode));
  const text = status.statusText ?? "";
  const byText = text === "" ? undefined : table.find((r) => r.text.some((re) => re.test(text)));
  if (byCode && byText && byCode.key !== byText.key) {
    return { key: "unknown", stageNames: [], deadlineKind: null, matchedBy: "code+text-conflict" };
  }
  const row = byCode ?? byText;
  if (!row || row.stageNames.length === 0) return UNKNOWN_SUGGESTION;
  return from(row, byCode ? "code" : "text");
}

export function suggestStage(status: Pick<TsdrStatus, "statusCode" | "statusText">): StageSuggestion {
  return suggestStageWith(STAGE_MAP, status);
}
