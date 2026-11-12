import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptPublicProposal, readPublicProposal, type AcceptResult } from "@/lib/proposals/public";
import { defaultSelection } from "@/lib/proposals/pricing";
import type { Row } from "./public-db-double";
import { SIGN_MESSAGES } from "@/lib/loe/client-words";
import { sevetri } from "./fixture";
import { TEST_DETAILS } from "../loe/full-letter-fixture";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(fn: () => unknown) => void>(),
  runAcceptanceFollowups: vi.fn<(db: unknown, input: { proposalId: string; orgId: string }) => Promise<void>>(async () => {}),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

beforeEach(() => {
  mocks.after.mockReset();
  mocks.runAcceptanceFollowups.mockReset();
  mocks.runAcceptanceFollowups.mockResolvedValue(undefined);
});

import { NOW, TOKEN, browserSigning, world } from "./signing-world";

function expectFailure(r: AcceptResult, message: string) {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toBe(message);
}

function nothingWritten(w: ReturnType<typeof world>) {
  expect(w.rpcCalls).toHaveLength(0);
  expect(w.calls.filter((c) => c.op !== "select" && c.table === "client_proposal")).toHaveLength(0);
  expect(w.tables.client_proposal_signature ?? []).toHaveLength(0);
  expect((w.tables.client_proposal[0] as Row).status).toBe("sent");
  expect(mocks.after).not.toHaveBeenCalled();
}

