import { describe, it, expect } from "vitest";

import { changedColumns, contentChanges } from "@/lib/proposals/diff";
import { friendlyProposalError, ProposalError } from "@/lib/proposals/errors";
import {
  DEFAULT_PROPOSAL_INCLUDES,
  DEFAULT_PROPOSAL_PRICING,
  PROPOSAL_STAFF_WRITE_ROLES,
  PROPOSAL_ADMIN_ROLES,
  canTransitionProposal,
  isProposalEditable,
  isWellFormedProposalToken,
  standardProposalPricing,
} from "@/lib/proposals/types";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { validateContent } from "@/lib/proposals/validate";
import { buildChanges, checkDraftColumns, generateProposalToken, offerTotals } from "@/lib/proposals/store";
import { ROLES } from "@/lib/auth/roles";
import { sevetri } from "./fixture";

describe("contentChanges", () => {
  it("is empty for identical content, even with keys in a different order", () => {
    const a = sevetri();
    const b = JSON.parse(JSON.stringify(a));
    b.pricing = Object.fromEntries(Object.entries(b.pricing).reverse());
    expect(contentChanges(a, b)).toEqual([]);
  });

  it("names the package price change in cents, with a readable label", () => {
    const after = sevetri();
    after.pricing.base_cents = 450_000;
    expect(contentChanges(sevetri(), after)).toEqual([
      { path: "pricing.base_cents", label: "Concierge base price", format: "cents", before: 495_000, after: 450_000 },
    ]);
  });

  it("describes edits to a brand name's mark by id", () => {
    const after = sevetri();
    after.names[0].marks[0].desc = "New description";
    after.names[0].marks[1].preselected = false;
    const changes = contentChanges(sevetri(), after);
    expect(changes.map((c) => c.path)).toEqual([
      "names[p].marks[p-word].desc",
      "names[p].marks[p-logo].preselected",
    ]);
    expect(changes[0].label).toBe("Prosperall: Word mark description");
    expect(changes[1]).toMatchObject({ format: "bool", before: true, after: false });
  });

  it("reordering is not a change; adding and removing items is", () => {
    const reordered = sevetri();
    reordered.names.reverse();
    reordered.names[1].marks.reverse();
    expect(contentChanges(sevetri(), reordered)).toEqual([]);

    const added = sevetri();
    added.adjustments = [{ id: "a1", label: "Consultation credit", kind: "amount", value: 45_000 }];
    const changes = contentChanges(sevetri(), added);
    expect(changes).toContainEqual({ path: "adjustments[a1]", label: "Adjustment", format: "text", before: null, after: "Consultation credit" });
    expect(changes).toContainEqual({ path: "adjustments[a1].value", label: "Consultation credit", format: "cents", before: null, after: 45_000 });

    const removed = sevetri();
    removed.names = removed.names.slice(0, 1);
    const gone = contentChanges(sevetri(), removed);
    expect(gone).toContainEqual({ path: "names[t]", label: "Brand name", format: "text", before: "Tech4PublicGood", after: null });
  });

  it("tracks a per-brand override and a percent adjustment's format", () => {
    const after = sevetri();
    after.names[0].price_override = { base_cents: 400_000 };
    after.adjustments = [{ id: "r", label: "Referral", kind: "percent", value: 10 }];
    const changes = contentChanges(sevetri(), after);
    expect(changes).toContainEqual(
      expect.objectContaining({ path: "names[p].price_override.base_cents", format: "cents", before: null, after: 400_000 }),
    );
    expect(changes).toContainEqual(expect.objectContaining({ path: "adjustments[r].value", format: "pct", after: 10 }));
  });

  it("tracks includes rows by label", () => {
    const after = sevetri();
    after.includes[1].included = "2 included";
    expect(contentChanges(sevetri(), after)).toEqual([
      {
        path: "includes[Non-Substantive Office Action Response].included",
        label: "Non-Substantive Office Action Response: included",
        format: "text",
        before: "Unlimited",
        after: "2 included",
      },
    ]);
  });

  it("is total on junk", () => {
    expect(contentChanges(null, undefined)).toEqual([]);
    expect(() => contentChanges({ names: "x", pricing: 3 }, { names: [null], adjustments: {} })).not.toThrow();
  });
});

