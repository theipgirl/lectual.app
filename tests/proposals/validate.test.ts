import { describe, it, expect } from "vitest";

import {
  hasErrors,
  isCivilDate,
  offersSubstantiveOfficeActionResponse,
  validateContent,
  validateSettingInput,
  type ValidationIssue,
} from "@/lib/proposals/validate";
import type { ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

const errors = (issues: ValidationIssue[]) => issues.filter((i) => i.level === "error");
const warnings = (issues: ValidationIssue[]) => issues.filter((i) => i.level === "warning");
const at = (issues: ValidationIssue[], path: string) => issues.filter((i) => i.path === path);

/** A row that is ready to approve. */
const READY = {
  forApproval: true,
  title: "Trademark Proposal",
  expires_on: "2026-10-26",
  pay_url: "https://app.lawmatics.com/forms/share/abc",
  client_email: "sevetri@example.com",
} as const;

describe("validateContent: the Sevetri proposal", () => {
  it("is clean, with no errors and no warnings", () => {
    expect(validateContent(sevetri())).toEqual([]);
  });

  it("is ready to approve when the row has expiry, pay link and email", () => {
    expect(validateContent(sevetri(), READY)).toEqual([]);
  });
});

describe("validateContent: International Class numbers are never client-facing", () => {
  const withGreeting = (text: string): ProposalContent => ({ ...sevetri(), greeting: text });

  it.each([
    "We will file in IC 035 and IC 9.",
    "This covers International Class 9.",
    "Filing in International Classes 9 and 42.",
    "Your Class 25 goods are clothing.",
    "Your Class 025 goods.",
    "Covers Class 09.",
    "Covers class 42 services.",
    "See IC035.",
  ])("errors on %j", (text) => {
    const issues = validateContent(withGreeting(text));
    expect(errors(issues).map((i) => i.path)).toContain("greeting");
  });

  it("catches it in every client-facing field", () => {
    const c = sevetri();
    c.recommendation = "IC 9 is best";
    c.office_action_note = "Class 35 office actions";
    c.pricing.package = "Class 25 package";
    c.names[0].name = "Prosperall (IC 42)";
    c.names[0].what = "Class 09 goods";
    c.names[0].note = "**Note** International Class 9";
    c.names[0].marks[0].desc = "Protects Class 25";
    c.names[0].classes[0].label = "Class 35 services";
    c.adjustments = [{ id: "a", label: "IC 9 credit", kind: "amount", value: 100 }];
    c.includes[0].label = "Class 25 included";
    c.includes[0].value = "IC 9";
    c.includes[0].included = "Class 35";
    c.includes[0].note = "Class 09";
    const paths = errors(validateContent(c)).map((i) => i.path);
    for (const expected of [
      "recommendation",
      "office_action_note",
      "pricing.package",
      "names[0].name",
      "names[0].what",
      "names[0].note",
      "names[0].marks[0].desc",
      "names[0].classes[0].label",
      "adjustments[0].label",
      "includes[0].label",
      "includes[0].value",
      "includes[0].included",
      "includes[0].note",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("also checks the row title", () => {
    const issues = validateContent(sevetri(), { title: "Proposal for IC 9" });
    expect(at(issues, "title")[0]?.level).toBe("error");
  });

  it("does not mistake ordinary words for it", () => {
    const c = sevetri();
    c.greeting = "A classic, classy approach. Our Classes included are listed below. Basic 3-step plan, public 5 times.";
    expect(validateContent(c)).toEqual([]);
  });

  it("'Class 1', 'Class 2' and 'Class 3' counting labels are allowed, with a warning", () => {
    for (const n of [1, 2, 3]) {
      const issues = validateContent({ ...sevetri(), recommendation: `Class ${n} is your first filing.` });
      expect(errors(issues)).toEqual([]);
      expect(warnings(issues).map((i) => i.path)).toContain("recommendation");
    }
  });

  it("a bare 'Class 9' is a warning, not a blocker (it may be a counting label for a 9th class)", () => {
    const issues = validateContent({ ...sevetri(), recommendation: "Your Class 4 filing." });
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).toHaveLength(1);
  });
});

describe("validateContent: the substantive office action response is never in a package", () => {
  const labelIssues = (label: string) => {
    const c = sevetri();
    c.includes.push({ label, included: "✓" });
    return at(validateContent(c), `includes[${c.includes.length - 1}].label`);
  };

  it.each([
    "Substantive Office Action Response",
    "Substantive Office Action Responses (unlimited)",
    "Office Action Response, Substantive",
    "Office Action Response",
    "substantive office-action response",
  ])("errors on %j", (label) => {
    expect(labelIssues(label).map((i) => i.level)).toEqual(["error"]);
  });

  it.each([
    "Non-Substantive Office Action Response",
    "Non Substantive Office Action Response",
    "Nonsubstantive Office Action Response",
    "Substantive Office Action Legal Strategy Review",
    "Office Action Strategy Review",
    "Statement of Use Legal Fee",
    "Office hours",
  ])("allows %j", (label) => {
    expect(labelIssues(label)).toEqual([]);
  });

  it("is exported as a predicate", () => {
    expect(offersSubstantiveOfficeActionResponse("Substantive Office Action Response")).toBe(true);
    expect(offersSubstantiveOfficeActionResponse("Substantive Office Action Legal Strategy Review")).toBe(false);
  });
});

describe("validateContent: ids", () => {
  it("duplicate mark ids, even across brand names", () => {
    const c = sevetri();
    c.names[1].marks[0].id = "p-word";
    const e = errors(validateContent(c));
    expect(e.map((i) => i.path)).toContain("names[1].marks[0].id");
    expect(e[0].message).toMatch(/p-word/);
  });

  it("a class id colliding with a mark id", () => {
    const c = sevetri();
    c.names[0].classes[0].id = "p-logo";
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("names[0].classes[0].id");
  });

  it("duplicate brand name ids and duplicate adjustment ids", () => {
    const c = sevetri();
    c.names[1].id = "p";
    c.adjustments = [
      { id: "a", label: "One", kind: "amount", value: 1 },
      { id: "a", label: "Two", kind: "amount", value: 1 },
    ];
    const paths = errors(validateContent(c)).map((i) => i.path);
    expect(paths).toContain("names[1].id");
    expect(paths).toContain("adjustments[1].id");
  });

  it("a blank id", () => {
    const c = sevetri();
    c.names[0].marks[0].id = "  ";
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("names[0].marks[0].id");
  });
});

describe("validateContent: money and percentages", () => {
  it.each([
    ["a float", 4950.5],
    ["negative", -1],
    ["a string", "495000"],
    ["NaN", NaN],
    ["null", null],
  ])("package money that is %s", (_n, value) => {
    for (const key of ["base_cents", "per_class_cents", "gov_per_class_cents"] as const) {
      const c = sevetri();
      (c.pricing as unknown as Record<string, unknown>)[key] = value;
      expect(errors(validateContent(c)).map((i) => i.path)).toContain(`pricing.${key}`);
    }
  });

  it("zero is valid money", () => {
    const c = sevetri();
    c.pricing.gov_per_class_cents = 0;
    expect(validateContent(c)).toEqual([]);
  });

  it("override money", () => {
    const c = sevetri();
    c.names[0].price_override = { base_cents: 4500.5, per_class_cents: -5 };
    const paths = errors(validateContent(c)).map((i) => i.path);
    expect(paths).toContain("names[0].price_override.base_cents");
    expect(paths).toContain("names[0].price_override.per_class_cents");
  });

  it("an empty override is fine", () => {
    const c = sevetri();
    c.names[0].price_override = {};
    expect(validateContent(c)).toEqual([]);
  });

  it.each([-1, 101, NaN])("second-mark discount of %s", (pct) => {
    const c = sevetri();
    c.pricing.second_mark_discount_pct = pct;
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("pricing.second_mark_discount_pct");
  });

  it.each([0, 20, 12.5, 100])("second-mark discount of %s is fine", (pct) => {
    const c = sevetri();
    c.pricing.second_mark_discount_pct = pct;
    expect(at(validateContent(c), "pricing.second_mark_discount_pct")).toEqual([]);
  });

  it("included classes must be a whole number", () => {
    const c = sevetri();
    c.pricing.included_classes = 2.5;
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("pricing.included_classes");
  });

  it("adjustment amounts are whole cents; percents are 0..100", () => {
    const c = sevetri();
    c.adjustments = [
      { id: "a", label: "A", kind: "amount", value: 12.5 },
      { id: "b", label: "B", kind: "amount", value: -100 },
      { id: "c", label: "C", kind: "percent", value: 101 },
      { id: "d", label: "D", kind: "percent", value: -1 },
      { id: "e", label: "E", kind: "amount", value: 45_000 },
      { id: "f", label: "F", kind: "percent", value: 12.5 },
    ];
    const paths = errors(validateContent(c)).map((i) => i.path);
    expect(paths).toEqual([
      "adjustments[0].value",
      "adjustments[1].value",
      "adjustments[2].value",
      "adjustments[3].value",
    ]);
  });

  it("an unknown adjustment kind", () => {
    const c = sevetri();
    c.adjustments = [{ id: "a", label: "A", kind: "bogus" as "amount", value: 1 }];
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("adjustments[0].kind");
  });
});

describe("validateContent: something to buy", () => {
  it("no brand names", () => {
    const c = sevetri();
    c.names = [];
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("names");
  });

  it("a brand name with marks but no classes", () => {
    const c = sevetri();
    c.names = [{ ...c.names[0], classes: [] }];
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("names");
  });

  it("a brand name with classes but no marks", () => {
    const c = sevetri();
    c.names = [{ ...c.names[0], marks: [] }];
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("names");
  });

  it("one buyable brand is enough even if another is empty", () => {
    const c = sevetri();
    c.names[1].marks = [];
    expect(at(validateContent(c), "names")).toEqual([]);
  });

  it("a mark must be word or logo; preselected must be a boolean", () => {
    const c = sevetri();
    (c.names[0].marks[0] as unknown as Record<string, unknown>).kind = "design";
    (c.names[0].marks[1] as unknown as Record<string, unknown>).preselected = "yes";
    const paths = errors(validateContent(c)).map((i) => i.path);
    expect(paths).toContain("names[0].marks[0].kind");
    expect(paths).toContain("names[0].marks[1].preselected");
  });

  it("a blank mark description is a warning, a blank class label an error", () => {
    const c = sevetri();
    c.names[0].marks[0].desc = " ";
    c.names[0].classes[0].label = "";
    const issues = validateContent(c);
    expect(at(issues, "names[0].marks[0].desc")[0].level).toBe("warning");
    expect(at(issues, "names[0].classes[0].label")[0].level).toBe("error");
  });
});

describe("validateContent: the pay link", () => {
  it.each(["http://app.lawmatics.com/forms/x", "javascript:alert(1)", "app.lawmatics.com/forms/x", "ftp://x.com", "https://", "not a url"])(
    "rejects %j",
    (pay_url) => {
      expect(errors(validateContent(sevetri(), { pay_url })).map((i) => i.path)).toContain("pay_url");
    },
  );

  it("accepts https and ignores an empty one for a draft", () => {
    expect(validateContent(sevetri(), { pay_url: "https://app.lawmatics.com/forms/share/abc" })).toEqual([]);
    expect(validateContent(sevetri(), { pay_url: "" })).toEqual([]);
    expect(validateContent(sevetri(), { pay_url: null })).toEqual([]);
  });

  it("rejects an absurdly long one", () => {
    expect(errors(validateContent(sevetri(), { pay_url: "https://x.com/" + "a".repeat(2000) })).map((i) => i.path)).toContain("pay_url");
  });
});

describe("validateContent: forApproval", () => {
  it("a draft without expiry, pay link or email is fine", () => {
    expect(validateContent(sevetri(), { title: "Trademark Proposal" })).toEqual([]);
  });

  it("approval requires expires_on, pay_url and the client's email", () => {
    const issues = validateContent(sevetri(), { forApproval: true });
    expect(errors(issues).map((i) => i.path).sort()).toEqual(["client_email", "expires_on", "pay_url"]);
  });

  it("each one is checked independently", () => {
    for (const missing of ["expires_on", "pay_url", "client_email"] as const) {
      const issues = validateContent(sevetri(), { ...READY, [missing]: null });
      expect(errors(issues).map((i) => i.path)).toEqual([missing]);
    }
    expect(validateContent(sevetri(), { ...READY, client_email: "   " }).map((i) => i.path)).toEqual(["client_email"]);
  });

  it("a malformed expiry or email is an error even for a draft", () => {
    expect(errors(validateContent(sevetri(), { expires_on: "10/26/2026" })).map((i) => i.path)).toEqual(["expires_on"]);
    expect(errors(validateContent(sevetri(), { expires_on: "2026-02-30" })).map((i) => i.path)).toEqual(["expires_on"]);
    expect(errors(validateContent(sevetri(), { client_email: "not-an-email" })).map((i) => i.path)).toEqual(["client_email"]);
  });

  it("content problems still block approval", () => {
    const c = sevetri();
    c.greeting = "Filing in IC 9.";
    expect(hasErrors(validateContent(c, READY))).toBe(true);
  });

  it("warnings do not block approval", () => {
    const issues = validateContent({ ...sevetri(), recommendation: "Class 1 first." }, READY);
    expect(hasErrors(issues)).toBe(false);
    expect(warnings(issues)).not.toEqual([]);
  });
});

describe("validateContent: total, never throwing", () => {
  it.each([null, undefined, 42, "text", [], true])("content of %j is an error, not a throw", (content) => {
    const issues = validateContent(content, READY);
    expect(errors(issues).map((i) => i.path)).toContain("content");
  });

  it("junk inside a valid shell", () => {
    const junk = {
      client: "Sevetri",
      greeting: 7,
      pricing: [],
      names: [null, 5, { id: 1, marks: "x", classes: {} }],
      adjustments: [null, "x"],
      includes: [null, 3, { label: 4 }],
    };
    expect(() => validateContent(junk, READY)).not.toThrow();
    expect(hasErrors(validateContent(junk, READY))).toBe(true);
  });

  it("a circular document does not throw", () => {
    const loop: Record<string, unknown> = { ...sevetri() };
    loop.self = loop;
    expect(() => validateContent(loop)).not.toThrow();
    expect(errors(validateContent(loop)).map((i) => i.path)).toContain("content");
  });

  it("a document over 256KB is refused", () => {
    const c = sevetri();
    c.greeting = "x".repeat(300 * 1024);
    expect(errors(validateContent(c)).map((i) => i.path)).toContain("content");
  });

  it("requires the client and greeting", () => {
    const c = sevetri();
    c.client.full_name = "";
    c.greeting = "";
    const paths = errors(validateContent(c)).map((i) => i.path);
    expect(paths).toContain("client.full_name");
    expect(paths).toContain("greeting");
  });
});

describe("isCivilDate", () => {
  it("accepts real dates only", () => {
    expect(isCivilDate("2026-10-26")).toBe(true);
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(isCivilDate("2026-02-29")).toBe(false);
    expect(isCivilDate("2026-13-01")).toBe(false);
    expect(isCivilDate("2026-10-26T00:00:00Z")).toBe(false);
    expect(isCivilDate("")).toBe(false);
  });
});

describe("validateSettingInput", () => {
  const ok = {
    approver_user_ids: ["11111111-1111-4111-8111-111111111111"],
    default_pay_url: "https://app.lawmatics.com/forms/share/x",
    notify_email: "rebecca@example.com",
    pricing: { base_cents: 495_000, included_classes: 3, second_mark_discount_pct: 20 },
  };

  it("accepts a good setting, and empty optionals", () => {
    expect(validateSettingInput(ok)).toEqual([]);
    expect(validateSettingInput({ ...ok, default_pay_url: null, notify_email: "", approver_user_ids: [], pricing: {} })).toEqual([]);
  });

  it("at most 10 approvers, each a uuid, no repeats", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`);
    expect(errors(validateSettingInput({ ...ok, approver_user_ids: ids })).map((i) => i.path)).toContain("approver_user_ids");
    expect(errors(validateSettingInput({ ...ok, approver_user_ids: ["rebecca"] })).map((i) => i.path)).toContain("approver_user_ids");
    expect(errors(validateSettingInput({ ...ok, approver_user_ids: [ok.approver_user_ids[0], ok.approver_user_ids[0]] }))).toHaveLength(1);
    expect(errors(validateSettingInput({ ...ok, approver_user_ids: "x" })).map((i) => i.path)).toContain("approver_user_ids");
  });

  it("https pay link and a real email", () => {
    expect(errors(validateSettingInput({ ...ok, default_pay_url: "http://x.com" })).map((i) => i.path)).toEqual(["default_pay_url"]);
    expect(errors(validateSettingInput({ ...ok, notify_email: "nope" })).map((i) => i.path)).toEqual(["notify_email"]);
  });

  it("standard pricing: money, percent, and the office action rule apply to the includes list", () => {
    const bad = {
      ...ok,
      pricing: {
        base_cents: 4950.5,
        second_mark_discount_pct: 150,
        includes: [{ label: "Substantive Office Action Response", included: "✓" }, { label: "Filing in IC 9", included: "✓" }],
      },
    };
    const paths = errors(validateSettingInput(bad)).map((i) => i.path);
    expect(paths).toContain("pricing.base_cents");
    expect(paths).toContain("pricing.second_mark_discount_pct");
    expect(paths).toContain("pricing.includes[0].label");
    expect(paths).toContain("pricing.includes[1].label");
    expect(errors(validateSettingInput({ ...ok, pricing: [] })).map((i) => i.path)).toEqual(["pricing"]);
  });
});
