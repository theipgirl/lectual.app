import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: () => {} }));

import { buildVerifiedSignedPdf } from "@/lib/loe/signed-pdf";
import { runStaffDownload, STAFF_DOWNLOAD_MESSAGES } from "@/lib/loe/staff-download";
import { PDF_MESSAGES } from "@/lib/loe/client-words";
import { signedLetterPdf } from "@/lib/proposals/public-letter";
import { runAcceptanceFollowups } from "@/lib/proposals/accept-followups";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import type { MultipartFetchLike } from "@/lib/lawmatics/writes";
import { fakeFollowupDb, type Row } from "../../proposals/followup-db";
import { acceptedProposalRow, signedTrademark } from "../signed-fixtures";
import { NOW, TOKEN, world } from "../../proposals/signing-world";

/** T17 (v2 ruling B6): until Sprint B adds the certificate page, no signed PDF exists for a letter signed by the emailed link. */

const linkSigned = (): AcceptedSnapshot => {
  const s = signedTrademark();
  return { ...s, agreement: { ...s.agreement!, method: "email_link", signing_request_id: "11111111-2222-4333-8444-555555555555" } };
};

describe("T17 a link-signed snapshot has no PDF in Sprint A", () => {
  it("buildVerifiedSignedPdf answers unavailable before any read", async () => {
    const readStored = vi.fn(async () => null);
    expect(await buildVerifiedSignedPdf({ snapshot: linkSigned(), firm: { displayName: "Sample Firm", timeZone: "America/New_York" }, readStored })).toEqual({ ok: false, reason: "unavailable" });
    expect(readStored).not.toHaveBeenCalled();
  });
  it("an in-app (no method) snapshot still builds", async () => {
    const r = await buildVerifiedSignedPdf({ snapshot: signedTrademark(), firm: { displayName: "Sample Firm", timeZone: "America/New_York" }, readStored: async () => null });
    expect(r.ok).toBe(true);
  });
  it("the staff Download answers its existing 'couldn't be made' sentence", async () => {
    const r = await runStaffDownload(
      {
        gate: async () => null,
        getProposal: async () => acceptedProposalRow(linkSigned()),
        firmFacts: async () => ({ status: "ok", displayName: "Sample Firm", timeZone: "America/New_York" }) as const,
        readStored: async () => null,
      },
      "44444444-4444-4444-8444-444444444444",
    );
    expect(r).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable });
  });
  it("the client's signed download answers its existing 'try again' sentence", async () => {
    const w = world({ proposal: { status: "accepted", accepted_snapshot: linkSigned(), accepted_selection: linkSigned().selection, expires_on: "2026-12-31" } });
    expect(await signedLetterPdf(TOKEN, NOW, { db: w.db, ip: "203.0.113.1" })).toEqual({ ok: false, message: PDF_MESSAGES.unavailable });
  });
  it("signed_loe_upload records `failed` (retried later), uploads nothing", async () => {
    const tables: Record<string, Row[]> = {
      client_proposal: [{ id: "p1", org_id: "org-1", family_id: "f1", status: "accepted", client_name: "Sample Client", client_email: "client@example.com", lead_id: null, matter_id: "m1", accepted_snapshot: linkSigned() }],
      client_proposal_setting: [{ org_id: "org-1", approver_user_ids: ["u1"] }],
      crm_org_member: [{ org_id: "org-1", user_id: "u1", role: "owner" }],
      crm_matter: [{ id: "m1", org_id: "org-1", lawmatics_id: "LM-77" }],
      crm_lead: [],
      crm_org: [{ id: "org-1", name: "Sample Firm" }],
      crm_org_profile: [{ org_id: "org-1", display_name: "Sample Firm", time_zone: "America/New_York" }],
      client_proposal_event: [],
      crm_notification: [],
    };
    const { db } = fakeFollowupDb(tables);
    const sent: string[] = [];
    const uploadFetch: MultipartFetchLike = async (url) => {
      sent.push(String(url));
      return { ok: true, status: 200 } as Awaited<ReturnType<MultipartFetchLike>>;
    };
    await runAcceptanceFollowups(db as never, { proposalId: "p1", orgId: "org-1" }, { getToken: async () => "FIRM-TOKEN", uploadFetch, fetchImpl: async () => ({ ok: true, status: 200 }) as never });
    const filed = tables.client_proposal_event.filter((e) => (e.payload as Row).step === "signed_loe_upload").map((e) => (e.payload as Row).outcome);
    expect(filed).toEqual(["failed"]);
    expect(sent).toEqual([]);
  });
});
