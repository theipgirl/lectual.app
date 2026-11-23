import { describe, expect, it, vi } from "vitest";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import type { InternalMail } from "@/lib/mail/internal-mail";

vi.mock("next/server", () => ({ after: () => {} }));

/**
 * The staff Try again path (`paid-flow.ts`) for a LINK signature (Sprint B): the three signed-letter steps run on the caller's SCOPED
 * client. The Lawmatics filing now carries the certificate page (Sprint A recorded it `failed` until then); the signed copy email is a
 * RETRY of the owner-approved email (same address, same words, same key); the Lectual file goes through the scoped client.
 */
const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENV = { LOE_EMAIL_SIGNING: "on", RESEND_API_KEY: "re_test_key", FIRM_CLIENT_MAIL_FROM: JSON.stringify({ [ORG]: "Sample Firm <signing@firm.example.org>" }) };

async function load(over: { snapshot?: (s: AcceptedSnapshot) => AcceptedSnapshot; priorSteps?: Array<Record<string, unknown>>; env?: Record<string, string> } = {}) {
  vi.resetModules();
  const { acceptedProposalRow } = await import("../signed-fixtures");
  const { linkSnapshot, evidenceFor, SENT_TO } = await import("./evidence-fixtures");
  const snapshot = (over.snapshot ?? ((s) => s))(linkSnapshot());
  const proposal = { ...acceptedProposalRow(snapshot), org_id: ORG, client_email: "changed-later@example.com" };
  const evidence = evidenceFor(snapshot, { request: { proposal_id: proposal.id, org_id: ORG } });
  const recorded: Array<Record<string, unknown>> = [];
  const uploads: string[] = [];
  const mails: InternalMail[] = [];
  const inserted: Array<{ table: string; row: unknown }> = [];
  const queries: Array<{ table: string; columns: string }> = [];
  const scoped = {
    from(table: string) {
      const rows = (): unknown[] => (table === "client_proposal_signing_request" ? [evidence.request] : table === "client_proposal_signing_event" ? evidence.events : []);
      const q: Record<string, unknown> = {
        select: (columns: string) => {
          queries.push({ table, columns });
          return q;
        },
        eq: () => q,
        order: () => q,
        limit: () => q,
        insert: async (row: unknown) => {
          inserted.push({ table, row });
          return { error: null };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return q;
    },
    storage: { from: () => ({ upload: async (path: string) => (uploads.push(path), { error: null }), remove: async () => ({ error: null }) }) },
  };
  const all: Array<Record<string, unknown>> = [...(over.priorSteps ?? [])];
  const uploadMatterFile = vi.fn(async (_t: unknown, file: { bytes: Uint8Array }) => (uploads.push(`lawmatics:${Buffer.from(file.bytes.slice(0, 4)).toString()}`), { ok: true }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => scoped) }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposalRow: vi.fn(async () => proposal),
    listProposalStepEvents: vi.fn(async () => ({ ok: true, events: [...all].reverse() })),
    recordProposalStep: vi.fn(async (_p: unknown, payload: Record<string, unknown>) => (recorded.push(payload), true)),
    getProposalSettings: vi.fn(async () => ({ pricing: {} })),
  }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => true) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/documents/generate", () => ({ generateTrademarkLoe: vi.fn() }));
  vi.doMock("@/lib/documents/store", () => ({ listDraftsForProposal: vi.fn(async () => []) }));
  vi.doMock("@/lib/loe/staff-firm", () => ({ loadStaffFirmFacts: vi.fn(async () => ({ status: "ok", displayName: "Sample Firm", timeZone: "America/New_York" })) }));
  vi.doMock("@/lib/proposals/lawmatics-access", async () => {
    const actual = await vi.importActual<typeof import("@/lib/proposals/lawmatics-access")>("@/lib/proposals/lawmatics-access");
    return { ...actual, signedInLawmaticsToken: vi.fn(async () => ({ status: "ok", token: "SIGNED-IN-TOKEN" })), resolveProposalMatter: vi.fn() };
  });
  vi.doMock("@/lib/lawmatics/writes", () => ({ uploadMatterFile, setProspectCustomFields: vi.fn() }));
  vi.doMock("@/lib/proposals/accept-followups", () => ({ addAcceptanceNote: vi.fn(), resolveNoteTarget: vi.fn(async () => ({ ok: true, notableType: "Prospect", notableId: "LM-77" })) }));
  vi.doMock("@/lib/proposals/loe-upload", () => ({ retryLoeFileUpload: vi.fn() }));
  vi.doMock("@/lib/mail/internal-mail", () => ({ sendInternalMail: vi.fn(async (m: InternalMail) => (mails.push(m), { status: "sent" })) }));
  vi.doMock("@/lib/proposals/signed-copy-email", async () => {
    const actual = await vi.importActual<typeof import("@/lib/proposals/signed-copy-email")>("@/lib/proposals/signed-copy-email");
    return { ...actual, deploymentMailEnv: () => over.env ?? ENV };
  });
  const flow = await import("@/lib/proposals/paid-flow");
  return { flow, proposal, recorded, uploads, mails, inserted, queries, SENT_TO };
}

