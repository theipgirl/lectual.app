import { describe, it, expect, vi } from "vitest";
import { runApprove, runSaveDraft, runStartDraft, runStartFromVersion, type LetterDeps } from "@/lib/loe/letter-actions";
import { LETTER_GENERIC_ERROR, LETTER_NOT_ALLOWED, letterErrorSentence } from "@/lib/loe/errors";
import type { LetterVersion } from "@/lib/loe/page-model";
import type { Role } from "@/lib/auth/roles";

const ID = "33333333-3333-4333-8333-333333333333";
const GATE_OFF = new Error("NEXT_NOT_FOUND");

const draft = (over: Partial<LetterVersion> = {}): LetterVersion => ({
  id: ID, kind: "trademark", version: 1, status: "draft", title: "Engagement letter", body: "Dear {{client_name}}", updatedAt: "2026-11-12T00:00:00Z", approvedAt: null, ...over,
});

function deps(over: Partial<Omit<LetterDeps, "role">> & { role?: Role | null } = {}): LetterDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: LetterDeps = {
    requireModule: vi.fn(async () => {
      calls.push("gate");
    }),
    role: async () => (over.role === undefined ? "owner" : over.role),
    isApprover: async () => true,
    orgId: async () => "org-1",
    readVersion: vi.fn(async () => ({ status: "ok" as const, version: draft() })),
    createDraft: vi.fn(async () => ({ ok: true as const, id: ID })),
    saveDraft: vi.fn(async () => ({ ok: true as const, id: ID })),
    approve: vi.fn(async () => ({ ok: true as const, id: ID })),
    revalidate: vi.fn(),
  };
  const { role: _role, ...rest } = over;
  void _role;
  return Object.assign({ ...base, ...rest }, { calls });
}

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("every action re-resolves the feature gate and the role first", () => {
  const runs: Array<[string, (d: LetterDeps) => Promise<unknown>]> = [
    ["start", (d) => runStartDraft(d, form({ kind: "trademark", title: "T", body: "B" }))],
    ["from version", (d) => runStartFromVersion(d, form({ versionId: ID }))],
    ["save", (d) => runSaveDraft(d, form({ id: ID, title: "T", body: "B" }))],
    ["approve", (d) => runApprove(d, form({ id: ID }))],
  ];

  for (const [name, run] of runs) {
    it(`${name}: a firm with proposals off gets notFound and nothing is read or written`, async () => {
      const d = deps({ requireModule: async () => { throw GATE_OFF; } });
      await expect(run(d)).rejects.toBe(GATE_OFF);
      for (const fn of [d.readVersion, d.createDraft, d.saveDraft, d.approve]) expect(fn).not.toHaveBeenCalled();
    });

    it(`${name}: a viewer, a role-less caller and an unreadable role are refused with a fixed sentence`, async () => {
      for (const role of ["viewer", null] as const) {
        const d = deps({ role });
        const out = (await run(d)) as { error?: string };
        expect(out.error).toBe(LETTER_NOT_ALLOWED);
        for (const fn of [d.readVersion, d.createDraft, d.saveDraft, d.approve]) expect(fn).not.toHaveBeenCalled();
      }
    });
  }

  it("editing is the admin tier only; an attorney cannot start or save, but may approve when named", async () => {
    const attorney = deps({ role: "attorney" });
    expect(((await runStartDraft(attorney, form({ kind: "trademark", title: "T", body: "B" }))) as { error?: string }).error).toBe(LETTER_NOT_ALLOWED);
    expect(((await runSaveDraft(attorney, form({ id: ID, title: "T", body: "B" }))) as { error?: string }).error).toBe(LETTER_NOT_ALLOWED);
    const approve = await runApprove(attorney, form({ id: ID }));
    expect(approve.saved).toBe(true);
    expect(attorney.approve).toHaveBeenCalledWith(ID);
  });
});

