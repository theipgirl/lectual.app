import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DELETE_CONFIRM,
  DELETE_FAILED,
  DELETE_LABEL,
  DELETE_NEEDS_DB_UPDATE,
  DELETE_NOT_FOUND,
  DELETE_OWNER_ONLY,
  DELETE_PARTIAL,
  canDeleteProposal,
  moreMenuItems,
  runDeleteProposalFamily,
  type DeleteFamilyDeps,
} from "@/lib/proposal-editor/delete-proposal";
import { ROLES, type Role } from "@/lib/auth/roles";
import type { ProposalStatus } from "@/lib/proposals/types";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  createLinkAction: vi.fn(),
  deleteProposalAction: vi.fn(),
  queuePostConsultEmailAction: vi.fn(),
  reviseAction: vi.fn(),
  sendAction: vi.fn(),
  unapproveAction: vi.fn(),
  withdrawAction: vi.fn(),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const STATUSES: ProposalStatus[] = ["draft", "approved", "sent", "accepted", "superseded", "withdrawn"];

function deps(over: Partial<DeleteFamilyDeps> = {}, status: ProposalStatus = "sent") {
  const d: DeleteFamilyDeps = {
    role: vi.fn(async () => "owner" as Role),
    readRow: vi.fn(async (id: string) => ({ id, familyId: ID, status })),
    readFamily: vi.fn(async () => [
      { id: ID, status },
      { id: V2, status: "draft" as ProposalStatus },
    ]),
    deleteFamily: vi.fn(async () => [ID, V2]),
    ...over,
  };
  return d;
}

describe("runDeleteProposalFamily", () => {
  it.each(STATUSES)("the owner deletes the whole family of a %s proposal, by family id, in one call", async (status) => {
    const d = deps({}, status);
    const r = await runDeleteProposalFamily(d, V2);
    expect(r).toEqual({ ok: true, deleted: 2 });
    expect(d.deleteFamily).toHaveBeenCalledTimes(1);
    expect(d.deleteFamily).toHaveBeenCalledWith(ID);
  });

  it.each(ROLES.filter((r) => r !== "owner"))("%s is refused and nothing is read or deleted", async (role) => {
    const d = deps({ role: vi.fn(async () => role) });
    const r = await runDeleteProposalFamily(d, ID);
    expect(r).toEqual({ ok: false, error: DELETE_OWNER_ONLY });
    expect(d.readRow).not.toHaveBeenCalled();
    expect(d.deleteFamily).not.toHaveBeenCalled();
  });

  it("an unreadable role is refused", async () => {
    const d = deps({ role: vi.fn(async () => null) });
    expect(await runDeleteProposalFamily(d, ID)).toEqual({ ok: false, error: DELETE_OWNER_ONLY });
    expect(d.deleteFamily).not.toHaveBeenCalled();
  });

  it("a bad id or a row RLS hides (another firm's) is not found, with no delete", async () => {
    const bad = deps();
    expect(await runDeleteProposalFamily(bad, "not-a-uuid")).toEqual({ ok: false, error: DELETE_NOT_FOUND });
    expect(bad.role).not.toHaveBeenCalled();
    const hidden = deps({ readRow: vi.fn(async () => null) });
    expect(await runDeleteProposalFamily(hidden, ID)).toEqual({ ok: false, error: DELETE_NOT_FOUND });
    expect(hidden.deleteFamily).not.toHaveBeenCalled();
  });

  it("0 rows deleted (0102 not applied) says it isn't switched on yet", async () => {
    const d = deps({ deleteFamily: vi.fn(async () => []) });
    expect(await runDeleteProposalFamily(d, ID)).toEqual({ ok: false, error: DELETE_NEEDS_DB_UPDATE });
    expect(DELETE_NEEDS_DB_UPDATE).toBe("Deleting this proposal isn't switched on for your firm yet. Lectual will turn it on.");
  });

  it("only the drafts went (0089 alone) says so, never 'deleted'", async () => {
    const d = deps({ deleteFamily: vi.fn(async () => [V2]) });
    expect(await runDeleteProposalFamily(d, ID)).toEqual({ ok: false, error: DELETE_PARTIAL, partial: true });
  });

  it("any thrown failure is one fixed sentence, never its text", async () => {
    const d = deps({ deleteFamily: vi.fn(async () => { throw new Error("violates foreign key constraint client_proposal_family_fk"); }) });
    const r = await runDeleteProposalFamily(d, ID);
    expect(r).toEqual({ ok: false, error: DELETE_FAILED });
    const read = deps({ readRow: vi.fn(async () => { throw new Error("permission denied for table client_proposal"); }) });
    expect(await runDeleteProposalFamily(read, ID)).toEqual({ ok: false, error: DELETE_FAILED });
  });
});

