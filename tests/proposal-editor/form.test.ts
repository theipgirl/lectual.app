import { describe, it, expect } from "vitest";
import {
  buildNewContent,
  cleanId,
  collectRows,
  defaultGreeting,
  newBrandName,
  parseAdjustments,
  parseDetails,
  parseIncludes,
  parseMessage,
  parseMoney,
  parseName,
  parsePercent,
  parsePricing,
  parseSettingsPricing,
  removeName,
  replaceName,
} from "@/lib/proposal-editor/form";
import { standardProposalPricing } from "@/lib/proposals/types";
import { quoteProposal, defaultSelection } from "@/lib/proposals/pricing";
import { validateContent } from "@/lib/proposals/validate";
import { sevetri } from "../proposals/fixture";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

let n = 0;
const rand = () => `r${(n++).toString(36)}`;

describe("money and percent fields", () => {
  it("turns dollars into integer cents without a float multiply", () => {
    expect(parseMoney("4,950", "x")).toEqual({ ok: true, value: 495000 });
    expect(parseMoney("$4950.5", "x")).toEqual({ ok: true, value: 495050 });
    expect(parseMoney("1.005", "x").ok).toBe(false); // a third decimal is a typo, not a rounding
    expect(parseMoney("8.1", "x")).toEqual({ ok: true, value: 810 });
  });
  it("refuses negatives and words, naming the field", () => {
    const r = parseMoney("-5", "Base price");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Base price");
    expect(parseMoney("free", "x").ok).toBe(false);
    expect(parseMoney("", "x").ok).toBe(false);
  });
  it("reads percentages 0..100", () => {
    expect(parsePercent("20", "x")).toEqual({ ok: true, value: 20 });
    expect(parsePercent("12.5%", "x")).toEqual({ ok: true, value: 12.5 });
    expect(parsePercent("101", "x").ok).toBe(false);
    expect(parsePercent("-1", "x").ok).toBe(false);
    expect(parsePercent("abc", "x").ok).toBe(false);
  });
});

describe("collectRows", () => {
  it("orders rows by index and fills missing fields with blanks", () => {
    const rows = collectRows(fd({ "mark.2.id": "c", "mark.0.id": "a", "mark.0.desc": " hi ", "mark.1.id": "b", other: "x" }), "mark", ["id", "desc"]);
    expect(rows).toEqual([
      { id: "a", desc: "hi" },
      { id: "b", desc: "" },
      { id: "c", desc: "" },
    ]);
  });
  it("does not confuse prefixes", () => {
    expect(collectRows(fd({ "marks.0.id": "a" }), "mark", ["id"])).toEqual([]);
  });
});

describe("cleanId", () => {
  it("keeps a good unused id and replaces a bad or taken one", () => {
    const taken = new Set<string>(["t1"]);
    expect(cleanId("ok-1", "m", taken, rand)).toBe("ok-1");
    expect(cleanId("ok-1", "m", taken, rand)).not.toBe("ok-1");
    expect(cleanId("t1", "m", taken, rand)).not.toBe("t1");
    expect(cleanId("has space", "m", taken, rand)).toMatch(/^m-/);
    expect(cleanId("", "c", taken, rand)).toMatch(/^c-/);
  });
});

