import type { ReviewRow } from "@/lib/review/buckets";

export const TODAY = "2026-11-02";

export function row(over: Partial<ReviewRow> & { key?: string }): ReviewRow {
  const key = over.key ?? "m-1";
  return {
    key,
    kind: "matter",
    id: "00000000-0000-4000-8000-000000000001",
    href: `/dashboard/matters/${key}/`,
    client: "Acme",
    mark: null,
    stageLabel: "Application Preparation",
    stageDays: 5,
    stageNote: null,
    stageOrder: 100_010,
    assignedTo: null,
    contactKnown: true,
    lastContact: { date: "2026-10-30", type: "email_sent" },
    waiting: "client",
    lastDirection: "we",
    nextStep: { id: "t1", title: "Call back", dueDate: "2026-11-20", assigneeId: null },
    deadline: null,
    ...over,
  };
}
