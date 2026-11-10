/**
 * Vitest setup for the harness: mocks every loader / server-only edge the owner screens reach, so the REAL async server
 * pages and components render with fixed sample data. Nothing here touches a network or database.
 */
import { vi } from "vitest";
import { state } from "./state";
import { members, session } from "./fixtures";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "harness-anon-key";

class NotFound extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname ?? "/dashboard/",
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

vi.mock("@/lib/org/modules", async (orig) => ({
  ...(await orig<typeof import("@/lib/org/modules")>()),
  orgHasModule: async () => true,
  activeOrgModules: async () => ["role-views", "mailbox", "proposals", "agents", "document-center"],
}));
vi.mock("@/lib/org/profile", async (orig) => ({
  ...(await orig<typeof import("@/lib/org/profile")>()),
  getFirmTimeZone: async () => "America/New_York",
}));
vi.mock("@/lib/ai/claude", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/claude")>()),
  aiConfigured: () => true,
}));
vi.mock("@/lib/members/directory", async (orig) => ({
  ...(await orig<typeof import("@/lib/members/directory")>()),
  listMemberDirectory: async () => members,
}));
vi.mock("@/lib/firm/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/firm/session")>()),
  resolveFirmSession: async () => session,
}));

// Today
vi.mock("@/lib/queue/deck-summary", () => ({ loadDeckSummary: async () => state.deckSummary }));
vi.mock("@/lib/calendar/consult-sources", async (orig) => ({
  ...(await orig<typeof import("@/lib/calendar/consult-sources")>()),
  loadTodayConsults: async () => state.consults,
}));
vi.mock("@/lib/calendar/consult-sources-live", () => ({ liveConsultDeps: {} }));
vi.mock("@/lib/today/owner-load", () => ({
  loadOwnerDeadlines: async () => state.deadlines,
  loadOwnerProposals: async () => state.proposals,
}));

// Approval deck
vi.mock("@/lib/queue/load", async (orig) => ({
  ...(await orig<typeof import("@/lib/queue/load")>()),
  loadActiveQueue: async (status: "pending" | "approved" | "rejected" = "pending") => ({
    status: (status === "pending" ? (state as { queueStatus?: string }).queueStatus : undefined) ?? "ok",
    items: status === "pending" ? state.pending : status === "approved" ? state.approved : state.rejected,
  }),
}));
vi.mock("@/lib/queue/routing-load", () => ({
  loadApprovalRouting: async () => ({ status: "ok", routing: {}, members: [], dropped: 0, settingsExist: false }),
}));
vi.mock("@/lib/queue/card-state", () => ({ loadCardState: async () => state.cardState }));
vi.mock("@/lib/queue/audit-context", () => ({
  loadAuditContext: async () => ({ signOff: "Rebecca Ames", teamSignOff: null, memberNames: ["Rebecca Ames", "Dana Brook"] }),
}));
vi.mock("@/lib/queue/stale", async (orig) => ({
  ...(await orig<typeof import("@/lib/queue/stale")>()),
  checkDraftStaleness: async () => (state as { itemStale?: unknown }).itemStale ?? { status: "clear", leadIds: [], leadName: null, linkedBy: "draft" },
}));
vi.mock("@/lib/consult-proposal/link", async (orig) => ({
  ...(await orig<typeof import("@/lib/consult-proposal/link")>()),
  gateLinkedProposal: async () => ({ ok: true, proposal: null }),
  loadLinkedPanel: async () => ({ status: "none" }),
}));

// Approval item page (/dashboard/queue/[id]/)
vi.mock("@/lib/queue/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/queue/api")>()),
  getQueueItem: async (_k: string, id: string) => [...state.pending, ...state.approved, ...state.rejected].find((i) => i.id === id)!,
}));
vi.mock("@/lib/queue/org", async (orig) => ({ ...(await orig<typeof import("@/lib/queue/org")>()), activeQueueOrgKey: async () => "rpb" }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
vi.mock("@/lib/queue/roles", async (orig) => ({ ...(await orig<typeof import("@/lib/queue/roles")>()), resolveQueueRole: async () => "owner" }));
vi.mock("@/lib/queue/view-context", () => ({
  loadQueueViewContext: async () => ({ viewer: { userId: "00000000-0000-4000-8000-0000000000a1", role: "owner" }, routing: {}, members: [], routingFailed: false, dropped: 0, now: Date.parse("2026-11-10T14:30:00Z") }),
}));

// Lets a screen open the item page's draft editor (the page itself always starts in the rendered view).
vi.mock("@/components/queue/ReviewPanel", async (orig) => {
  const m = await orig<typeof import("@/components/queue/ReviewPanel")>();
  const { createElement } = await import("react");
  return {
    ...m,
    ReviewPanel: (p: Parameters<typeof m.ReviewPanel>[0]) =>
      createElement(m.ReviewPanel, { ...p, startEditing: Boolean(p.startEditing) || Boolean((state as { itemEditing?: boolean }).itemEditing) }),
  };
});

// Weekly review
vi.mock("@/lib/review/load", async (orig) => ({
  ...(await orig<typeof import("@/lib/review/load")>()),
  loadReview: async () => state.review,
}));
vi.mock("@/lib/review/detail-load", () => ({
  loadReviewDetail: async () => null,
  loadLatestNote: async () => null,
}));
