import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalRow } from "@/lib/proposals/types";
import type { SignatureRead } from "@/lib/loe/signature-read";
import { acceptedSnapshot } from "../proposals/accepted-fixture";
import { acceptedProposalRow, FINGERPRINT, signedTrademark } from "./signed-fixtures";

/** The staff proposal page for a SIGNED version: header wording, the Engagement letter card in each of its states, roles, and no card when there is nothing to show. */

const ID = "44444444-4444-4444-8444-444444444444";
const SIGNED_OK: SignatureRead = {
  status: "ok",
  signature: { id: "sig-1", signerName: "Sevetri Wilson", signedAt: "2026-11-12T19:14:00.000Z", fingerprint: FINGERPRINT, entityName: "Prosperall Inc.", signerTitle: "Founder", templateVersion: 3 },
};

type Extra = {
  role?: string;
  signature?: SignatureRead;
  steps?: Array<Record<string, unknown>>;
  stepsRead?: "fail";
  notFound?: boolean;
};

async function render(proposal: ProposalRow, extra: Extra = {}) {
  vi.resetModules();
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined), gateStaffAction: vi.fn(async () => null) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: extra.role ?? "owner", org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/loe/signature-read", () => ({ readSignature: vi.fn(async () => extra.signature ?? SIGNED_OK) }));
  vi.doMock("@/lib/loe/templates-store", () => ({ getApprovedLetter: vi.fn(async () => ({ status: "ok", letter: null })) }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail | null> => (extra.notFound ? null : { proposal, versions: [], events: [] })),
    getProposalSettings: vi.fn(async () => ({ pricing: {}, approver_user_ids: [] })),
    isCurrentUserApprover: vi.fn(async () => true),
    listProposalStepEvents: vi.fn(async () => (extra.stepsRead === "fail" ? { ok: false } : { ok: true, events: extra.steps ?? [] })),
    listProposalOpens: vi.fn(async () => new Map()),
  }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ GOES_LIVE_ON_APPROVAL: "x", proposalSendBlock: vi.fn(async () => ({ blocked: false })) }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/proposals/lead-link", () => ({ loadLeadLink: vi.fn(async () => ({ state: "none" })) }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: vi.fn(async () => ({ status: "ok", leads: [] })) }));
  vi.doMock("@/components/client-proposal/ProposalDocument", () => ({ ProposalDocument: () => createElement("div", { "data-stub": "document" }) }));
  vi.doMock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn(), retryUploadAction: vi.fn() }));
  vi.doMock("@/app/dashboard/proposals/[id]/signed-letter-actions", () => ({ downloadSignedLetterStaffAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/[id]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: ID }) })));
}

const step = (payload: Record<string, unknown>, at = "2026-11-12T19:15:00.000Z") => ({ proposal_id: ID, type: "edited", actor: "system", actor_user_id: null, created_at: at, payload });
const signed = () => acceptedProposalRow(signedTrademark());

beforeEach(() => vi.resetModules());

