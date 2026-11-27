import { vi } from "vitest";
import { mockLayoutRead } from "./layout-mock";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The page.test.tsx harness, for the custom-column page tests: `loadReview`, the session, the record card and the card's own custom
 * read are mocked; everything else is the real page. Invented names only.
 */
const STAGES = [
  { id: "s-new", name: "Potential New Client", category: "open", order_index: 1 },
  { id: "s-consult", name: "Consult Scheduled", category: "open", order_index: 2 },
  { id: "s-won", name: "Signed LOE", category: "won", order_index: 3 },
];

export const spies = {
  loadReview: vi.fn(),
  cardCustom: vi.fn(),
  cardLoad: vi.fn(),
};

export function mockPage(opts: { load: unknown; role: string | null; roleViews?: boolean; card?: unknown; cardCustom?: unknown; staff?: boolean; /** The firm's lead stages for "Add a lead" (null: the read fails). */ stages?: unknown[] | null; /** The caller's membership row says owner (the column menu is drawn). Default: not. */ owner?: boolean }) {
  spies.loadReview = vi.fn(async () => opts.load);
  spies.cardLoad = vi.fn(async () => opts.card ?? { status: "not-found" });
  spies.cardCustom = vi.fn(async () => opts.cardCustom ?? { status: "ok", fields: [], values: [], mergedInto: {}, leadOfMatter: {} });
  vi.doMock("@/lib/review/load", () => ({ loadReview: spies.loadReview }));
  mockLayoutRead();
  vi.doMock("@/lib/pipeline/stages", () => ({ listStages: vi.fn(async () => { if (opts.stages === null) throw new Error("down"); return opts.stages ?? STAGES; }) }));
  vi.doMock("@/lib/views/layout/owner-load", () => ({ loadOwnerState: vi.fn(async () => (opts.owner ? "owner" : "not-owner")) }));
  vi.doMock("@/lib/custom-columns/card-load", () => ({ loadCardCustomColumns: spies.cardCustom }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () =>
      opts.role === null
        ? { kind: "signed-out", redirectTo: "/" }
        : { kind: "ok", role: opts.role, user: { id: "u-reb", user_metadata: {} }, org: { id: "o1", modules: opts.roleViews ? ["role-views"] : [] }, actingAsStaff: opts.staff === true },
    ),
  }));
  vi.doMock("@/app/dashboard/review/actions", () => ({
    setNextStepAction: vi.fn(), completeNextStepAction: vi.fn(), logWhatHappenedAction: vi.fn(), closeLeadAction: vi.fn(),
    addLeadFromReviewAction: vi.fn(), updateNextStepAction: vi.fn(), snoozeNextStepAction: vi.fn(), moveStageAction: vi.fn(), assignRecordAction: vi.fn(), setSourceAction: vi.fn(),
  }));
  vi.doMock("@/lib/record-card/load", () => ({ loadRecordCard: spies.cardLoad }));
  vi.doMock("@/lib/review/sheet-edit-load", () => ({ loadSheetStages: vi.fn(async () => ({ matter: [], lead: [] })) }));
  vi.doMock("@/lib/review/detail-load", () => ({
    loadLatestNote: vi.fn(async () => ({ status: "ok", text: "" })),
    loadDeckDocuments: vi.fn(async () => ({ ok: true, read: { files: { status: "ok", files: [], capped: false }, letters: null } })),
  }));
}

export async function renderPage(params: Record<string, string> = {}) {
  const { default: Page } = await import("../../src/app/dashboard/review/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}
