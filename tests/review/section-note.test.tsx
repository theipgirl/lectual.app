import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionNote } from "@/components/review/SectionNote";
import type { CustomStateLike } from "@/lib/review/sheet-columns";
import * as W from "@/lib/ui/words";

/** F16 (CO3), CO4 and P5 / R11 on the section note itself. */
const decode = (s: string) => s.replace(/&#x27;/g, "'");
const note = (section: "trademarks" | "contracts", customState: CustomStateLike, adminTier = false) => decode(renderToStaticMarkup(<SectionNote section={section} customState={customState} adminTier={adminTier} />));
const ok = (fields: { label: string; section: "trademarks" | "contracts" | "both" }[]): CustomStateLike => ({ status: "ok", fields });
const ROLES = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk", "viewer", "social_media", null] as const;
const isAdmin = (r: (typeof ROLES)[number]) => r === "owner" || r === "admin" || r === "senior_admin";

describe("F16 / CO3: a firm's live column takes its name off the 'Not tracked' list", () => {
  it("a Trademarks 'priority' drops Priority from Trademarks only", () => {
    const st = ok([{ label: "priority", section: "trademarks" }]);
    expect(note("trademarks", st)).toContain(W.notTrackedNote(["Opinion Letter Due Date", "Completion Date", "Office Action Fee"]));
    expect(note("contracts", st)).toContain(W.notTrackedNote(["Priority", "Completion Date"]));
  });
  it("a Both 'Completion Date' (any spacing or case) drops it from both", () => {
    const st = ok([{ label: " completion  DATE", section: "both" }]);
    expect(note("trademarks", st)).toContain(W.notTrackedNote(["Priority", "Opinion Letter Due Date", "Office Action Fee"]));
    expect(note("contracts", st)).toContain(W.notTrackedNote(["Priority"]));
  });
  it("a Contracts 'Priority' drops it from Contracts only", () => {
    const st = ok([{ label: "Priority", section: "contracts" }]);
    expect(note("trademarks", st)).toContain("Priority");
    expect(note("contracts", st)).toContain(W.notTrackedNote(["Completion Date"]));
  });
  it("all four Trademarks names added: no 'Not tracked' sentence, and no <p> at all for a non-admin", () => {
    const st = ok(["Priority", "Opinion Letter Due Date", "Completion Date", "Office Action Fee"].map((label) => ({ label, section: "trademarks" as const })));
    expect(note("trademarks", st)).toBe("");
    expect(note("trademarks", st, true)).not.toContain("Not tracked");
  });
  it("not switched on, couldn't load or not read: every name stays", () => {
    for (const st of [{ status: "not-set-up" }, { status: "unavailable" }, null] as CustomStateLike[]) expect(note("trademarks", st)).toContain(W.notTrackedNote(["Priority", "Opinion Letter Due Date", "Completion Date", "Office Action Fee"]));
  });
});

describe("P5 / R11 / CO4: the admin tier's line and link", () => {
  for (const role of ROLES) {
    const admin = isAdmin(role);
    it(`${role ?? "null"}: ok ${admin ? "adds the link inside the one <p>" : "has no link"}; not switched on ${admin ? "says so with no link" : "says nothing"}`, () => {
      const okHtml = note("trademarks", ok([]), admin);
      expect((okHtml.match(/<p /g) ?? []).length).toBe(1);
      if (admin) expect(okHtml).toMatch(/^<p class="lx-note rv-sheet-note" data-section-note="trademarks">[^<]*<a href="\/dashboard\/settings\/columns\/">Add a column<\/a><\/p>$/);
      else expect(okHtml).not.toContain("<a ");
      const off = note("trademarks", { status: "not-set-up" }, admin);
      expect(off).not.toContain("<a ");
      expect(off.includes(W.CUSTOM_COLUMNS_NOT_ON)).toBe(admin);
      expect(note("trademarks", { status: "unavailable" }, admin)).not.toContain("<a ");
      expect(note("trademarks", null, admin)).not.toContain("<a ");
    });
  }
  it("the link alone is still drawn inside the one <p>", () => {
    const st = ok(["Priority", "Opinion Letter Due Date", "Completion Date", "Office Action Fee"].map((label) => ({ label, section: "trademarks" as const })));
    expect(note("trademarks", st, true)).toBe('<p class="lx-note rv-sheet-note" data-section-note="trademarks"><a href="/dashboard/settings/columns/">Add a column</a></p>');
  });
  it("nothing to say and no link: no <p>", () => {
    const st = ok(["Priority", "Completion Date"].map((label) => ({ label, section: "contracts" as const })));
    expect(note("contracts", st, false)).toBe("");
    expect(note("contracts", { status: "unavailable" }, true)).toContain("Not tracked");
  });
});