describe("changedColumns and buildChanges", () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({
      content: sevetri(),
      client_name: "Sevetri Wilson",
      client_email: null,
      title: "Trademark Proposal",
      expires_on: null,
      pay_url: null,
      lead_id: null,
      matter_id: null,
      ...over,
    }) as Parameters<typeof buildChanges>[0];

  it("lists only the columns in the patch that differ", () => {
    expect(changedColumns(row(), { client_name: "Sevetri Wilson", expires_on: "2026-10-26" })).toEqual(["expires_on"]);
    expect(changedColumns(row(), {})).toEqual([]);
    expect(changedColumns(row(), { content: JSON.parse(JSON.stringify(sevetri())) })).toEqual([]);
  });

  it("buildChanges merges content and plain-column changes and caps the list", () => {
    const before = row();
    const after = row({ title: "Revised proposal", expires_on: "2026-10-26" });
    after.content.pricing.base_cents = 1;
    const changes = buildChanges(before, after, ["content", "title", "expires_on"]);
    expect(changes.map((c) => c.path)).toEqual(["pricing.base_cents", "title", "expires_on"]);
    expect(changes[1]).toMatchObject({ label: "Title", before: "Trademark Proposal", after: "Revised proposal" });

    const big = row();
    big.content.adjustments = Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, label: `A${i}`, kind: "amount" as const, value: i }));
    expect(buildChanges(row(), big, ["content"]).length).toBe(60);
  });
});

describe("offerTotals", () => {
  it("is the firm's preselected offer", () => {
    expect(offerTotals(sevetri())).toEqual({ legal_total_cents: 1_782_000, gov_total_cents: 280_000 });
  });
});

describe("checkDraftColumns", () => {
  it("accepts a good draft", () => {
    expect(() =>
      checkDraftColumns({
        clientName: "Sevetri Wilson",
        clientEmail: "s@example.com",
        title: "Trademark Proposal",
        expiresOn: "2026-10-26",
        payUrl: "https://app.lawmatics.com/forms/x",
        content: sevetri(),
      }),
    ).not.toThrow();
    expect(() => checkDraftColumns({})).not.toThrow();
  });

  it.each([
    [{ clientName: "  " }],
    [{ clientName: "x".repeat(301) }],
    [{ title: "" }],
    [{ clientEmail: "nope" }],
    [{ expiresOn: "tomorrow" }],
    [{ payUrl: "http://insecure.example" }],
    [{ content: null }],
    [{ content: [] }],
    [{ content: { greeting: "x".repeat(300 * 1024) } }],
  ])("refuses %j with a ProposalError", (input) => {
    try {
      checkDraftColumns(input as Parameters<typeof checkDraftColumns>[0]);
      throw new Error("did not throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ProposalError);
      expect((e as ProposalError).code).toBe("validation");
    }
  });

  it("a draft with firm-rule problems is still saveable (only approval refuses them)", () => {
    const c = sevetri();
    c.greeting = "IC 9";
    expect(() => checkDraftColumns({ content: c })).not.toThrow();
  });
});

describe("generateProposalToken and isWellFormedProposalToken", () => {
  it("makes 43-character base64url tokens that differ every time", () => {
    const a = generateProposalToken();
    const b = generateProposalToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isWellFormedProposalToken(a)).toBe(true);
  });

  it.each(["", "short", "a".repeat(31), "a".repeat(65), `${"a".repeat(40)}.x`, `${"a".repeat(40)}=`, `${"a".repeat(40)},b`, `${"a".repeat(40)}/..`, null, undefined, 5])(
    "refuses %j",
    (t) => {
      expect(isWellFormedProposalToken(t)).toBe(false);
    },
  );
  it("accepts the 32 and 64 character bounds", () => {
    expect(isWellFormedProposalToken("a".repeat(32))).toBe(true);
    expect(isWellFormedProposalToken("a".repeat(64))).toBe(true);
  });
});

describe("lifecycle vocabulary", () => {
  it("allows exactly the moves the 0089 trigger allows", () => {
    const allowed = [
      ["draft", "approved"],
      ["approved", "draft"],
      ["approved", "sent"],
      ["draft", "withdrawn"],
      ["approved", "withdrawn"],
      ["sent", "withdrawn"],
      ["sent", "superseded"],
      ["sent", "accepted"],
    ];
    const all = ["draft", "approved", "sent", "superseded", "accepted", "withdrawn"];
    for (const from of all) {
      for (const to of all) {
        expect(canTransitionProposal(from, to), `${from} -> ${to}`).toBe(allowed.some(([f, t]) => f === from && t === to));
      }
    }
    expect(canTransitionProposal("bogus", "draft")).toBe(false);
  });

  it("only draft and approved are editable", () => {
    expect(["draft", "approved", "sent", "accepted", "superseded", "withdrawn"].filter(isProposalEditable)).toEqual(["draft", "approved"]);
  });

  it("role lists are real roles, and the admin tier is inside the staff tier", () => {
    for (const r of [...PROPOSAL_STAFF_WRITE_ROLES, ...PROPOSAL_ADMIN_ROLES]) expect(ROLES).toContain(r);
    for (const r of PROPOSAL_ADMIN_ROLES) expect(PROPOSAL_STAFF_WRITE_ROLES).toContain(r);
    expect(PROPOSAL_STAFF_WRITE_ROLES).not.toContain("viewer");
    expect(PROPOSAL_STAFF_WRITE_ROLES).not.toContain("social_media");
  });
});

