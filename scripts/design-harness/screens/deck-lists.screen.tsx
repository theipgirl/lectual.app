import { DeckView } from "@/app/dashboard/queue/deck/deck-view";
import { state } from "../state";
import { resetState, queueItem, pending, approved, OWNER_ID } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";
import type { CardEvent } from "@/lib/queue/deck";

const DANA = "00000000-0000-4000-8000-0000000000a2";
const SAM = "00000000-0000-4000-8000-0000000000a3";

/** Decided today (one approved email, one briefing, one rejected, one engagement letter), two hand-offs (one sent back), one Later. */
function setup() {
  state.approved = [
    queueItem({ id: "d1", headline: "Maya Chen · CRUMB & CO. proposal", status: "approved", resolved_by: "rebecca@rpb.example", resolved_at: "2026-11-10T12:12:00Z", resolution_note: "Receipt: sha256 0123456789ab" }),
    queueItem({ id: "d2", headline: "Morning brief for Monday, Nov 10", agent: "morning-brief", type: "BRIEFING", status: "approved", resolved_by: "rebecca@rpb.example", resolved_at: "2026-11-10T12:15:00Z" }),
    ...approved,
  ];
  state.rejected = [
    queueItem({ id: "d3", headline: "Sam Lee · LUMEN TEA follow-up", agent: "morning-brief", status: "rejected", resolved_by: "rebecca@rpb.example", resolved_at: "2026-11-10T12:20:00Z", resolution_note: "Answers an older email. Redo after Sam's Nov 9 reply." }),
  ];
  const events: CardEvent[] = [
    { queueItemId: "q4", kind: "handoff", actorId: OWNER_ID, targetUserId: DANA, until: null, note: "Check the class descriptions before this goes out", createdAt: "2026-11-10T12:24:00Z" },
    { queueItemId: "q5", kind: "handoff", actorId: OWNER_ID, targetUserId: SAM, until: null, note: null, createdAt: "2026-11-07T15:00:00Z" },
    { queueItemId: "q5", kind: "returned", actorId: SAM, targetUserId: null, until: null, note: null, createdAt: "2026-11-10T14:02:00Z" },
    { queueItemId: "q6", kind: "later", actorId: OWNER_ID, targetUserId: null, until: "2026-11-10T19:00:00Z", note: null, createdAt: "2026-11-10T13:30:00Z" },
  ];
  state.cardState = { status: "ok", events };
  state.pending = pending.length ? pending : [queueItem({ id: "q9", headline: "x" })];
}

const mk = (id: string, title: string, designBoard: string, search: Record<string, string>, phone = false, prep: () => void = setup): Screen => ({
  id,
  title,
  designBoard,
  viewport: phone ? "phone" : "desktop",
  pathname: "/dashboard/queue/deck/",
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/queue/deck/";
    (state as { queueStatus?: string }).queueStatus = undefined;
    prep();
  },
  render: async () => <OwnerShell>{await DeckView({ searchParams: Promise.resolve(search) })}</OwnerShell>,
  note: "Build side only unless $DESIGN_SHOTS holds P2Lists / P2Later. Sample names and times are the harness's own.",
});

export const screens: Screen[] = [
  mk("deck-lists-decided", "Deck lists, Decided and Handed off", "P2Lists", { list: "decided" }),
  mk("deck-lists-later", "Deck lists, Later chip", "P2Lists", { list: "later" }),
  mk("deck-lists-failed", "Deck lists, sources failed", "P2Lists", { list: "decided" }, false, () => {
    setup();
    (state as { queueStatus?: string }).queueStatus = "unavailable";
  }),
  mk("deck-side-later", "Deck side column, three sections", "P2Later", {}),
  mk("deck-lists-phone", "Phone deck lists", "PhoneP2", { list: "decided" }, true),
];
