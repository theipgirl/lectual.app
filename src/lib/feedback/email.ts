import { FEEDBACK_SUBJECT_CHARS, FEEDBACK_TYPE_LABELS, type FeedbackType } from "./constants";
import { formatTrail, type Trail } from "./trail";

/** `[Lectual feedback] <Type>: <first 60 characters>`, on one line. */
export function feedbackSubject(type: FeedbackType, description: string): string {
  const oneLine = description.replace(/\s+/g, " ").trim().slice(0, FEEDBACK_SUBJECT_CHARS);
  return `[Lectual feedback] ${FEEDBACK_TYPE_LABELS[type]}: ${oneLine}`;
}

export type FeedbackContext = {
  firmName: string;
  orgId: string;
  senderEmail: string | null;
  role: string;
  actingAsStaff: boolean;
  vercelEnv: string | null;
  commitSha: string | null;
};

export function feedbackBody(input: { type: FeedbackType; description: string; context: FeedbackContext; trail: Trail | null }): string {
  const c = input.context;
  const lines = [
    `Type: ${FEEDBACK_TYPE_LABELS[input.type]}`,
    "",
    input.description,
    "",
    "-----",
    `Firm: ${c.firmName}${c.actingAsStaff ? " (sender is Lectual staff acting in this firm)" : ""}`,
    `Org id: ${c.orgId}`,
    `Sender: ${c.senderEmail ?? "unknown"}`,
    `Role: ${c.role}`,
    `Deployment: ${c.vercelEnv || "unknown"}${c.commitSha ? ` @ ${c.commitSha}` : ""}`,
    "",
    input.trail ? formatTrail(input.trail) : "Session transcript: none (it could not be read).",
  ];
  return lines.join("\n");
}