describe("start a draft", () => {
  it("creates a draft with the typed title and text, for the session's org", async () => {
    const d = deps();
    const out = await runStartDraft(d, form({ kind: "general", title: "  Flat fee letter ", body: "Dear {{client_name}}" }));
    expect(out).toEqual({ saved: true });
    expect(d.createDraft).toHaveBeenCalledWith({ orgId: "org-1", kind: "general", title: "Flat fee letter", body: "Dear {{client_name}}" });
    expect(d.revalidate).toHaveBeenCalled();
  });

  it("refuses an unknown kind, an empty title and an empty body without writing", async () => {
    const d = deps();
    expect((await runStartDraft(d, form({ kind: "other", title: "T", body: "B" }))).error).toBeTruthy();
    expect((await runStartDraft(d, form({ kind: "trademark", title: " ", body: "B" }))).error).toBe("Give the letter a title.");
    expect((await runStartDraft(d, form({ kind: "trademark", title: "T", body: "" }))).error).toBe("Write the letter text.");
    expect(d.createDraft).not.toHaveBeenCalled();
  });

  it("a merge-field problem is allowed in a draft (the page shows it; Approve refuses it)", async () => {
    const d = deps();
    const out = await runStartDraft(d, form({ kind: "trademark", title: "T", body: "Dear {{nope}}" }));
    expect(out.saved).toBe(true);
  });

  it("a refused insert becomes the store's fixed sentence", async () => {
    const d = deps({ createDraft: async () => ({ ok: false, error: "There is already a draft of this letter. Open it to keep editing." }) });
    const out = await runStartDraft(d, form({ kind: "trademark", title: "T", body: "B" }));
    expect(out).toEqual({ error: "There is already a draft of this letter. Open it to keep editing." });
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("an unreadable org is a generic sentence, not a write", async () => {
    const d = deps({ orgId: async () => null });
    expect((await runStartDraft(d, form({ kind: "trademark", title: "T", body: "B" }))).error).toBe(LETTER_GENERIC_ERROR);
    expect(d.createDraft).not.toHaveBeenCalled();
  });
});

describe("start a new draft from a version", () => {
  it("re-reads the text on the server and never takes it from the form", async () => {
    const d = deps({ readVersion: async () => ({ status: "ok", version: draft({ status: "approved", title: "Approved title", body: "Approved body" }) }) });
    const out = await runStartFromVersion(d, form({ versionId: ID, title: "FORGED", body: "FORGED" }));
    expect(out.saved).toBe(true);
    expect(d.createDraft).toHaveBeenCalledWith({ orgId: "org-1", kind: "trademark", title: "Approved title", body: "Approved body" });
  });

  it("refuses a bad id, a missing version and a missing table with fixed sentences", async () => {
    expect((await runStartFromVersion(deps(), form({ versionId: "nope" }))).error).toBe("That letter couldn't be found.");
    expect((await runStartFromVersion(deps({ readVersion: async () => ({ status: "none" }) }), form({ versionId: ID }))).error).toBe("That letter couldn't be found.");
    expect((await runStartFromVersion(deps({ readVersion: async () => ({ status: "not-set-up" }) }), form({ versionId: ID }))).error).toMatch(/isn't switched on for your firm yet/);
    expect((await runStartFromVersion(deps({ readVersion: async () => ({ status: "unavailable" }) }), form({ versionId: ID }))).error).toBe(LETTER_GENERIC_ERROR);
  });
});

describe("save a draft", () => {
  it("saves title and text", async () => {
    const d = deps();
    const out = await runSaveDraft(d, form({ id: ID, title: " New title ", body: "New body {{date}}" }));
    expect(out).toEqual({ saved: true });
    expect(d.saveDraft).toHaveBeenCalledWith(ID, { title: "New title", body: "New body {{date}}" });
  });

  it("saves a draft with an unknown field but reports it", async () => {
    const out = await runSaveDraft(deps(), form({ id: ID, title: "T", body: "{{foo}}" }));
    expect(out.saved).toBe(true);
    expect(out.issues?.[0].message).toContain("{{foo}}");
  });

  it("refuses an empty body, a long body and a bad id", async () => {
    const d = deps();
    expect((await runSaveDraft(d, form({ id: ID, title: "T", body: "" }))).error).toBe("Write the letter text.");
    expect((await runSaveDraft(d, form({ id: ID, title: "T", body: "a".repeat(60_001) }))).error).toMatch(/too long/);
    expect((await runSaveDraft(d, form({ id: "x", title: "T", body: "B" }))).error).toBe("That letter couldn't be found.");
    expect(d.saveDraft).not.toHaveBeenCalled();
  });
});

describe("approve", () => {
  it("approves a clean draft for a named approver", async () => {
    const d = deps();
    const out = await runApprove(d, form({ id: ID }));
    expect(out.saved).toBe(true);
    expect(out.notice).toMatch(/Approved/);
    expect(d.approve).toHaveBeenCalledWith(ID);
  });

  it("refuses a non-named approver without calling the database", async () => {
    const d = deps({ isApprover: async () => false });
    const out = await runApprove(d, form({ id: ID }));
    expect(out.error).toBe("Only the firm's named approvers can approve the engagement letter.");
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("refuses when who may approve cannot be read", async () => {
    const d = deps({ isApprover: async () => null });
    expect((await runApprove(d, form({ id: ID }))).error).toMatch(/couldn't be loaded/);
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("refuses a draft with an unknown merge field and lists the problem", async () => {
    const d = deps({ readVersion: async () => ({ status: "ok", version: draft({ body: "Dear {{foo}}" }) }) });
    const out = await runApprove(d, form({ id: ID }));
    expect(out.error).toBe("Fix the problems in the letter before approving.");
    expect(out.issues?.some((i) => i.message.includes("{{foo}}"))).toBe(true);
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("refuses a version that is not a draft", async () => {
    const d = deps({ readVersion: async () => ({ status: "ok", version: draft({ status: "approved" }) }) });
    expect((await runApprove(d, form({ id: ID }))).error).toMatch(/approved letter can't be changed/);
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("maps a database refusal to a fixed sentence and never echoes raw text", async () => {
    const d = deps({ approve: async () => ({ ok: false, error: letterErrorSentence({ message: "loe_template_not_approver: you are not one of this firm's proposal approvers" }) }) });
    expect((await runApprove(d, form({ id: ID }))).error).toBe("Only the firm's named approvers can approve the engagement letter.");
  });
});

describe("letterErrorSentence: prefixes to fixed sentences", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ message: "loe_template_not_approver: x" }, /named approvers/],
    [{ message: "loe_template_edit_admin_only: x" }, /owner, admin or senior admin/],
    [{ message: "loe_template_frozen: x" }, /Start a new draft/],
    [{ message: "loe_template_bad_transition: x" }, /Save your edits first/],
    [{ message: "loe_template_body_invalid: x" }, /merge field that doesn't exist/],
    [{ code: "23505", message: "duplicate key value violates unique constraint" }, /already a draft/],
    [{ code: "42501", message: "permission denied for table client_proposal_loe_template" }, /role can't change/],
    [{ code: "42P01", message: 'relation "client_proposal_loe_template" does not exist' }, /isn't switched on for your firm yet/],
    [{ code: "PGRST205", message: "Could not find the table" }, /isn't switched on for your firm yet/],
    [{ code: "23514", message: 'violates check constraint "client_proposal_loe_template_body_len"' }, /60,000/],
  ];
  for (const [error, expected] of cases) {
    it(`${JSON.stringify(error).slice(0, 60)}`, () => {
      const s = letterErrorSentence(error as never);
      expect(s).toMatch(expected);
      expect(s).not.toMatch(/client_proposal|violates|duplicate key|relation|constraint|SQLSTATE/i);
    });
  }

  it("an unmapped error gets the generic sentence and never its own text", () => {
    const s = letterErrorSentence({ code: "XX000", message: "secret internal detail: letter body was Dear Pat" });
    expect(s).toBe(LETTER_GENERIC_ERROR);
    expect(letterErrorSentence(null)).toBe(LETTER_GENERIC_ERROR);
  });
});
