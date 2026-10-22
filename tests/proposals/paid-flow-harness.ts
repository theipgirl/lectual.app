import { vi } from "vitest";
import type { ProposalRow } from "@/lib/proposals/types";
import type { StepPayload } from "@/lib/proposals/paid";
import { acceptedSnapshot, CONCIERGE } from "./accepted-fixture";
import { sevetri } from "./fixture";

/**
 * Shared by the Sprint 19 flow, action and page tests: an accepted proposal row, an in-memory event
 * store that behaves like the timeline (record -> list newest first), and `vi.doMock`s for every
 * collaborator of `paid-flow.ts` so a test can make exactly one of them fail.
 */

export const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";

export function acceptedRow(over: Partial<ProposalRow> = {}, snapshot = acceptedSnapshot({ classes: 2 })): ProposalRow {
  return {
    id: PROPOSAL_ID,
    org_id: "org-1",
    family_id: PROPOSAL_ID,
    version: 1,
    public_token: "t".repeat(43),
    lead_id: "lead-1",
    matter_id: "matter-1",
    client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com",
    title: "Trademark Proposal",
    status: "accepted",
    content: sevetri(),
    expires_on: "2026-11-10",
    pay_url: "https://pay.example/x",
    source: "manual",
    created_by: null,
    updated_by: null,
    approved_by: null,
    approved_at: null,
    sent_at: null,
    accepted_at: "2026-10-21T15:00:00Z",
    superseded_at: null,
    withdrawn_at: null,
    accepted_selection: snapshot.selection,
    accepted_snapshot: snapshot,
    created_at: "2026-10-18T12:00:00Z",
    updated_at: "2026-10-21T15:00:00Z",
    ...over,
  };
}

export type Opts = {
  proposal?: ProposalRow | null | "throw";
  /** Events already on the timeline. */
  events?: Array<{ payload: Record<string, unknown>; created_at?: string; actor?: string; actor_user_id?: string | null }>;
  eventsRead?: "fail";
  /** A write of this step's event fails (returns false). */
  recordFails?: string[];
  modules?: string[];
  matter?: { status: "one"; id: string; lawmaticsId: string | null } | { status: "none" } | { status: "many" } | { status: "unreadable" };
  token?: { status: "ok"; token: string } | { status: "not_connected" } | { status: "unavailable" };
  settings?: { pricing: Record<string, unknown> } | null | "fail";
  drafts?: Array<{ id: string; queue_item_id: string | null; status: string }> | null;
  generate?: "ok" | "flow-error" | "other-error";
  upload?: { ok: true } | { ok: false; reason: string; retryable: boolean; status?: number };
  fields?: { ok: true } | { ok: false; reason: string; retryable: boolean };
  noteResult?: { outcome: string; reason?: string };
  loeRetry?: { outcome: "uploaded" | "blocked" | "failed"; reason: string | null; recorded: boolean };
};

export async function setupFlow(opts: Opts = {}) {
  vi.resetModules();
  const proposal = opts.proposal === undefined ? acceptedRow() : opts.proposal;
  const events: Array<Record<string, unknown>> = [];
  let tick = 0;
  const push = (payload: Record<string, unknown>, extra: { created_at?: string; actor?: string; actor_user_id?: string | null } = {}) =>
    events.push({
      proposal_id: PROPOSAL_ID,
      type: "edited",
      actor: extra.actor ?? "staff",
      actor_user_id: extra.actor_user_id === undefined ? "u1" : extra.actor_user_id,
      created_at: extra.created_at ?? new Date(Date.UTC(2026, 9, 21, 16, 0, ++tick)).toISOString(),
      payload,
    });
  for (const e of opts.events ?? []) push(e.payload, e);

  const recorded: StepPayload[] = [];
  const store = {
    getProposalRow: vi.fn(async () => {
      if (proposal === "throw") throw new Error("db down");
      return proposal;
    }),
    listProposalStepEvents: vi.fn(async () => (opts.eventsRead === "fail" ? { ok: false } : { ok: true, events: [...events].reverse() })),
    recordProposalStep: vi.fn(async (_p: unknown, payload: StepPayload) => {
      if (opts.recordFails?.includes(String(payload.step))) return false;
      recorded.push(payload);
      push(payload as Record<string, unknown>);
      return true;
    }),
    getProposalSettings: vi.fn(async () => {
      if (opts.settings === "fail") throw new Error("settings down");
      return opts.settings === undefined ? { pricing: { packages: [CONCIERGE] } } : opts.settings;
    }),
  };
  // After resetModules, so it is the same class paid-flow.ts sees for `instanceof`.
  const { DocumentFlowError } = await import("@/lib/documents/errors");
  const queueItem = { draftId: "draft-1", queueItemId: "queue-1" };
  const generateTrademarkLoe = vi.fn(async () => {
    if (opts.generate === "flow-error") throw new DocumentFlowError("Approvals aren't enabled for this firm yet — ask an admin to set up the approval queue before generating documents.");
    if (opts.generate === "other-error") throw new Error("duplicate key value violates unique constraint for sevetri@example.com");
    return queueItem;
  });
  const orgHasModule = vi.fn(async (m: string) => (opts.modules ?? ["document-center", "proposals"]).includes(m));
  const scoped = { marker: "scoped-client" };
  const resolveProposalMatter = vi.fn(async () => opts.matter ?? { status: "one" as const, id: "matter-1", lawmaticsId: "LM-MATTER-1" });
  const signedInLawmaticsToken = vi.fn(async () => opts.token ?? { status: "ok" as const, token: "TOKEN-ORG-1" });
  const uploadMatterFile = vi.fn(async () => opts.upload ?? { ok: true as const });
  const setProspectCustomFields = vi.fn(async () => opts.fields ?? { ok: true as const });
  const listDraftsForProposal = vi.fn(async () => (opts.drafts === undefined ? [] : opts.drafts));
  const addAcceptanceNote = vi.fn(async () => opts.noteResult ?? { outcome: "added" });
  const retryLoeFileUpload = vi.fn(async () => opts.loeRetry ?? { outcome: "uploaded" as const, reason: null, recorded: true });

  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => scoped) }));
  vi.doMock("@/lib/proposals/store", () => store);
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/documents/generate", () => ({ generateTrademarkLoe }));
  vi.doMock("@/lib/documents/store", () => ({ listDraftsForProposal }));
  vi.doMock("@/lib/proposals/lawmatics-access", async () => {
    const actual = await vi.importActual<typeof import("@/lib/proposals/lawmatics-access")>("@/lib/proposals/lawmatics-access");
    return { ...actual, resolveProposalMatter, signedInLawmaticsToken };
  });
  vi.doMock("@/lib/lawmatics/writes", () => ({ uploadMatterFile, setProspectCustomFields }));
  vi.doMock("@/lib/proposals/accept-followups", () => ({ addAcceptanceNote }));
  vi.doMock("@/lib/proposals/loe-upload", () => ({ retryLoeFileUpload }));

  const flow = await import("@/lib/proposals/paid-flow");
  return {
    flow,
    store,
    events,
    recorded,
    spies: { generateTrademarkLoe, uploadMatterFile, setProspectCustomFields, orgHasModule, resolveProposalMatter, signedInLawmaticsToken, listDraftsForProposal, addAcceptanceNote, retryLoeFileUpload },
    stepsRecorded: () => recorded.map((p) => `${p.step}:${p.outcome}`),
    latest: (step: string) => [...recorded].reverse().find((p) => p.step === step),
  };
}
