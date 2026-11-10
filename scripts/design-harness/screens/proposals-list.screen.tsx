import { vi } from "vitest";
import { state } from "../state";
import { resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

// ~40 invented proposals so the list box has to scroll (the real page and table, loaders mocked).
const NAMES = ["Alder & Finch", "Bluebird Bakery", "Cobalt Yarns", "Driftwood Labs", "Ember Row", "Fernhill Tea", "Garnet Studio", "Harbor Lane", "Ivory Kite", "Juniper Mill"];
const STATUSES = ["draft", "approved", "sent", "sent", "accepted", "withdrawn"] as const;

function sampleRows() {
  return Array.from({ length: 40 }, (_, i) => {
    const status = STATUSES[i % STATUSES.length];
    const id = `p${String(i + 1).padStart(2, "0")}`;
    return {
      id,
      family_id: `${id.padEnd(8, "0")}-0000-4000-8000-000000000000`,
      version: 1,
      client_name: `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
      title: "Trademark Proposal",
      status,
      source: "manual",
      expires_on: "2026-11-30",
      lead_id: null,
      matter_id: null,
      approved_at: null,
      sent_at: null,
      accepted_at: status === "accepted" ? "2026-11-02T15:00:00Z" : null,
      created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      updated_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      brands: [NAMES[i % NAMES.length]],
      offered: [{ name: "Concierge", legalAtSigningCents: 495_000, usptoAtFilingCents: 70_000 }],
      class_count: 2,
      signed_package: null,
      package_basis: null,
      legal_total_cents: 495_000,
      gov_total_cents: 70_000,
      blocking_issue: null,
    };
  });
}

const prepare = () => {
  resetState();
  state.pathname = "/dashboard/proposals/";
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: async () => undefined }));
  vi.doMock("@/lib/auth/current-role", () => ({ currentRole: async () => "owner" }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
  vi.doMock("@/lib/proposals/store", () => ({
    listProposals: async () => sampleRows(),
    listLatestProposalEvents: async () => new Map(),
    listStepActivity: async (ids: string[]) => new Map(ids.map((id) => [id, { paid: { state: "not_paid", undoneAt: null }, newest: null }])),
    listProposalOpens: async () => new Map(),
    getProposalSettings: async () => ({ pricing: { packages: [] }, default_pay_url: null }),
  }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));
  vi.doMock("@/lib/proposals/consults-load", () => ({
    loadConsultsStrip: async () => ({ header: { title: "Zoom consults", status: { kind: "connected", text: "connected" } }, meetings: { status: "ok", rows: [], more: 0 } }),
  }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: async () => ({ status: "ok", leads: [] }) }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: async () => null }));
  vi.doMock("@/app/dashboard/proposals/transcript-actions", () => ({ draftProposalFromUploadAction: async () => undefined, draftProposalFromMeetingAction: async () => undefined }));
};

const render = async () => {
  const { default: Page } = await import("@/app/dashboard/proposals/page");
  return <OwnerShell>{await Page({ searchParams: Promise.resolve({}) })}</OwnerShell>;
};

export const screens: Screen[] = [
  { id: "proposals-list", title: "Proposals list, 40 rows (desktop)", designBoard: "Main", viewport: "desktop", pathname: "/dashboard/proposals/", prepare, render, note: "Real ProposalsPage, loaders mocked, invented names." },
  { id: "proposals-list-phone", title: "Proposals list, 40 rows (phone)", designBoard: "Main", viewport: "phone", pathname: "/dashboard/proposals/", prepare, render, note: "Same, 375px." },
];
