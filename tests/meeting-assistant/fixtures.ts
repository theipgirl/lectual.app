import type { MeetingAssistantInput } from "@/lib/meeting-assistant";

export const TRANSCRIPT =
  "Okay, Maya Chen's Fold trademark. We should send the office action response by November 20 and Dana will take it. " +
  "Then the Ruiz Holdings matter: they still haven't signed, call them again on Friday.";

export const input: MeetingAssistantInput = {
  transcript: TRANSCRIPT,
  meetingId: "m1",
  meetingDate: "2026-11-16",
  rows: [
    { id: "r1", kind: "matter", client: "Maya Chen", mark: "The Fold", matterNumber: "TM-1", stage: "Office action", currentNextStep: null, assigneeId: null },
    { id: "r2", kind: "lead", client: "Ruiz Holdings", mark: null, matterNumber: null, stage: "Proposal sent", currentNextStep: "Follow up", assigneeId: "u2" },
  ],
  members: [
    { id: "u1", displayName: "Dana Lee" },
    { id: "u2", displayName: "Sam Ortiz" },
  ],
};

export const goodRaw = {
  proposals: [
    {
      record: { kind: "matter", id: "r1" },
      recordName: null,
      nextStep: "Send the office action response",
      dueDate: "2026-11-20",
      ownerId: "u1",
      note: "Dana takes it.",
      evidence: "send the office action response by November 20 and Dana will take it",
      confidence: "high",
    },
  ],
};
