import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  disconnect: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: m.session }));
vi.mock("@/lib/esign/disconnect", () => ({ disconnectAdobeSign: m.disconnect }));
vi.mock("next/cache", () => ({ refresh: m.refresh }));

import { runDisconnectAdobe, type DisconnectDeps, type OpenRequestRow } from "@/lib/esign/disconnect-core";
import { disconnectAdobeAction } from "@/app/dashboard/settings/integrations/actions";
import { ADOBE_DISCONNECT_FORBIDDEN, adobeCancelFailedLine, adobeNotCopiedLine } from "@/lib/ui/words";
import { decideSigningPath } from "@/lib/esign/path-rules";

const CONN = { id: "conn-1", org_id: "org-1", status: "active" as const, api_access_point: "https://api.na1.adobesign.com", account_email: null, access_expires_at: null, last_refreshed_at: null };

function harness(open: OpenRequestRow[], over: Partial<DisconnectDeps> = {}, statuses: Record<string, string | Error> = {}) {
  const order: string[] = [];
  const closed: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let lists = 0;
  const deps: DisconnectDeps = {
    readConnection: async () => (order.push("scoped-read"), { state: "ok", connection: CONN }),
    loadAccess: async () => (order.push("token-read"), { kind: "ok", connectionId: "conn-1", accessPoint: "https://api.na1.adobesign.com", accessToken: "A", refreshToken: "R" }),
    listOpen: async () => {
      lists += 1;
      order.push(lists === 1 ? "list" : "re-list");
      return lists === 1 ? open : [];
    },
    readStatus: async (_a, id) => {
      order.push(`re-read:${id}`);
      const s = statuses[id] ?? "OUT_FOR_SIGNATURE";
      if (s instanceof Error) throw s;
      return s as never;
    },
    cancel: async (_a, id) => {
      order.push(`cancel:${id}`);
    },
    complete: async (req) => {
      order.push(`complete:${req.id}`);
      order.push(`adobe_signed_files:${req.id}`);
      return { files: "stored" };
    },
    closeRequest: async (_org, req, patch) => {
      order.push(`close:${req.id}:${patch.status}${patch.cancel_failed ? ":cancel_failed" : ""}`);
      closed.push({ id: req.id, patch });
      return 1;
    },
    markRevoked: async () => (order.push("revoked"), true),
    revokeAtAdobe: async () => (order.push("revoke"), true),
    deleteRow: async () => (order.push("delete"), true),
    ...over,
  };
  return { deps, order, closed };
}

