import type { QueueItem } from "@/lib/queue/api";
import type { Role } from "@/lib/auth/roles";
import type { RoutingMember } from "@/lib/queue/routing";

export function qitem(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q1",
    org_id: "firm",
    matter_id: null,
    agent: "post-consult",
    type: "CLIENT_EMAIL",
    headline: "Post-consult follow-up — Ana",
    summary: null,
    draft_body: "Hi Ana,\n\nThanks for the call.\n\nBest,\nThe Team",
    final_body: null,
    status: "pending",
    created_at: "2026-10-20T12:00:00Z",
    client_name: "Ana",
    recipient: "ana@example.com",
    subject: "Next steps",
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}

export const FOLLOWUP = { agent: "morning-brief", headline: "Follow-up for a stalled lead: Bo" } as const;
export const followup = (over: Partial<QueueItem> = {}) => qitem({ ...FOLLOWUP, ...over });

export const U = {
  rebecca: "00000000-0000-4000-8000-000000000001",
  caitlyn: "00000000-0000-4000-8000-000000000002",
  taylor: "00000000-0000-4000-8000-000000000003",
  viewer: "00000000-0000-4000-8000-000000000004",
  ghost: "00000000-0000-4000-8000-000000000099",
};

const m = (userId: string, role: Role, displayName: string): RoutingMember => ({ userId, role, displayName, email: `${displayName.toLowerCase()}@example.com` });
export const MEMBERS: RoutingMember[] = [m(U.rebecca, "attorney", "Rebecca"), m(U.caitlyn, "paralegal", "Caitlyn"), m(U.taylor, "owner", "Taylor"), m(U.viewer, "viewer", "Vic")];