describe("standardProposalPricing", () => {
  it("falls back to the RPB defaults when the setting is empty or junk", () => {
    for (const raw of [{}, null, undefined, "x", [], { base_cents: "495000", per_class_cents: -1, second_mark_discount_pct: 400, includes: "no" }]) {
      const s = standardProposalPricing(raw);
      expect(s.pricing).toEqual(DEFAULT_PROPOSAL_PRICING);
      expect(s.includes).toEqual(DEFAULT_PROPOSAL_INCLUDES);
    }
  });

  it("uses the firm's values where they are well-formed", () => {
    const s = standardProposalPricing({
      package: "Signature",
      base_cents: 300_000,
      second_mark_discount_pct: 15,
      includes: [{ label: "Search", included: "✓" }, { nope: true }],
    });
    expect(s.pricing).toEqual({ ...DEFAULT_PROPOSAL_PRICING, package: "Signature", base_cents: 300_000, second_mark_discount_pct: 15 });
    expect(s.includes).toEqual([{ label: "Search", included: "✓" }]);
  });

  it("the defaults are the Sevetri numbers in cents and pass validation", () => {
    expect(DEFAULT_PROPOSAL_PRICING).toEqual({
      package: "Concierge",
      base_cents: 495_000,
      included_classes: 3,
      per_class_cents: 82_500,
      second_mark_discount_pct: 20,
      gov_per_class_cents: 35_000,
    });
    const c = sevetri();
    c.includes = DEFAULT_PROPOSAL_INCLUDES;
    expect(validateContent(c)).toEqual([]);
    expect(quoteProposal(c, defaultSelection(c)).legal_total_cents).toBe(1_782_000);
  });
});

describe("friendlyProposalError", () => {
  it("never repeats the database's own text", () => {
    const e = friendlyProposalError({ code: "XX000", message: 'relation "client_proposal" violates trigger client_proposal_guard' });
    expect(e).toBeInstanceOf(ProposalError);
    expect(e.code).toBe("unavailable");
    expect(e.message).not.toMatch(/client_proposal|trigger|XX000/);
  });

  it.each([
    [{ code: "42501", message: "x" }, "forbidden"],
    [{ message: 'new row violates row-level security policy for table "client_proposal"' }, "forbidden"],
    [{ message: "only the firm's approvers may approve a proposal" }, "forbidden"],
    [{ message: "only the service role can accept" }, "forbidden"],
    [{ message: "a sent proposal is frozen: create a new version" }, "frozen"],
    [{ message: "illegal status transition draft -> accepted" }, "conflict"],
    [{ code: "23505", message: "duplicate key" }, "conflict"],
    [{ code: "23503", message: "fk" }, "validation"],
    [{ code: "23514", message: "check" }, "validation"],
    [null, "unavailable"],
  ])("%j is %s", (err, code) => {
    expect(friendlyProposalError(err as never).code).toBe(code);
  });

  // The exact texts lectual 0089's trigger and client_proposal_send raise.
  it.each([
    [
      "42501",
      "client_proposal_not_approver: you are not one of this firm's proposal approvers",
      "forbidden",
      /named approvers/,
    ],
    [
      "42501",
      "client_proposal_accept_service_only: only the service role, recording the client's acceptance on the proposal page, can accept a proposal",
      "forbidden",
      /Only the client/,
    ],
    ["23514", "client_proposal_frozen: a sent proposal is frozen and cannot be edited; revise it as a new version", "frozen", /new version/],
    ["23514", "client_proposal_bad_transition: sent -> draft is not allowed", "conflict", /can't move/],
    [
      "23514",
      "client_proposal_edit_and_move: edit an approved proposal and make a status transition in separate steps",
      "conflict",
      /separate steps/,
    ],
    ["23514", "client_proposal_approval_incomplete: set an expiry date and a pay link before approving", "validation", /expiry date and a pay link/],
    ["23514", "client_proposal_send_not_approved: only an approved proposal can be sent (this one is draft)", "conflict", /turned on for a saved version/],
    [
      "23514",
      "client_proposal_family_accepted: the client has already accepted a version of this proposal",
      "conflict",
      /already accepted/,
    ],
    ["P0002", "client_proposal_not_found: no proposal 00000000-0000-0000-0000-000000000000 in this firm", "not_found", /not found/],
  ])("%s %s", (code, message, kind, text) => {
    const e = friendlyProposalError({ code, message });
    expect(e.code).toBe(kind);
    expect(e.message).toMatch(text);
    expect(e.message).not.toMatch(/client_proposal_/);
  });
});
