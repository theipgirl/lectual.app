export type LeadPendingApproval = { queueId: string; headline: string; kind: "rebecca_brief" | "client_draft" | "other"; createdAt: string | null };
export type LeadPendingApprovals =
  | { status: "ok"; byLead: Record<string, LeadPendingApproval[]> }
  | { status: "unconfigured" }
  | { status: "unavailable" };
