import { describe, it, expect } from "vitest";
import { describeChange, describeProposalEvent, formatChangeValue, formatDollars } from "@/lib/proposal-editor/events";
import { describeIssuePath, groupIssues } from "@/lib/proposal-editor/issues";
import { contentChanges } from "@/lib/proposals/diff";
import { validateContent } from "@/lib/proposals/validate";
import type { ProposalEventRow } from "@/lib/proposals/types";
import { sevetri } from "../proposals/fixture";

const names = new Map([["u1", "Taylor"], ["u2", "Rebecca"]]);

function event(over: Partial<ProposalEventRow>): ProposalEventRow {
  return {
    id: "e1",
    org_id: "o",
    proposal_id: "p1",
    family_id: "f",
    type: "edited",
    actor: "staff",
    actor_user_id: "u1",
    payload: {},
    created_at: "2026-10-20T18:14:00Z",
    ...over,
  };
}

describe("formatDollars", () => {
  it("drops .00 and keeps real cents", () => {
    expect(formatDollars(495000)).toBe("$4,950");
    expect(formatDollars(450050)).toBe("$4,500.50");
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(Number.NaN)).toBe("—");
  });
  it("formats each change format", () => {
    expect(formatChangeValue("pct", 20)).toBe("20%");
    expect(formatChangeValue("bool", true)).toBe("yes");
    expect(formatChangeValue("text", "Hello")).toBe("“Hello”");
    expect(formatChangeValue("cents", null)).toBe("blank");
  });
});

describe("an edited event reads as a sentence", () => {
  it("says who changed which price from what to what", () => {
    const before = sevetri();
    const after = sevetri();
    after.pricing.base_cents = 450000;
    const changes = contentChanges(before, after);
    const line = describeProposalEvent(
      event({ payload: { fields: ["content"], legal_total_before: 800000, legal_total_after: 755000, reset_to_draft: false, changes } }),
      { names },
    );
    expect(line.who).toBe("Taylor");
    expect(line.what).toBe("changed the Concierge base price from $4,950 to $4,500");
    expect(line.details).toEqual(["The legal fee at the default selection went from $8,000 to $7,550."]);
  });

  it("summarises several changes and lists them", () => {
    const before = sevetri();
    const after = sevetri();
    after.pricing.base_cents = 450000;
    after.names[0].name = "Prosperall Inc";
    after.adjustments.push({ id: "a1", label: "Consultation credit", kind: "amount", value: 45000 });
    const line = describeProposalEvent(
      event({ payload: { changes: contentChanges(before, after), reset_to_draft: true, legal_total_before: 5, legal_total_after: 5 } }),
      { names },
    );
    expect(line.what).toMatch(/^changed the Concierge base price from \$4,950 to \$4,500, and \d other changes$/);
    expect(line.details.length).toBeGreaterThanOrEqual(3);
    expect(line.details.every((d) => d[0] === d[0].toUpperCase())).toBe(true);
    expect(line.details.some((d) => d.includes("Consultation credit"))).toBe(true);
    expect(line.details.at(-1)).toBe("It was saved, so it went back to draft and needs saving again.");
  });

  it("describes adds, removes and renames of brands, marks, classes and rows", () => {
    const before = sevetri();
    const after = sevetri();
    after.names[0].marks.pop();
    after.names[1].classes.push({ id: "t-c3", label: "Coaching", preselected: false });
    after.names.push({ id: "z", name: "Zed", marks: [], classes: [] });
    after.includes.push({ label: "Extra review", included: "✓" });
    const sentences = contentChanges(before, after).map(describeChange);
    expect(sentences).toContain("removed the Logo mark from Prosperall");
    expect(sentences).toContain("added the class “Coaching” to Tech4PublicGood");
    expect(sentences).toContain("added the brand name “Zed”");
    expect(sentences).toContain("added “Extra review” to what’s included");
  });

  it("uses a possessive for brand-specific fields and says cleared for a removed value", () => {
    const before = sevetri();
    before.names[0].price_override = { base_cents: 400000 };
    const after = sevetri();
    const sentences = contentChanges(before, after).map(describeChange);
    expect(sentences).toContain("cleared Prosperall’s base price (it was $4,000)");
  });

  it("degrades to something honest when the payload is unreadable", () => {
    expect(describeProposalEvent(event({ payload: {} }), { names }).what).toBe("edited the proposal");
    expect(describeProposalEvent(event({ payload: { fields: ["client_name", "pay_url"] } }), { names }).what).toBe("edited client name, pay url");
    expect(describeProposalEvent(event({ payload: { changes: "nope" } as never }), { names }).what).toBe("edited the proposal");
  });
});

