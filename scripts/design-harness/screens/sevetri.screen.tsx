import { vi } from "vitest";
import { createElement } from "react";
import { state } from "../state";
import { resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";
import { sevetriCustom } from "../../../tests/proposals/sevetri-custom-fixture";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import { offeredPackages } from "@/lib/proposals/segments";
import type { ProposalRow } from "@/lib/proposals/types";

vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.example" }));
// next/font only runs inside Next: stand in with plain classes and load the two real faces from Google Fonts.
vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "sev-f-head", className: "sev-f-head" }),
  Source_Serif_4: () => ({ variable: "sev-f-body", className: "sev-f-body" }),
}));
const CLIENT_FONTS =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap">' +
  "<style>.sev-f-head{--font-cp-heading:'Bodoni Moda'}.sev-f-body{--font-cp-body:'Source Serif 4'}</style>";
const withFonts = (html: string) => CLIENT_FONTS + html;

const ID = "44444444-4444-4444-8444-444444444444";
const ACCEPTED_AT = "2026-11-05T15:00:00.000Z";

function accepted() {
  const content = sevetriCustom();
  const selection = defaultSelection(content);
  const quote = quoteProposal(content, selection);
  const snap = buildAcceptedSnapshot({ version: 1, content, selection, quote, acceptedAt: ACCEPTED_AT });
  return { content, selection, quote, snap };
}

function proposalRow(status: "sent" | "accepted"): ProposalRow {
  const a = accepted();
  return {
    id: ID, org_id: "o", family_id: ID, version: 1, public_token: "t".repeat(43), lead_id: "lead-9", matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status,
    content: a.content, expires_on: "2026-11-30", pay_url: "https://pay.example/x", source: "manual",
    created_by: null, updated_by: null, approved_by: null, approved_at: "2026-11-04T12:00:00Z", sent_at: "2026-11-04T12:05:00Z",
    accepted_at: status === "accepted" ? ACCEPTED_AT : null, superseded_at: null, withdrawn_at: null,
    accepted_selection: status === "accepted" ? a.selection : null, accepted_snapshot: status === "accepted" ? a.snap : null,
    created_at: "2026-11-03T12:00:00Z", updated_at: "2026-11-05T15:00:00Z",
  } as ProposalRow;
}

function listRows() {
  const a = accepted();
  const mk = (id: string, status: string, accept: boolean, client: string) => ({
    id, family_id: `${id}-0000-4000-8000-000000000000`, version: 1, client_name: client, title: "Trademark Proposal", status, source: "manual",
    expires_on: "2026-11-30", lead_id: null, matter_id: null, approved_at: null, sent_at: null,
    accepted_at: accept ? ACCEPTED_AT : null, created_at: "2026-11-03T12:00:00Z", updated_at: "2026-11-05T12:00:00Z",
    brands: a.content.names.map((n) => n.name), offered: offeredPackages(a.content), class_count: 4,
    signed_package: null, package_basis: null, legal_total_cents: a.quote.legal_total_cents, gov_total_cents: a.quote.gov_total_cents,
    blocking_issue: null, matter_title: null,
  });
  return [
    mk("p01", "accepted", true, "Sevetri Wilson"),
    mk("p02", "sent", false, "Sevetri Wilson (revised)"),
    mk("p03", "draft", false, "Sevetri Wilson (draft)"),
    { ...mk("p04", "sent", false, "Alder & Finch"), brands: ["Alder"], offered: [{ name: "Concierge", legalAtSigningCents: 495_000, usptoAtFilingCents: 70_000 }], class_count: 2, legal_total_cents: 495_000, gov_total_cents: 70_000 },
  ];
}

const baseMocks = () => {
  resetState();
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: async () => undefined }));
  vi.doMock("@/lib/auth/current-role", () => ({ currentRole: async () => "owner" }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));
};

const listPrepare = () => {
  baseMocks();
  state.pathname = "/dashboard/proposals/";
  vi.doMock("@/lib/proposals/store", () => ({
    listProposals: async () => listRows(),
    listLatestProposalEvents: async () => new Map(),
    listStepActivity: async (ids: string[]) => new Map(ids.map((id) => [id, { paid: { state: "not_paid", undoneAt: null }, newest: null }])),
    listProposalOpens: async () => new Map([["p02", { count: 4, lastAt: "2026-11-06T15:12:00Z" }]]),
    getProposalSettings: async () => ({ pricing: { packages: [] }, default_pay_url: null }),
  }));
  vi.doMock("@/lib/proposals/consults-load", () => ({
    loadConsultsStrip: async () => ({ header: { title: "Zoom consults", status: { kind: "connected", text: "connected" } }, meetings: { status: "ok", rows: [], more: 0 } }),
  }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: async () => ({ status: "ok", leads: [] }) }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: async () => null }));
  vi.doMock("@/app/dashboard/proposals/transcript-actions", () => ({ draftProposalFromUploadAction: async () => undefined, draftProposalFromMeetingAction: async () => undefined }));
};