describe("P4b / P5b: a signed version on the staff page", () => {
  it("the header pill says Signed by client; the card shows the signer, when (firm zone), the fingerprint and a Download", async () => {
    const html = await render(signed());
    expect(html).toContain("Signed by client");
    expect(html).not.toContain("Accepted by client");
    expect(html).toContain('data-signed-card="signed"');
    expect(html).toContain("Sevetri Wilson");
    expect(html).toContain("Signed November 12, 2026 at 2:14 PM");
    expect(html).toContain(FINGERPRINT);
    expect(html).toContain("Download the signed letter (PDF)");
    expect(html).toContain("Not filed yet.");
  });

  it("an accepted version with no letter still says Accepted by client and draws no card", async () => {
    const plain = acceptedProposalRow(acceptedSnapshot({ classes: 2 }));
    const html = await render(plain);
    expect(html).toContain("Accepted by client");
    expect(html).not.toContain("Signed by client");
    expect(html).not.toContain("data-signed-card");
  });

  it("filing state from the step events: done, failed with Try again, blocked, skipped with its reason", async () => {
    const done = await render(signed(), { steps: [step({ step: "signed_loe_upload", outcome: "uploaded" })] });
    expect(done).toContain("Signed engagement letter filed in Lawmatics.");
    expect(done).not.toContain("Try again");

    const failed = await render(signed(), { steps: [step({ step: "signed_loe_upload", outcome: "failed", reason: "HTTP 422" })] });
    expect(failed).toContain("Not uploaded to Lawmatics: HTTP 422.");
    expect(failed).toContain("Try again");
    expect(failed).toContain('name="step" value="signed_loe_upload"');

    const blocked = await render(signed(), { steps: [step({ step: "signed_loe_upload", outcome: "blocked", reason: "More than one Lawmatics record matches this client, so the signed letter wasn&apos;t filed." })] });
    expect(blocked).toContain("data-filing=\"blocked\"");

    const skipped = await render(signed(), { steps: [step({ step: "signed_loe_upload", outcome: "skipped", reason: "Lawmatics isn't connected, so the signed letter wasn't filed there." })] });
    expect(skipped).toContain('data-filing="skipped"');
    expect(skipped).toContain("Lawmatics isn&#x27;t connected, so the signed letter wasn&#x27;t filed there.");
  });

  it("a failed step-events read says so; it is never 'Not filed yet' and offers no Try again", async () => {
    const html = await render(signed(), { stepsRead: "fail" });
    expect(html).toContain("couldn&#x27;t be loaded");
    expect(html).not.toContain("Not filed yet.");
    expect(html).not.toContain("Try again");
  });

  it("the newest step event wins: a failure followed by an upload reads done", async () => {
    const html = await render(signed(), {
      steps: [step({ step: "signed_loe_upload", outcome: "failed", reason: "HTTP 500" }, "2026-11-12T19:15:00.000Z"), step({ step: "signed_loe_upload", outcome: "uploaded" }, "2026-11-12T19:30:00.000Z")],
    });
    expect(html).toContain("filed in Lawmatics.");
    expect(html).not.toContain("Try again");
  });

  it("signature read `none`: says the record wasn't found, never Signed from the snapshot alone (no fingerprint, no Download)", async () => {
    const html = await render(signed(), { signature: { status: "none" } });
    expect(html).toContain('data-signed-card="not_found"');
    expect(html).toContain("signature record wasn&#x27;t found");
    expect(html).not.toContain("Download the signed letter");
    expect(html).not.toContain(FINGERPRINT);
  });

  it("signature read `unavailable`: says it couldn't be loaded", async () => {
    const html = await render(signed(), { signature: { status: "unavailable" } });
    expect(html).toContain('data-signed-card="unavailable"');
    expect(html).toContain("The signature record couldn&#x27;t be loaded.");
    expect(html).not.toContain("Download the signed letter");
  });
});

describe("P5d: roles and another firm", () => {
  it("intake may Try again (the existing retry roles) and Download", async () => {
    const html = await render(signed(), { role: "intake", steps: [step({ step: "signed_loe_upload", outcome: "failed", reason: "HTTP 500" })] });
    expect(html).toContain("Try again");
    expect(html).toContain("Download the signed letter (PDF)");
  });

  it("a paralegal downloads but cannot Try again (not in the paid/retry roles)", async () => {
    const html = await render(signed(), { role: "paralegal", steps: [step({ step: "signed_loe_upload", outcome: "failed", reason: "HTTP 500" })] });
    expect(html).toContain("Download the signed letter (PDF)");
    expect(html).not.toContain("Try again");
  });

  it("a viewer and social media get neither Download nor Try again", async () => {
    for (const role of ["viewer", "social_media"]) {
      const html = await render(signed(), { role, steps: [step({ step: "signed_loe_upload", outcome: "failed", reason: "HTTP 500" })] });
      expect(html, role).toContain('data-signed-card="signed"');
      expect(html, role).not.toContain("Download the signed letter");
      expect(html, role).not.toContain("Try again");
    }
  });

  it("another firm's proposal reads as not found with no letter data", async () => {
    vi.doMock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: vi.fn() }));
    await expect(render(signed(), { notFound: true })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
