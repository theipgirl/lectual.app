import { describe, expect, it } from "vitest";
import { acceptanceHeadline, acceptanceNoteBody } from "@/lib/proposals/accept-followups";
import { proposalDisplayStatus } from "@/lib/proposals/display-status";
import { buildProposalRowView, type ListRowInput } from "@/lib/proposals/list-rows";
import { describeStepEvent, stepActivityLabel } from "@/lib/proposals/paid";
import { isSignedSnapshot } from "@/lib/proposals/signed-state";
import { SIGNED_STATUS_WORD, STATUS_WORDS } from "@/lib/proposal-editor/vocabulary";
import { statusLabel, statusLabelFor } from "@/lib/proposal-editor/labels";
import { DELETE_CONFIRM } from "@/lib/proposal-editor/delete-proposal";
import { RESET_CONFIRM } from "@/lib/proposal-editor/reset-acceptance";
import { acceptedSnapshot } from "./accepted-fixture";
import { signedTrademark, signedGeneral } from "../loe/signed-fixtures";

/** P4b / P4c / P5c wording: "Signed by client", "Signed <date>", the notice and the note, the step in words, the two confirm sentences. */

function item(over: Partial<ListRowInput> = {}): ListRowInput {
  return {
    id: "p1",
    family_id: "f1",
    version: 1,
    client_name: "Sevetri Wilson",
    title: "Trademark Proposal",
    status: "accepted",
    source: "manual",
    expires_on: null,
    accepted_at: "2026-10-21T15:00:00.000Z",
    updated_at: "2026-10-21T15:00:00.000Z",
    legal_total_cents: 495_000,
    gov_total_cents: 70_000,
    blocking_issue: null,
    brands: ["Prosperall"],
    offered: [],
    class_count: 2,
    signed_package: "Concierge",
    package_basis: null,
    ...over,
  };
}
const ctx = { today: "2026-11-12", tz: "America/New_York", now: Date.parse("2026-11-12T16:00:00Z"), events: new Map(), names: new Map() };
const view = (over: Partial<ListRowInput>) => buildProposalRowView(item(over), ctx);

describe("the status words", () => {
  it("a signed accepted version reads Signed by client; unsigned stays Accepted by client", () => {
    expect(SIGNED_STATUS_WORD).toBe("Signed by client");
    expect(STATUS_WORDS.accepted).toBe("Accepted by client");
    expect(statusLabelFor("accepted", true)).toBe("Signed by client");
    expect(statusLabelFor("accepted", false)).toBe("Accepted by client");
    expect(statusLabelFor("sent", true)).toBe(statusLabel("sent"));
    expect(proposalDisplayStatus({ status: "accepted", expires_on: null, signed: true }, { today: "2026-11-12", issues: null }).label).toBe("Signed by client");
    for (const signed of [false, null, undefined]) {
      expect(proposalDisplayStatus({ status: "accepted", expires_on: null, signed }, { today: "2026-11-12", issues: null }).label).toBe("Accepted by client");
    }
  });

  it("the snapshot test: schema 2 with an agreement is signed; schema 1, a missing agreement, null and a blank signer are not", () => {
    expect(isSignedSnapshot(signedTrademark())).toBe(true);
    expect(isSignedSnapshot(signedGeneral())).toBe(true);
    expect(isSignedSnapshot(acceptedSnapshot())).toBe(false);
    expect(isSignedSnapshot({ ...signedTrademark(), agreement: undefined })).toBe(false);
    expect(isSignedSnapshot({ ...signedTrademark(), schema: 1 })).toBe(false);
    expect(isSignedSnapshot(null)).toBe(false);
    expect(isSignedSnapshot({ ...signedTrademark(), agreement: { ...signedTrademark().agreement!, signer_name: "  " } })).toBe(false);
  });
});