const staffPrepare = (status: "sent" | "accepted") => () => {
  baseMocks();
  state.pathname = `/dashboard/proposals/${ID}/`;
  const proposal = proposalRow(status);
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: async () => ({ proposal, versions: [], events: status === "accepted" ? [{ id: "e1", org_id: "o", proposal_id: ID, family_id: ID, type: "accepted", actor: "client", actor_user_id: null, payload: {}, created_at: ACCEPTED_AT }] : [] }),
    getProposalSettings: async () => null,
    isCurrentUserApprover: async () => true,
    listProposalStepEvents: async () => ({ ok: true, events: [] }),
    listProposalOpens: async () => new Map([[ID, { count: 4, lastAt: "2026-11-06T15:12:00Z" }]]),
  }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ GOES_LIVE_ON_APPROVAL: "x", proposalSendBlock: async () => ({ blocked: false }) }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: async () => ({ status: "none" }) }));
  vi.doMock("@/lib/proposals/lead-link", () => ({ loadLeadLink: async (id: string | null) => (id ? { state: "linked", id, name: "Sevetri Wilson" } : { state: "none" }) }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: async () => ({ status: "ok", leads: [] }) }));
  vi.doMock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: async () => undefined, undoPaidAction: async () => undefined, retryUploadAction: async () => undefined }));
};

const listRender = async () => {
  const { default: Page } = await import("@/app/dashboard/proposals/page");
  return <OwnerShell>{await Page({ searchParams: Promise.resolve({}) })}</OwnerShell>;
};
const staffRender = async () => {
  const { default: Page } = await import("@/app/dashboard/proposals/[id]/page");
  return <OwnerShell>{await Page({ params: Promise.resolve({ id: ID }) })}</OwnerShell>;
};
const clientRender = (mode: "live" | "accepted") => async () => {
  const { ProposalDocument } = await import("@/components/client-proposal/ProposalDocument");
  const a = accepted();
  return createElement(ProposalDocument, {
    mode, content: a.content, title: "Trademark Proposal", clientName: "Sevetri Wilson", expiresOn: "2026-11-30",
    firm: { name: "RPB Law", slug: "rpb", displayName: "RPB Law", contactLine: "hello@rpb.example · (555) 010-0100" },
    ...(mode === "accepted" ? { initialSelection: a.selection, acceptedQuote: a.quote, payUrl: "https://pay.example/x" } : { onAccept: async () => ({ ok: true as const, payUrl: "https://pay.example/x" }) }),
  });
};

const S = (id: string, title: string, viewport: "desktop" | "phone", shell: "owner" | "none", prepare: () => void, render: Screen["render"], pathname = "/dashboard/proposals/"): Screen =>
  ({ id, title, designBoard: "none", viewport, shell, pathname, prepare, render, ...{ transformHtml: withFonts } });

export const screens: Screen[] = [
  S("sev-list-d", "Sevetri list (desktop)", "desktop", "owner", listPrepare, listRender),
  S("sev-list-p", "Sevetri list (phone)", "phone", "owner", listPrepare, listRender),
  S("sev-staff-d", "Sevetri staff page, accepted (desktop)", "desktop", "owner", staffPrepare("accepted"), staffRender),
  S("sev-staff-p", "Sevetri staff page, accepted (phone)", "phone", "owner", staffPrepare("accepted"), staffRender),
  S("sev-client-offer-d", "Sevetri client offer (desktop)", "desktop", "none", baseMocks, clientRender("live")),
  S("sev-client-offer-p", "Sevetri client offer (phone)", "phone", "none", baseMocks, clientRender("live")),
  S("sev-client-receipt-d", "Sevetri client receipt (desktop)", "desktop", "none", baseMocks, clientRender("accepted")),
  S("sev-client-receipt-p", "Sevetri client receipt (phone)", "phone", "none", baseMocks, clientRender("accepted")),
];
