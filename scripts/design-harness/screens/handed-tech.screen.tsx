import QueuePage from "@/app/dashboard/queue/page";
import QueueItemPage from "@/app/dashboard/queue/[id]/page";
import { state } from "../state";
import { resetState, pending, queueItem } from "../fixtures";
import { TechShell } from "./legibility-tech.screen";
import type { FirmSession } from "@/lib/firm/session";
import { ORG, session } from "../fixtures";
import type { Screen } from "../registry";

/**
 * Phase 2 item 2, TECHNICIAN shell: the Approvals page with a card handed to the viewer (marker on the row + the "Handed to you" pill),
 * and the approval page's "Handed to you by ... / Send back to ..." card. The viewer is a paralegal (Sam), who may edit but not approve a
 * follow-up, so the "can't approve" sentence shows. The design board P2MyCards is the owner-less "my cards" mock; there is no board for
 * these two technician pages, so the pairs are a look-alike check of the Send back move, not a pixel target.
 */
const REBECCA = "00000000-0000-4000-8000-0000000000a1";
const SAM = "00000000-0000-4000-8000-0000000000a3";
const members = [
  { userId: REBECCA, role: "owner", displayName: "Rebecca Ames", email: "rebecca@rpb.example" },
  { userId: SAM, role: "paralegal", displayName: "Sam Ortiz", email: "sam@rpb.example" },
];

const lumen = queueItem({
  id: "q2",
  headline: "Follow up with Sam Lee about LUMEN TEA",
  agent: "morning-brief",
  type: "CLIENT_EMAIL",
  client_name: "Sam Lee · LUMEN TEA",
  recipient: "sam@lumentea.example",
  subject: "Your opinion letter questions",
  draft_body: "Hi Sam,\n\nJust checking in on the questions we sent last week about your opinion letter for LUMEN TEA. When you have a moment, a reply would help us move your filing forward.\n\nBest,\nRebecca",
  summary: "CHECK FIRST: Sam replied Nov 9. Read it before deciding.\nOpinion letter was sent Nov 3.",
  created_at: "2026-11-08T11:58:00Z",
});

function arrange(path: string) {
  resetState();
  state.pathname = path;
  state.pending = [lumen, ...pending.filter((p) => p.id !== "q2")];
  Object.assign(state, {
    queueViewer: { userId: SAM, role: "paralegal" },
    queueMembers: members,
    queueRole: "paralegal",
  });
  state.cardState = {
    status: "ok",
    events: [{ queueItemId: "q2", kind: "handoff", actorId: REBECCA, targetUserId: SAM, until: null, note: "Can you check the dates in this one before I look? Thanks.", createdAt: "2026-11-10T13:05:00Z" }],
  };
}

const inTechShell = async (node: () => Promise<React.ReactNode>) => {
  const live = session as Extract<FirmSession, { kind: "ok" }>;
  const before = live.org;
  (live as { org: typeof ORG }).org = { ...ORG, modules: ORG.modules.filter((m) => m !== "role-views") };
  try {
    return <TechShell>{await node()}</TechShell>;
  } finally {
    live.org = before;
  }
};

const base = { designBoard: "P2MyCards", shell: "none" as const };

export const screens: Screen[] = [
  {
    ...base,
    id: "handed-list-desktop",
    title: "Approvals, a card handed to you (technician)",
    viewport: "desktop",
    pathname: "/dashboard/queue/",
    prepare: () => arrange("/dashboard/queue/"),
    render: () => inTechShell(async () => QueuePage({ searchParams: Promise.resolve({ who: "all" }) })),
  },
  {
    ...base,
    id: "handed-list-phone",
    title: "Approvals, a card handed to you (technician, phone)",
    viewport: "phone",
    pathname: "/dashboard/queue/",
    prepare: () => arrange("/dashboard/queue/"),
    render: () => inTechShell(async () => QueuePage({ searchParams: Promise.resolve({ who: "all" }) })),
  },
  {
    ...base,
    id: "handed-item-desktop",
    title: "Approval page, Send back (technician)",
    viewport: "desktop",
    pathname: "/dashboard/queue/q2/",
    prepare: () => arrange("/dashboard/queue/q2/"),
    render: () => inTechShell(async () => QueueItemPage({ params: Promise.resolve({ id: "q2" }), searchParams: Promise.resolve({}) })),
  },
  {
    ...base,
    id: "handed-item-phone",
    title: "Approval page, Send back (technician, phone)",
    viewport: "phone",
    pathname: "/dashboard/queue/q2/",
    prepare: () => arrange("/dashboard/queue/q2/"),
    render: () => inTechShell(async () => QueueItemPage({ params: Promise.resolve({ id: "q2" }), searchParams: Promise.resolve({}) })),
  },
];