describe("who may delete, and the More menu", () => {
  it("owner only", () => {
    for (const role of ROLES) expect(canDeleteProposal(role)).toBe(role === "owner");
    expect(canDeleteProposal(null)).toBe(false);
  });

  it("Delete is in the menu for the owner in every status, never for anyone else", () => {
    for (const status of STATUSES) {
      expect(moreMenuItems({ status, canWrite: true, canDelete: true })).toContain("delete");
      expect(moreMenuItems({ status, canWrite: true, canDelete: false })).not.toContain("delete");
    }
    expect(moreMenuItems({ status: "accepted", canWrite: true, canDelete: false })).toEqual([]);
    expect(moreMenuItems({ status: "sent", canWrite: true, canDelete: false })).toEqual(["withdraw"]);
  });

  const render = (canDelete: boolean, status: ProposalStatus) =>
    import("@/components/proposal-editor/Lifecycle").then(({ Lifecycle }) =>
      renderToStaticMarkup(
        createElement(Lifecycle, {
          proposalId: "p1",
          status,
          version: 1,
          canWrite: true,
          isApprover: true,
          blockingErrors: 0,
          approverNames: [],
          clientUrl: null,
          canDelete,
        }),
      ),
    );

  it("an accepted proposal shows More only to the owner", async () => {
    expect(await render(true, "accepted")).toContain(">More<");
    expect(await render(false, "accepted")).not.toContain(">More<");
  });

  it("the confirm says every version, the link and the history go, and it can't be undone; Cancel is there", async () => {
    const { DeleteConfirm } = await import("@/components/proposal-editor/Lifecycle");
    const html = renderToStaticMarkup(createElement(DeleteConfirm, { proposalId: "p1", onCancel: () => {} }));
    expect(DELETE_CONFIRM).toBe(
      "Delete this proposal and all its versions? The client link stops working and its history is removed. This can't be undone.",
    );
    expect(html).toContain("all its versions");
    expect(html).toContain("can&#x27;t be undone");
    expect(html).toContain(`>${DELETE_LABEL}<`);
    expect(html).toContain(">Cancel<");
  });
});

describe("the store and the action", () => {
  const store = readFileSync("src/lib/proposals/store.ts", "utf8");
  const action = readFileSync("src/app/dashboard/proposals/[id]/actions.ts", "utf8");
  const fn = store.slice(store.indexOf("export async function deleteProposalFamily"), store.indexOf("/* ─────────────────────────── lifecycle"));

  it("deletes by family_id through the scoped client, never the service role", () => {
    expect(fn).toContain("getScopedClient()");
    expect(fn).toContain('.delete().eq("family_id", familyId).select("id")');
    expect(store).not.toMatch(/getAdminClient|db\/admin/);
  });

  it("the action gates the module, checks the owner, and redirects to the list with the flash", () => {
    const body = action.slice(action.indexOf("export async function deleteProposalAction"));
    expect(body.indexOf("requireProposalsModule()")).toBeLessThan(body.indexOf("canDeleteProposal("));
    expect(body.indexOf("canDeleteProposal(")).toBeLessThan(body.indexOf("deleteProposalFamily("));
    expect(body).toContain('redirect("/dashboard/proposals/?deleted=1")');
  });
});