describe("staff Try again for a link signature", () => {
  it("signed_loe_upload now uploads the letter WITH its certificate through the signed-in client", async () => {
    const t = await load({ priorSteps: [{ proposal_id: "44444444-4444-4444-8444-444444444444", type: "edited", actor: "system", actor_user_id: null, created_at: "2026-11-12T19:15:00.000Z", payload: { step: "signed_loe_upload", outcome: "failed", reason: "unexpected error" } }] });
    await t.flow.retryProposalStep(t.proposal.id, "signed_loe_upload");
    expect(t.uploads).toEqual(["lawmatics:%PDF"]);
    expect(t.recorded.map((r) => `${r.step}:${r.outcome}`)).toEqual(["signed_loe_upload:uploaded"]);
  });

  it("signed_copy_email is a retry of the same email: to the sent event's address, snapshotted words, round key", async () => {
    const t = await load();
    await t.flow.retryProposalStep(t.proposal.id, "signed_copy_email");
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0].to).toEqual([t.SENT_TO]);
    expect(t.mails[0].subject).toBe("Your signed letter from Sample Firm");
    expect(t.mails[0].idempotencyKey).toMatch(/^signed-copy:11111111-2222-4333-8444-555555555555:0$/);
    expect(t.recorded.map((r) => `${r.step}:${r.outcome}`)).toEqual(["signed_copy_email:sent"]);
    // The REQUEST is read through the signed-in client's granted columns only (the events table is fully granted).
    const cols = t.queries.filter((q) => q.table === "client_proposal_signing_request").map((q) => q.columns).join(" | ");
    for (const never of ["token_sha256", "agreement_text", "agreement_sha256", "consent_sha256"]) expect(cols).not.toContain(never);
  });

  it("retrying a step that already succeeded does nothing", async () => {
    const t = await load({ priorSteps: [{ proposal_id: "44444444-4444-4444-8444-444444444444", type: "edited", actor: "system", actor_user_id: null, created_at: "2026-11-12T19:15:00.000Z", payload: { step: "signed_copy_email", outcome: "sent" } }] });
    const r = await t.flow.retryProposalStep(t.proposal.id, "signed_copy_email");
    expect(t.mails).toEqual([]);
    expect(t.recorded).toEqual([]);
    expect(r).toMatchObject({ ok: true, notes: expect.any(Array) });
  });

  it("with the switch off the retry records `skipped` and sends nothing", async () => {
    const t = await load({ env: { ...ENV, LOE_EMAIL_SIGNING: "" } });
    await t.flow.retryProposalStep(t.proposal.id, "signed_copy_email");
    expect(t.mails).toEqual([]);
    expect(t.recorded.map((r) => `${r.step}:${r.outcome}`)).toEqual(["signed_copy_email:skipped"]);
  });

  it("signed_loe_file files through the scoped client under the proposal's matter", async () => {
    const t = await load();
    await t.flow.retryProposalStep(t.proposal.id, "signed_loe_file");
    expect(t.recorded.map((r) => `${r.step}:${r.outcome}`)).toEqual(["signed_loe_file:filed"]);
    expect(t.uploads).toHaveLength(1);
    expect(t.uploads[0]).toMatch(new RegExp(`^${ORG}/matter/matter-1/[0-9a-f-]{36}\\.pdf$`));
    expect(t.inserted.map((i) => i.table)).toEqual(["crm_file", "crm_activity"]);
  });

  it("an in-app signature has no signed copy to email and nothing to file here: a note, no event, no send", async () => {
    const t = await load({ snapshot: (s) => ({ ...s, agreement: { ...s.agreement!, method: undefined, signing_request_id: undefined } }) });
    for (const step of ["signed_copy_email", "signed_loe_file"] as const) await t.flow.retryProposalStep(t.proposal.id, step);
    expect(t.mails).toEqual([]);
    expect(t.recorded).toEqual([]);
    expect(t.uploads).toEqual([]);
  });
});