describe("a signed acceptance (content with an engagement letter)", () => {
  it("calls the database function exactly once with the server-built agreement text and its sha256, and never the plain update", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    const audit = { ip: "203.0.113.7, 10.0.0.1", userAgent: "Mozilla/5.0 ".padEnd(500, "x") };
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing, audit);
    expect(r.ok).toBe(true);
    expect(w.rpcCalls).toHaveLength(1);
    const call = w.rpcCalls[0];
    expect(call.fn).toBe("client_proposal_sign_and_accept");
    expect(call.args.p_agreement_text).toBe(b.text);
    expect(call.args.p_agreement_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(call.args.p_agreement_sha256).toBe(createHash("sha256").update(b.text, "utf8").digest("hex"));
    expect(call.args.p_proposal_id).toBe("prop-2");
    expect(call.args.p_org_id).toBe("org-1");
    expect(call.args.p_signer_name).toBe("Sevetri Wilson");
    expect(call.args.p_entity_name).toBe("Prosperall Inc.");
    expect(call.args.p_address).toEqual({ street: "100 Example Street", street2: "Suite 4", city: "Miami", region: "FL", postal: "33101" });
    expect(call.args.p_ip).toBe("203.0.113.7");
    expect(String(call.args.p_user_agent)).toHaveLength(400);
    const snapshot = call.args.p_snapshot as { schema: number; agreement: { signer_name: string }; signing: { date_text: string } };
    expect(snapshot.schema).toBe(2);
    expect(snapshot.agreement.signer_name).toBe("Sevetri Wilson");
    expect(snapshot.signing.date_text).toBe("October 20, 2026");
    // No unsigned update of the proposal row is ever issued for a letter proposal.
    expect(w.calls.filter((c) => c.table === "client_proposal" && c.op === "update")).toHaveLength(0);
    if (r.ok) {
      // The zone is named (item 7): the firm is in New York and October is daylight time.
      expect(r.signedLine).toBe("Signed October 20, 2026 at 11:00 AM EDT by Sevetri Wilson");
      expect(r.signedDateText).toBe("October 20, 2026");
      expect(r.payUrl).toBe("https://app.lawmatics.com/forms/share/abc");
    }
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("an unparseable network address is stored as null and the signing still happens", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing, { ip: "not an address", userAgent: null });
    expect(r.ok).toBe(true);
    expect(w.rpcCalls[0].args.p_ip).toBeNull();
    expect(w.rpcCalls[0].args.p_user_agent).toBeNull();
  });

  it("a tampered fingerprint writes nothing and asks the client to reload", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, { ...b.signing, fingerprint: "0".repeat(64) }), SIGN_MESSAGES.stale);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, { ...b.signing, fingerprint: undefined }), SIGN_MESSAGES.stale);
    nothingWritten(w);
  });

  it("a selection that differs from what the browser fingerprinted is stale", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    expectFailure(await acceptPublicProposal(TOKEN, { ...b.selection, "ci-logo": true }, NOW, w.db, undefined, b.signing), SIGN_MESSAGES.stale);
    nothingWritten(w);
  });

  it("a missing name, an unticked agreement, empty details and no signing at all each write nothing", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, { ...b.signing, typedName: "  " }), SIGN_MESSAGES.name_required);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, { ...b.signing, agree: false }), SIGN_MESSAGES.agree_required);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, { ...b.signing, details: {} }), SIGN_MESSAGES.details_required);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db), SIGN_MESSAGES.signing_required);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, null), SIGN_MESSAGES.signing_required);
    nothingWritten(w);
  });

  it("an expired proposal cannot be signed", async () => {
    const w = world({ proposal: { expires_on: "2026-10-10" } });
    const b = await browserSigning(world().db);
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("closed");
    nothingWritten(w);
  });

  it("a withdrawn proposal cannot be signed", async () => {
    const w = world({ proposal: { status: "withdrawn" } });
    const b = await browserSigning(world().db);
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing);
    expect(r.ok).toBe(false);
    expect(w.rpcCalls).toHaveLength(0);
  });

  it("a missing function (0106 not applied) writes nothing and never falls back to the unsigned accept", async () => {
    for (const code of ["42883", "PGRST202"]) {
      const w = world({ rpcImpl: () => ({ data: null, error: { code, message: "Could not find the function" } }) });
      const b = await browserSigning(w.db);
      const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing);
      expectFailure(r, SIGN_MESSAGES.not_ready);
      expect(w.rpcCalls).toHaveLength(1);
      expect(w.calls.filter((c) => c.table === "client_proposal" && c.op === "update")).toHaveLength(0);
      expect((w.tables.client_proposal[0] as Row).status).toBe("sent");
      expect(mocks.after).not.toHaveBeenCalled();
    }
  });

  it("a database client with no rpc at all is the same refusal", async () => {
    const w = world({ noRpc: true });
    const b = await browserSigning(w.db);
    expectFailure(await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing), SIGN_MESSAGES.not_ready);
    expect(w.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("a double sign loses at the function: the second is already resolved and nothing more is written", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    expect((await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing)).ok).toBe(true);
    const second = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_resolved");
    expect(w.tables.client_proposal_signature).toHaveLength(1);
    // The function's own refusal on a row that left `sent` between the read and the call.
    const w2 = world({ rpcImpl: () => ({ data: null, error: { code: "23514", message: "loe_sign_not_sent: only a live proposal can be signed" } }) });
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w2.db, undefined, b.signing);
    if (r.ok) throw new Error("expected a refusal");
    expect(r.reason).toBe("already_resolved");
  });

  it("markup and control characters in a typed name or address are stored cleaned", async () => {
    const w = world();
    const dirty = { ...TEST_DETAILS, street: "1 <script>alert(1)</script>\u0000Main\u0007St", city: "Mi\u2028ami" };
    const b = await browserSigning(w.db, { details: dirty, typedName: "Sevetri <b>Wilson</b>\u0000" });
    // Posted by hand with the values exactly as typed: the server cleans them itself and arrives at the page's fingerprint.
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.rawSigning);
    expect(r.ok).toBe(true);
    const args = w.rpcCalls[0].args;
    expect(args.p_signer_name).toBe("Sevetri bWilson/b");
    expect(JSON.stringify(args.p_address)).not.toMatch(new RegExp("[<>\\u0000\\u0007\\u2028]"));
    expect((args.p_address as Record<string, string>).street).toBe("1 scriptalert(1)/script Main St");
    expect(String(args.p_agreement_text)).not.toMatch(new RegExp("<script>|\\u0000"));
    expect((args.p_snapshot as { signing: { details: Record<string, string> } }).signing.details.city).toBe("Mi ami");
  });
});

describe("content without an engagement letter accepts exactly as before", () => {
  it("issues the plain conditional update, never the function, and ignores a signing", async () => {
    const w = world({ content: sevetri() });
    const r = await acceptPublicProposal(TOKEN, defaultSelection(sevetri()), NOW, w.db, undefined, { typedName: "X", agree: true });
    expect(r.ok).toBe(true);
    expect(w.rpcCalls).toHaveLength(0);
    const update = w.calls.find((c) => c.table === "client_proposal" && c.op === "update")!;
    expect((update.payload as { status: string; accepted_snapshot: { schema: number } }).status).toBe("accepted");
    expect((update.payload as { accepted_snapshot: { schema: number } }).accepted_snapshot.schema).toBe(1);
    if (r.ok) expect(r.signedLine).toBeUndefined();
  });

  it("does not read the client's email for a proposal without a letter", async () => {
    const w = world({ content: sevetri() });
    await readPublicProposal(TOKEN, NOW, w.db);
    expect(w.calls.some((c) => c.columns === "client_email")).toBe(false);
  });
});