describe("AT11: disconnect with open requests", () => {
  it("AT11: scoped read → token read → re-read → cancel (emails off at the call) → cancelled → revoked → re-list → revoke → delete", async () => {
    const h = harness([{ id: "r1", status: "out_for_signature", agreementId: "a1" }]);
    const r = await runDisconnectAdobe(h.deps);
    expect(r).toEqual({ ok: true, cancelFailed: 0, signedNotCopied: 0, revokedAtAdobe: true });
    expect(h.order).toEqual(["scoped-read", "token-read", "list", "re-read:a1", "cancel:a1", "close:r1:cancelled", "revoked", "re-list", "revoke", "delete"]);
  });

  it("AT11: a request Adobe reports SIGNED is completed, not cancelled: completion → adobe_signed_files → scoped revoked", async () => {
    const h = harness([{ id: "r1", status: "out_for_signature", agreementId: "a1" }], {}, { a1: "SIGNED" });
    await runDisconnectAdobe(h.deps);
    expect(h.order).toEqual(["scoped-read", "token-read", "list", "re-read:a1", "complete:r1", "adobe_signed_files:r1", "revoked", "re-list", "revoke", "delete"]);
  });

  it("AT11: a files step that is not stored puts the 'couldn't be copied into Lectual' sentence, with its count, in the result", async () => {
    const h = harness([{ id: "r1", status: "out_for_signature", agreementId: "a1" }], { complete: async () => ({ files: "not_stored" }) }, { a1: "SIGNED" });
    expect(await runDisconnectAdobe(h.deps)).toMatchObject({ ok: true, signedNotCopied: 1 });
    expect(adobeNotCopiedLine(1)).toBe("The signed letter for 1 client is in your Adobe account; it couldn't be copied into Lectual.");
  });

  it("AT11: a cancel Adobe refuses AND a re-read that fails each mark the request cancelled + cancel_failed, never signed", async () => {
    const h = harness(
      [
        { id: "r1", status: "out_for_signature", agreementId: "a1" },
        { id: "r2", status: "out_for_signature", agreementId: "a2" },
      ],
      { cancel: async () => { throw new Error("refused"); } },
      { a2: new Error("unreachable") },
    );
    const r = await runDisconnectAdobe(h.deps);
    expect(r).toMatchObject({ ok: true, cancelFailed: 2, signedNotCopied: 0 });
    expect(h.closed).toEqual([
      { id: "r1", patch: { status: "cancelled", cancel_failed: true } },
      { id: "r2", patch: { status: "cancelled", cancel_failed: true } },
    ]);
    expect(adobeCancelFailedLine(2)).toBe("2 letters couldn't be cancelled in Adobe. Cancel them in your Adobe account.");
    // Afterwards the path gives in-app for that proposal (nothing open, the connection gone).
    expect(decideSigningPath({ setupReady: true, switchOn: true, requests: { state: "ok", open: null }, connection: { state: "ok", id: null, status: null } }).kind).toBe("in_app");
  });

  it("AT11: a creating row with no agreement is cancelled with no Adobe call; a request opened during step 3 is closed at step 5", async () => {
    let lists = 0;
    const h = harness([{ id: "r1", status: "creating", agreementId: null }], {
      listOpen: async () => {
        lists += 1;
        return lists === 1 ? [{ id: "r1", status: "creating", agreementId: null }] : [{ id: "r9", status: "creating", agreementId: null }];
      },
    });
    await runDisconnectAdobe(h.deps);
    expect(h.closed).toEqual([
      { id: "r1", patch: { status: "cancelled" } },
      { id: "r9", patch: { status: "cancelled", cancel_failed: true } },
    ]);
    expect(h.order.some((o) => o.startsWith("re-read") || o.startsWith("cancel:"))).toBe(false);
  });

  it("REQUIRED 3: an open list that can't be read stops before markRevoked, with nothing changed", async () => {
    const h = harness([], { listOpen: async () => null });
    expect(await runDisconnectAdobe(h.deps)).toEqual({ ok: false, reason: "read" });
    expect(h.order).toEqual(["scoped-read", "token-read"]);
    expect(h.closed).toEqual([]);
  });

  it("AT11: the scoped revoke refused (0 rows) stops before Adobe's revoke and the delete", async () => {
    const h = harness([], { markRevoked: async () => false });
    expect(await runDisconnectAdobe(h.deps)).toEqual({ ok: false, reason: "permission" });
    expect(h.order).not.toContain("revoke");
    expect(h.order).not.toContain("delete");
  });

  it("AT11: a non-admin is refused by the action before any read", async () => {
    for (const role of ["attorney", "paralegal", "viewer", "intake"]) {
      m.session.mockResolvedValueOnce({ kind: "ok", role });
      expect(await disconnectAdobeAction()).toEqual({ error: ADOBE_DISCONNECT_FORBIDDEN });
    }
    m.session.mockResolvedValueOnce({ kind: "signed-out", redirectTo: "/sign-in" });
    expect(await disconnectAdobeAction()).toEqual({ error: ADOBE_DISCONNECT_FORBIDDEN });
    expect(m.disconnect).not.toHaveBeenCalled();
  });

  it("AT11: an admin's disconnect reports the counts in fixed sentences", async () => {
    m.session.mockResolvedValueOnce({ kind: "ok", role: "admin" });
    m.disconnect.mockResolvedValueOnce({ ok: true, cancelFailed: 1, signedNotCopied: 2, revokedAtAdobe: true });
    const r = await disconnectAdobeAction();
    expect(r.lines).toEqual(["Adobe Acrobat Sign is disconnected.", adobeCancelFailedLine(1), adobeNotCopiedLine(2)]);
  });
});
