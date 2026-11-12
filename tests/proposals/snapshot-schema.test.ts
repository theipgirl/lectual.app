import { describe, expect, it, vi } from "vitest";
import { acceptedProposalLines } from "@/lib/documents/accepted-proposal-docx";
import { acceptanceHeadline, acceptanceNoteBody, runAcceptanceFollowups } from "@/lib/proposals/accept-followups";
import { clientAddedClasses, clientDescribedClasses } from "@/lib/proposals/added-view";
import { loeInputFromAcceptedProposal } from "@/lib/proposals/loe-adapter";
import { loeIsCurrent, withLoeSnapshot } from "@/lib/proposals/loe-snapshot";
import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { acceptedSnapshot, CONCIERGE } from "./accepted-fixture";
import { fakeFollowupDb } from "./followup-db";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { withLoe } from "../loe/loe-fixtures";

vi.mock("next/server", () => ({ after: () => {} }));

/** The same acceptance as an old (schema 1) snapshot and as a signed (schema 2) one: every reader must take both. */
function both(): { v1: AcceptedSnapshot; v2: AcceptedSnapshot } {
  const plain = acceptedSnapshot({ classes: 2, marks: ["word", "logo"] });
  const content = withLoe(plain.content);
  const v1: AcceptedSnapshot = { ...plain, content: plain.content };
  const v2 = buildAcceptedSnapshot({
    version: plain.version,
    content,
    selection: plain.selection,
    quote: plain.quote,
    acceptedAt: plain.accepted_at,
    signed: {
      agreement: { signature_id: "sig-1", signer_name: "Sevetri Wilson", signed_at: "2026-10-21T15:00:05.000Z", sha256: "d".repeat(64), template_version: 3 },
      signing: { details: { ...TEST_DETAILS }, date_text: "October 21, 2026", client_email: "sevetri@example.com" },
    },
  });
  return { v1, v2 };
}

describe("the snapshot type and builder", () => {
  it("an unsigned acceptance stays schema 1, a signed one is schema 2 with the agreement block", () => {
    const { v1, v2 } = both();
    expect(v1.schema).toBe(1);
    expect(v1.agreement).toBeUndefined();
    expect(v2.schema).toBe(2);
    expect(Object.keys(v2.agreement!).sort()).toEqual(["sha256", "signature_id", "signed_at", "signer_name", "template_version"]);
  });
});

describe("every reader of the snapshot takes schema 1 and 2", () => {
  const facts = { clientName: "Sevetri Wilson", entityName: "Prosperall", timeZone: "America/New_York" };

  it("the accepted-proposal document", () => {
    const { v1, v2 } = both();
    const a = acceptedProposalLines(v1, facts);
    const b = acceptedProposalLines(v2, facts);
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
  });

  it("the LOE adapter (the old draft path)", () => {
    const { v1, v2 } = both();
    const input = { packages: [CONCIERGE], todayIso: "2026-10-22" };
    const a = loeInputFromAcceptedProposal(v1, input);
    const b = loeInputFromAcceptedProposal(v2, input);
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
  });

  it("the staff views of what the client added and described", () => {
    const { v1, v2 } = both();
    expect(clientAddedClasses(v2)).toEqual(clientAddedClasses(v1));
    expect(clientDescribedClasses(v2)).toEqual(clientDescribedClasses(v1));
  });

  it("the note and headline: only that it was signed, by whom and when", () => {
    const { v1, v2 } = both();
    const n1 = acceptanceNoteBody(v1, "Sevetri Wilson");
    const n2 = acceptanceNoteBody(v2, "Sevetri Wilson");
    expect(n1.body).not.toContain("Engagement letter signed");
    expect(n2.body).toContain("Engagement letter signed by Sevetri Wilson on 2026-10-21T15:00:05.000Z.");
    // Everything else in the note is identical; none of the letter, the details or the address is in it.
    expect(n2.body.replace(/\nEngagement letter signed[^\n]*$/, "")).toBe(n1.body);
    for (const never of ["100 Example Street", "Miami", "Dear ", "sevetri@example.com", "d".repeat(64)]) expect(n2.body).not.toContain(never);
    expect(acceptanceHeadline({ clientName: "Sevetri Wilson", packageName: "Concierge", legalTotalCents: 495_000 })).toBe("Sevetri Wilson accepted Concierge · legal $4,950");
    expect(acceptanceHeadline({ clientName: "Sevetri Wilson", packageName: "Concierge", legalTotalCents: 495_000, signedBy: "Sevetri Wilson" })).toBe(
      "Sevetri Wilson accepted Concierge · legal $4,950 · engagement letter signed by Sevetri Wilson",
    );
  });

  it("the firm notice for a signed acceptance names the signing and carries no letter or detail", async () => {
    for (const snapshot of Object.values(both())) {
      const { db, tables } = fakeFollowupDb({
        client_proposal: [{ id: "p1", org_id: "org-1", family_id: "f1", status: "accepted", client_name: "Sevetri Wilson", client_email: "sevetri@example.com", lead_id: null, matter_id: null, accepted_snapshot: snapshot }],
        client_proposal_setting: [{ org_id: "org-1", approver_user_ids: ["u1"] }],
        crm_org_member: [{ org_id: "org-1", user_id: "u1", role: "owner" }],
        crm_lead: [],
        crm_matter: [],
        client_proposal_event: [],
        crm_notification: [],
      });
      await runAcceptanceFollowups(db, { proposalId: "p1", orgId: "org-1" }, { getToken: async () => null });
      const payload = tables.crm_notification[0].payload as { headline: string };
      expect(Object.keys(payload).sort()).toEqual(["headline", "proposal_id", "source"]);
      expect(payload.headline.includes("engagement letter signed by Sevetri Wilson")).toBe(snapshot.schema === 2);
      const wire = JSON.stringify(tables.crm_notification);
      for (const never of ["100 Example Street", "Dear ", "Miami"]) expect(wire).not.toContain(never);
    }
  });

  it("the letter snapshot helpers on the content a snapshot carries", () => {
    const { v1, v2 } = both();
    const approved = { id: "11111111-1111-4111-8111-111111111111", kind: "trademark" as const, version: 3, title: "Engagement letter", body: v2.content.loe!.body };
    expect(loeIsCurrent(v1.content, approved)).toBe(false);
    expect(withLoeSnapshot(v1.content, null, false).loe).toBeUndefined();
    expect(withLoeSnapshot(v2.content, approved, true).loe?.template_version).toBe(3);
    expect(withLoeSnapshot(v2.content, null, false).loe).toBeUndefined();
  });

  it("the signed letter rebuild: a schema 2 snapshot rebuilds, a schema 1 snapshot (or one missing its agreement) does not", () => {
    const { v1, v2 } = both();
    expect(rebuildSignedLetter(v2, "America/New_York")?.signerName).toBe("Sevetri Wilson");
    expect(rebuildSignedLetter(v1, "America/New_York")).toBeNull();
    expect(rebuildSignedLetter({ ...v2, agreement: undefined }, "UTC")).toBeNull();
    expect(rebuildSignedLetter(null, "UTC")).toBeNull();
    expect(rebuildSignedLetter({ ...v2, schema: 1 }, "UTC")).toBeNull();
  });
});
