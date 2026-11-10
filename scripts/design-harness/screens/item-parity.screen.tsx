import QueueItemPage from "@/app/dashboard/queue/[id]/page";
import { state } from "../state";
import { resetState, queueItem, pending } from "../fixtures";
import type { Screen } from "../registry";

/**
 * Parity screens for the approval item page: the real page in bare wrappers, so the same file can be rendered on this branch and on
 * an older commit and compared pixel for pixel. "tech" = technician shell (no owner header class); "owner" = the owner shell's header
 * class is present (hidden, so only the page content is compared) which is what the owner-only CSS keys on.
 */
const sam = queueItem({
  id: "q2",
  headline: "Follow up with Sam Lee about LUMEN TEA",
  agent: "morning-brief",
  type: "CLIENT_EMAIL",
  client_name: "Sam Lee · LUMEN TEA",
  recipient: "sam@lumentea.example",
  subject: "Your opinion letter questions",
  draft_body: "Hi Sam,\n\nJust checking in on the questions we sent last week about your opinion letter for LUMEN TEA. When you have a moment, a reply would help us move your filing forward.\n\nBest,\nRebecca",
  summary: "CHECK FIRST: Sam replied Nov 9. Read it before deciding.\nOpinion letter was sent Nov 3.\nNo proposal is open.\nLast call was Oct 28.",
  created_at: "2026-11-08T11:58:00Z",
});

const mk = (id: string, owner: boolean, viewport: "desktop" | "phone", editing: boolean): Screen => ({
  id,
  title: id,
  designBoard: "PhoneItem",
  viewport,
  pathname: "/dashboard/queue/q2/",
  shell: "none",
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/queue/q2/";
    state.pending = [sam, ...pending.filter((p) => p.id !== "q2")];
    (state as { itemStale?: unknown }).itemStale = undefined;
    (state as { itemEditing?: boolean }).itemEditing = editing;
  },
  render: async () => {
    const page = await QueueItemPage({ params: Promise.resolve({ id: "q2" }), searchParams: Promise.resolve({}) });
    return (
      <div className="lx-app">
        {owner && <header className="lx-top lx-top--owner" style={{ display: "none" }} />}
        <div className="lx-main">
          <div className="lx-content">
            <div className="lx-page">{page}</div>
          </div>
        </div>
      </div>
    );
  },
});

export const screens: Screen[] = [
  mk("par-tech-desktop", false, "desktop", false),
  mk("par-tech-desktop-edit", false, "desktop", true),
  mk("par-tech-phone", false, "phone", false),
  mk("par-tech-phone-edit", false, "phone", true),
  mk("par-owner-desktop", true, "desktop", false),
  mk("par-owner-desktop-edit", true, "desktop", true),
];
