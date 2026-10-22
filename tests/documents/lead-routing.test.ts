import { describe, expect, it } from "vitest";
import { LEAD_MATTERS_FAILED, LETTER_DESTINATION, LETTER_NEEDS_MATTER, letterKind, matterTemplateHref, routeLead } from "@/lib/documents/new-picker";

/** D3: what choosing a lead does, for 0, 1 and many open matters, and for a failed read. */

const m = (id: string) => ({ id, label: `Mark ${id}`, detail: `TM-${id}` });
const base = { leadId: "lead-1", leadLabel: "Amara Okafor" };

describe("routeLead", () => {
  it("none: says to open a matter first and links to the lead", () => {
    expect(routeLead({ ...base, matters: { status: "ok", open: [] } })).toEqual({
      kind: "none",
      message: "Letters are drafted on a matter. Open a matter for Amara Okafor first.",
      leadHref: "/dashboard/leads/lead-1/",
    });
    expect(LETTER_NEEDS_MATTER("X")).toBe("Letters are drafted on a matter. Open a matter for X first.");
  });

  it("one: goes straight to that matter's template page", () => {
    expect(routeLead({ ...base, matters: { status: "ok", open: [m("m1")] } })).toEqual({ kind: "redirect", href: "/dashboard/documents/new/m1/" });
  });

  it("several: a short list, each linking to its template page", () => {
    const r = routeLead({ ...base, matters: { status: "ok", open: [m("m1"), m("m2")] } });
    expect(r).toMatchObject({ kind: "choose" });
    if (r.kind !== "choose") throw new Error("unreachable");
    expect(r.matters.map((x) => x.href)).toEqual(["/dashboard/documents/new/m1/", "/dashboard/documents/new/m2/"]);
  });

  it("a failed read is its own state, never the 'none' message", () => {
    const r = routeLead({ ...base, matters: { status: "failed" } });
    expect(r).toEqual({ kind: "failed", message: LEAD_MATTERS_FAILED });
    expect(JSON.stringify(r)).not.toContain("Open a matter");
  });
});

describe("the destination", () => {
  it("a matter goes to its template choice, a lead to ?lead= (with the person's own search), and there is no blank form", () => {
    expect(LETTER_DESTINATION.chooseHref("matter", "m 1", "mark")).toBe("/dashboard/documents/new/m%201/");
    expect(matterTemplateHref("abc")).toBe("/dashboard/documents/new/abc/");
    expect(LETTER_DESTINATION.chooseHref("lead", "l1", "")).toBe("/dashboard/documents/new/?lead=l1");
    expect(LETTER_DESTINATION.chooseHref("lead", "l1", "amara")).toBe("/dashboard/documents/new/?lead=l1&q=amara");
    expect(LETTER_DESTINATION.blankHref).toBeNull();
  });

  it("opens on Matters unless Leads was chosen", () => {
    expect(letterKind(undefined)).toBe("matter");
    expect(letterKind("lead")).toBe("lead");
    expect(letterKind("bogus")).toBe("matter");
  });
});
