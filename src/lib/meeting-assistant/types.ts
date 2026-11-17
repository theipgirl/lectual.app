/**
 * Meeting assistant (reader only): from one imported meeting's transcript and the firm's open Weekly review
 * rows, PROPOSE a next step, an owner and a note per record discussed. Pure types. There is no write path
 * here; a later sprint adds one-click accept.
 */

export type AssistantRowKind = "matter" | "lead";

/** A minimal projection of a Weekly review row (`ReviewRow`): only what the model needs to name a record. */
export type AssistantRow = {
  id: string;
  kind: AssistantRowKind;
  client: string;
  mark: string | null;
  matterNumber: string | null;
  stage: string | null;
  /** The current next step's title, if any. */
  currentNextStep: string | null;
  assigneeId: string | null;
};

export type AssistantMember = { id: string; displayName: string };

export type MeetingAssistantInput = {
  /** Privileged. Reaches the model only inside inert tags; never logged. */
  transcript: string;
  meetingId: string;
  /** YYYY-MM-DD, the meeting's date (gives a stated "Nov 20" its year). */
  meetingDate: string;
  rows: readonly AssistantRow[];
  members: readonly AssistantMember[];
};

export type ProposalRecord = { kind: AssistantRowKind; id: string } | "unmatched";
export type Confidence = "high" | "medium" | "low";

export type MeetingProposal = {
  record: ProposalRecord;
  /** What the model called an unmatched record, shown so a person can pick one. Never used as an id. */
  recordName: string | null;
  nextStep: string;
  /** YYYY-MM-DD, only when a date was stated in `evidence`. */
  dueDate: string | null;
  /** Always a given member's id, or null. */
  ownerId: string | null;
  note: string;
  /** A short verbatim quote from the transcript. Always really present in it. */
  evidence: string;
  confidence: Confidence;
  /** Fixed sentences about anything cleaned up (owner not a member, date not stated, ...). */
  flags: string[];
};

export const LIMITS = {
  nextStep: 200,
  note: 400,
  evidence: 300,
  recordName: 200,
  proposals: 50,
  /** Characters of transcript sent to the model; validation checks quotes against exactly this text. */
  transcript: 200_000,
  /** Rows sent to the model. */
  rows: 300,
} as const;

export type DropReason = "no_evidence" | "empty_step" | "duplicate" | "over_cap" | "malformed";
export type DropCounts = Record<DropReason, number>;

export type ValidationResult = { proposals: MeetingProposal[]; dropped: DropCounts };

export type MeetingAssistantResult =
  | { state: "ok"; proposals: MeetingProposal[]; dropped: DropCounts }
  | { state: "unavailable"; reason: string }
  | { state: "not-configured"; reason: string };