describe("the other events", () => {
  it("names the actor by role when there is no user", () => {
    expect(describeProposalEvent(event({ type: "viewed", actor: "client", actor_user_id: null }), { names })).toMatchObject({ who: "The client", what: "opened the proposal" });
    expect(describeProposalEvent(event({ type: "accepted", actor: "client", actor_user_id: null }), { names }).what).toBe("accepted the proposal");
    expect(describeProposalEvent(event({ type: "approved", actor_user_id: "u2" }), { names })).toMatchObject({ who: "Rebecca", what: "saved it" });
    expect(describeProposalEvent(event({ type: "approved", actor_user_id: "ghost" }), { names }).who).toBe("A teammate");
  });
  it("says which version", () => {
    const versions = new Map([["p1", 2]]);
    expect(describeProposalEvent(event({ type: "created" }), { names, versions }).what).toBe("created version 2");
    expect(describeProposalEvent(event({ type: "revised", payload: { from_version: 1, version: 2 } }), { names }).what).toBe("started version 2 from version 1");
  });

  it("reads the trigger's status payloads ({from, to, version, reason?})", () => {
    // superseded: `version` is the replaced row's own number, never the newer one.
    const sup = describeProposalEvent(event({ type: "superseded", payload: { from: "sent", to: "superseded", version: 1 } }), { names });
    expect(sup.what).toBe("turned on a newer version, which replaced this one");
    expect(sup.what).not.toMatch(/version 1/);
    expect(
      describeProposalEvent(event({ type: "unapproved", payload: { from: "approved", to: "draft", version: 1, reason: "edited_after_approval" } }), { names }).what,
    ).toBe("edited it after it was saved, so it went back to draft");
    expect(describeProposalEvent(event({ type: "unapproved", payload: { from: "approved", to: "draft", version: 1 } }), { names }).what).toBe(
      "took it back to editing",
    );
    expect(describeProposalEvent(event({ type: "sent" }), { names }).what).toContain("nothing was emailed");
  });
});

describe("issues land on the section that can fix them", () => {
  it("groups by section and names the place in words", () => {
    const c = sevetri();
    c.greeting = "See International Class 9";
    c.names[0].marks[1].desc = "Class 25 goods";
    c.pricing.base_cents = -1;
    c.adjustments.push({ id: "a", label: "", kind: "amount", value: 1 });
    c.includes.push({ label: "Office Action Response", included: "✓" });
    const issues = validateContent(c, { forApproval: true });
    const g = groupIssues(issues);
    expect(g.message.some((i) => i.path === "greeting")).toBe(true);
    expect(g.pricing.some((i) => i.path === "pricing.base_cents")).toBe(true);
    expect(g.names.get(0)?.some((i) => i.path === "names[0].marks[1].desc")).toBe(true);
    expect(g.adjustments.length).toBeGreaterThan(0);
    expect(g.includes.length).toBeGreaterThan(0);
    expect(g.details.map((i) => i.path).sort()).toEqual(["client_email", "pay_url"]);
    expect(g.pricing.some((i) => i.path === "expires_on")).toBe(true);
    expect(describeIssuePath("names[0].marks[1].desc", c)).toBe("Prosperall, mark 2, description");
    expect(describeIssuePath("pricing.base_cents", c)).toBe("package prices, base price");
    expect(describeIssuePath("expires_on", c)).toBe("expiry date");
    expect(describeIssuePath("names[9].classes[0].label", c)).toBe("Brand name 10, class 1, label");
  });
});