describe("the list's Accepted column", () => {
  it("Signed Oct 21 for a signed version, Accepted Oct 21 for an unsigned one, Not yet for one that was not accepted", () => {
    expect(view({ signed: true }).accepted).toBe("Signed Oct 21");
    expect(view({ signed: true }).statusLabel).toBe("Signed by client");
    expect(view({ signed: false }).accepted).toBe("Accepted Oct 21");
    expect(view({}).accepted).toBe("Accepted Oct 21");
    expect(view({ status: "sent", accepted_at: null }).accepted).toBe("Not yet");
    expect(view({ status: "draft", accepted_at: null, signed: true }).accepted).toBe("Not yet");
  });

  it("a failed or unknown signature read is not Signed and not Not yet: it falls back to Accepted <date>", () => {
    expect(view({ signed: null }).accepted).toBe("Accepted Oct 21");
    expect(view({ signed: null }).statusLabel).toBe("Accepted by client");
  });
});

describe("P4c: the firm notice and the Lawmatics note for a signed snapshot", () => {
  it("say it was signed, by whom and when, with no letter text, address, email or typed class words", () => {
    const snap = signedTrademark();
    const headline = acceptanceHeadline({ clientName: "Sevetri Wilson", packageName: "Enhanced", legalTotalCents: snap.quote.legal_total_cents, signedBy: snap.agreement!.signer_name });
    expect(headline).toContain("engagement letter signed by Sevetri Wilson");
    const note = acceptanceNoteBody(snap, "Sevetri Wilson");
    expect(note.body).toContain("Engagement letter signed by Sevetri Wilson on 2026-11-12T19:14:00.000Z (UTC).");
    for (const never of ["100 Example Street", "Miami", "Dear ", "sevetri@example.com", "Gaming consoles", snap.agreement!.sha256, "Engagement letter\n"]) {
      expect(note.body, never).not.toContain(never);
      expect(headline, never).not.toContain(never);
    }
    expect(note.body).toContain("Classes added by the client: 1");
  });

  it("the flat-fee note says it was signed and has no USPTO line", () => {
    const note = acceptanceNoteBody(signedGeneral(), "Faithe Williams");
    expect(note.body).toContain("Engagement letter signed by Faithe Williams");
    expect(note.body).not.toMatch(/USPTO/);
  });

  it("an unsigned snapshot says nothing about a signing", () => {
    expect(acceptanceNoteBody(acceptedSnapshot(), "Sevetri Wilson").body).not.toMatch(/signed/i);
  });
});

describe("the signed_loe_upload step in words (history, list activity)", () => {
  const p = (outcome: string, reason?: string) => ({ step: "signed_loe_upload", outcome, ...(reason ? { reason } : {}) });
  it("describeStepEvent has a sentence for each outcome", () => {
    expect(describeStepEvent(p("uploaded"))).toBe("filed the signed engagement letter in Lawmatics");
    expect(describeStepEvent(p("failed", "HTTP 422"))).toBe("couldn’t file the signed engagement letter in Lawmatics: HTTP 422");
    expect(describeStepEvent(p("blocked", "No Lawmatics record was found"))).toBe("didn’t file the signed engagement letter in Lawmatics: No Lawmatics record was found");
    expect(describeStepEvent(p("skipped", "Lawmatics isn't connected"))).toBe("skipped filing the signed engagement letter in Lawmatics: Lawmatics isn't connected");
  });
  it("the list's Last activity label", () => {
    expect(stepActivityLabel(p("uploaded"))).toBe("Signed letter filed in Lawmatics");
    expect(stepActivityLabel(p("failed"))).toBe("Signed letter not filed in Lawmatics");
  });
});

describe("P5c: the two confirm sentences", () => {
  it("reset keeps earlier signature records, and says so", () => {
    expect(RESET_CONFIRM).toContain("Earlier signature records are kept.");
  });
  it("delete says the signed letter's record is removed too", () => {
    expect(DELETE_CONFIRM).toContain("the signed letter's record is removed too");
    expect(DELETE_CONFIRM).toContain("This can't be undone.");
  });
});