describe("details, message and pricing sections", () => {
  it("keeps client_name in step with the full name, and drops an empty company", () => {
    const r = parseDetails(
      fd({ fullName: "Sevetri Wilson", firstName: "Sevetri", company: "", clientEmail: "s@example.com", title: "Trademark Proposal", expiresOn: "2026-11-01", payUrl: "https://pay.example.com/x" }),
      sevetri(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.clientName).toBe("Sevetri Wilson");
      expect(r.value.content.client).toEqual({ first_name: "Sevetri", full_name: "Sevetri Wilson" });
      expect(r.value.expiresOn).toBe("2026-11-01");
    }
  });
  it("refuses an impossible date and a missing name", () => {
    expect(parseDetails(fd({ fullName: "A", firstName: "A", title: "T", expiresOn: "2026-02-31" }), sevetri()).ok).toBe(false);
    expect(parseDetails(fd({ fullName: " ", firstName: "A", title: "T" }), sevetri()).ok).toBe(false);
  });
  it("removes optional text when blanked", () => {
    const r = parseMessage(fd({ greeting: "Hello", recommendation: "", officeActionNote: "" }), sevetri());
    expect(r.ok && "recommendation" in r.value).toBe(false);
    expect(r.ok && "office_action_note" in r.value).toBe(false);
    expect(r.ok && r.value.greeting).toBe("Hello");
  });
  it("reads the six prices from dollars", () => {
    const r = parsePricing(fd({ package: "Concierge", base: "4950", includedClasses: "3", perClass: "825", secondMarkPct: "20", govPerClass: "350" }));
    expect(r).toEqual({
      ok: true,
      value: { package: "Concierge", base_cents: 495000, included_classes: 3, per_class_cents: 82500, second_mark_discount_pct: 20, gov_per_class_cents: 35000 },
    });
    expect(parsePricing(fd({ package: "", base: "1", includedClasses: "1", perClass: "1", secondMarkPct: "1", govPerClass: "1" })).ok).toBe(false);
  });
});

describe("a brand name form", () => {
  const content = sevetri();
  const form = (extra: Record<string, string> = {}) =>
    fd({
      nameId: "p",
      name: "Prosperall",
      what: "Your company name",
      note: "",
      overrideBase: "",
      overridePerClass: "",
      "mark.0.id": "p-word",
      "mark.0.kind": "word",
      "mark.0.desc": "Words only",
      "mark.0.preselected": "on",
      "mark.1.id": "p-logo",
      "mark.1.kind": "logo",
      "mark.1.desc": "The design",
      "class.0.id": "p-c1",
      "class.0.label": "Software",
      "class.0.preselected": "on",
      ...extra,
    });

  it("reads marks and classes; an unticked box is simply absent", () => {
    const r = parseName(form(), content, rand);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.marks.map((m) => [m.id, m.kind, m.preselected])).toEqual([
      ["p-word", "word", true],
      ["p-logo", "logo", false],
    ]);
    expect(r.value.classes).toEqual([{ id: "p-c1", label: "Software", preselected: true }]);
    expect(r.value.price_override).toBeUndefined();
    expect(r.value.note).toBeUndefined();
  });

  it("stores a per-brand price override in cents, only for the fields filled in", () => {
    const r = parseName(form({ overrideBase: "4,500" }), content, rand);
    expect(r.ok && r.value.price_override).toEqual({ base_cents: 450000 });
    const both = parseName(form({ overrideBase: "4500", overridePerClass: "700.50" }), content, rand);
    expect(both.ok && both.value.price_override).toEqual({ base_cents: 450000, per_class_cents: 70050 });
    expect(parseName(form({ overrideBase: "lots" }), content, rand).ok).toBe(false);
  });

  it("will not let a mark take an id another brand name already uses", () => {
    const r = parseName(form({ "mark.1.id": "t-word" }), content, rand);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.marks[1].id).not.toBe("t-word");
  });

  it("refuses an unknown mark kind", () => {
    expect(parseName(form({ "mark.0.kind": "sound" }), content, rand).ok).toBe(false);
  });

  it("replaces only that brand name, and refuses if it was removed meanwhile", () => {
    const r = parseName(form({ name: "Prosperall Inc" }), content, rand);
    if (!r.ok) throw new Error("parse");
    const replaced = replaceName(content, r.value);
    expect(replaced.ok && replaced.value.names.map((x) => x.name)).toEqual(["Prosperall Inc", "Tech4PublicGood"]);
    const gone = removeName(content, "p");
    if (!gone.ok) throw new Error("remove");
    expect(replaceName(gone.value, r.value).ok).toBe(false);
    expect(removeName(gone.value, "p").ok).toBe(false);
  });

  it("prices through the engine after a form round trip (no pricing reimplemented here)", () => {
    const r = parseName(form({ overrideBase: "4500", "mark.1.preselected": "on", "class.1.id": "p-c2", "class.1.label": "Consulting", "class.1.preselected": "on" }), content, rand);
    if (!r.ok) throw new Error("parse");
    const next = replaceName(content, r.value);
    if (!next.ok) throw new Error("replace");
    const q = quoteProposal(next.value, defaultSelection(next.value));
    const p = q.names.find((x) => x.id === "p")!;
    // 2 classes at an override of $4,500 base: 4500 + 825 * (2 - 3) = 3675; second mark 20% off
    expect(p.marks.map((m) => m.price_cents)).toEqual([367500, 294000]);
  });
});

describe("adjustments", () => {
  it("stores an amount as cents and a percent as the number", () => {
    const r = parseAdjustments(
      fd({
        "adj.0.id": "",
        "adj.0.label": "Consultation credit",
        "adj.0.kind": "amount",
        "adj.0.value": "450",
        "adj.1.id": "a-keep",
        "adj.1.label": "Referral",
        "adj.1.kind": "percent",
        "adj.1.value": "5",
      }),
      rand,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0]).toMatchObject({ label: "Consultation credit", kind: "amount", value: 45000 });
    expect(r.value[0].id).toMatch(/^a-/);
    expect(r.value[1]).toEqual({ id: "a-keep", label: "Referral", kind: "percent", value: 5 });
  });
  it("names the bad row", () => {
    const r = parseAdjustments(fd({ "adj.0.label": "x", "adj.0.kind": "amount", "adj.0.value": "ten" }), rand);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Adjustment 1");
  });
});

describe("includes", () => {
  it("drops a blank row, keeps optional fields only when set", () => {
    const r = parseIncludes(
      fd({
        "inc.0.label": "Classes included",
        "inc.0.value": "",
        "inc.0.included": "Your choice",
        "inc.0.highlight": "on",
        "inc.1.label": "",
        "inc.1.included": "",
        "inc.2.label": "Review",
        "inc.2.included": "✓",
        "inc.2.note": "Not the response",
      }),
    );
    expect(r).toEqual({
      ok: true,
      value: [
        { label: "Classes included", included: "Your choice", highlight: true },
        { label: "Review", included: "✓", note: "Not the response" },
      ],
    });
  });
});

describe("a new proposal", () => {
  const standard = standardProposalPricing({});
  it("starts from the firm's standard prices and a brand with marks but no class", () => {
    const c = buildNewContent({ firstName: "Pat", fullName: "Pat Lee", company: "Lee Co", brandName: "Leaf", standard, rand });
    expect(c.pricing).toEqual(standard.pricing);
    expect(c.greeting.startsWith("Hi Pat, thank you")).toBe(true);
    expect(c.names).toHaveLength(1);
    expect(c.names[0].marks.map((m) => m.kind)).toEqual(["word", "logo"]);
    expect(c.names[0].classes).toEqual([]);
    // Not approvable until someone describes what the brand is used for.
    const issues = validateContent(c, { forApproval: true, expires_on: "2026-11-01", pay_url: "https://x.example", client_email: "p@example.com" });
    expect(issues.some((i) => i.level === "error" && i.path === "names")).toBe(true);
  });
  it("copies the standard so one proposal cannot change the settings object", () => {
    const c = buildNewContent({ firstName: "", fullName: "X", standard, rand });
    c.pricing.base_cents = 1;
    c.includes[0].label = "changed";
    expect(standard.pricing.base_cents).not.toBe(1);
    expect(standard.includes[0].label).not.toBe("changed");
    expect(c.names).toEqual([]);
    expect(defaultGreeting("")).toMatch(/^Thank you again/);
  });
  it("ids in a new brand name never collide", () => {
    const b = newBrandName("N", new Set(), rand);
    expect(new Set([b.id, ...b.marks.map((m) => m.id)]).size).toBe(3);
  });
});

describe("settings pricing", () => {
  it("merges over what is stored, so an unknown key survives", () => {
    const r = parseSettingsPricing(
      fd({ package: "Concierge", base: "4950", includedClasses: "3", perClass: "825", secondMarkPct: "20", govPerClass: "350", officeActionNote: "", "inc.0.label": "A", "inc.0.included": "✓" }),
      { legacy: "keep", office_action_note: "old" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.legacy).toBe("keep");
      expect(r.value.base_cents).toBe(495000);
      expect(r.value.includes).toEqual([{ label: "A", included: "✓" }]);
      expect("office_action_note" in r.value).toBe(false);
    }
  });
});
