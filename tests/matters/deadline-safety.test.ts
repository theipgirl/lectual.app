import { describe, expect, it } from "vitest";
import {
  CLOSE_OVERRIDE_ROLES,
  USPTO_DEADLINE_KINDS,
  canOverrideClose,
  closeRefusal,
  guardedDeadlines,
  isCloseGuardRefusal,
  isFiledTrademark,
  isMissingOverrideFunction,
  isRegisteredTrademark,
  MAINTENANCE_DEADLINE_KINDS,
  needsDeadlineCheck,
  noOpenDeadline,
  noOpenDeadlineHint,
  openDeadlineIndex,
  parseOverrideReason,
} from "@/lib/matters/deadline-safety";
import { DEADLINE_KINDS } from "@/lib/matters/deadline-rules";
import { ROLES } from "@/lib/auth/roles";

const openStage = { code: "17", label: "Application Filed", is_open: true, waiting_on: "uspto" as const };
/** Changed on purpose (Nov 23): the flag takes an index (any open deadline, and an open Section 8 / renewal one), not a bare set. */
const idx = (any: string[], maintenance: string[] = []) => ({ any: new Set(any), maintenance: new Set(maintenance) });
const filed = (over: Record<string, unknown> = {}) => ({ id: "m1", status: "open", type: "TM", serial_number: "97123456", filing_date: null, stage: openStage, ...over });

describe("AT1: a filed TM matter with no open deadline is flagged 'No open deadline'", () => {
  it("a filed TM matter (serial number or filing date) is 'filed'", () => {
    expect(isFiledTrademark(filed())).toBe(true);
    expect(isFiledTrademark(filed({ serial_number: null, filing_date: "2026-03-01" }))).toBe(true);
  });

  it("not filed: no serial and no filing date, another type, closed, or a closed docket stage", () => {
    expect(isFiledTrademark(filed({ serial_number: null }))).toBe(false);
    expect(isFiledTrademark(filed({ serial_number: "  " }))).toBe(false);
    expect(isFiledTrademark(filed({ type: "CR" }))).toBe(false);
    expect(isFiledTrademark(filed({ status: "closed" }))).toBe(false);
    expect(isFiledTrademark(filed({ status: "on_hold" }))).toBe(false);
    expect(isFiledTrademark(filed({ stage: { ...openStage, is_open: false } }))).toBe(false);
  });

  it("flagged when no open deadline exists; not flagged when one does", () => {
    expect(noOpenDeadline(filed(), idx([]))).toBe(true);
    expect(noOpenDeadline(filed(), idx(["m1"]))).toBe(false);
  });

  it("a matter whose deadlines are only satisfied / waived is flagged too (only OPEN rows go in the set)", () => {
    const rows = [
      { matter_id: "m1", status: "satisfied" },
      { matter_id: "m1", status: "waived" },
    ];
    const open = openDeadlineIndex(rows.map((r) => ({ ...r, kind: "office_action_response" })));
    expect(noOpenDeadline(filed(), open)).toBe(true);
  });

  it("an unfiled matter is never flagged", () => {
    expect(noOpenDeadline(filed({ serial_number: null }), idx([]))).toBe(false);
  });
});

describe("AT2: a failed deadlines read flags nothing", () => {
  it("null (the read failed) is unknown: no matter is flagged", () => {
    expect(noOpenDeadline(filed(), null)).toBe(false);
  });
});

describe("registered marks (Taylor, Nov 23): no open Section 8 / renewal deadline is flagged too", () => {
  // A registered docket stage: phase maintenance, and (as in RPB's data) is_open false, which isOpenMatter reads as closed.
  const regStage = { code: "24", label: "Trademark Registered", is_open: false, waiting_on: "uspto" as const, phase: "maintenance" };
  const registered = (over: Record<string, unknown> = {}) => filed({ stage: regStage, ...over });
  const rows = (...r: [string, string][]) => openDeadlineIndex(r.map(([matter_id, kind]) => ({ matter_id, kind, status: "open" })));

  it("which kinds count: Section 8 and Section 9 renewal only (Section 15 is optional, and an office action is not maintenance)", () => {
    expect([...MAINTENANCE_DEADLINE_KINDS]).toEqual(["section_8_declaration", "section_9_renewal"]);
    for (const k of MAINTENANCE_DEADLINE_KINDS) expect(DEADLINE_KINDS).toContain(k);
  });

  it("a registered TM matter is defined by the phase, not the stage's is_open or name; it is not 'filed' (isOpenMatter reads it closed)", () => {
    expect(isRegisteredTrademark(registered())).toBe(true);
    expect(isRegisteredTrademark(registered({ stage: { ...regStage, is_open: true } }))).toBe(true);
    expect(isRegisteredTrademark(registered({ stage: { ...regStage, label: "Anything", code: "99" } }))).toBe(true);
    expect(isFiledTrademark(registered())).toBe(false);
    expect(needsDeadlineCheck(registered())).toBe(true);
    for (const over of [{ status: "closed" }, { status: "on_hold" }, { type: "CR" }, { stage: { ...regStage, phase: "post_filing" } }, { stage: { ...regStage, phase: null } }, { stage: null }])
      expect(isRegisteredTrademark(registered(over)), JSON.stringify(over)).toBe(false);
    expect(isRegisteredTrademark(registered({ type: null }))).toBe(true);
  });

  it("registered with no open deadline at all: flagged", () => {
    expect(noOpenDeadline(registered(), rows())).toBe(true);
  });
  it("registered with only an office-action deadline open: flagged", () => {
    expect(noOpenDeadline(registered(), rows(["m1", "office_action_response"]))).toBe(true);
  });
  it("registered with only a Section 15 or 'other' deadline open: flagged", () => {
    expect(noOpenDeadline(registered(), rows(["m1", "section_15_declaration"], ["m1", "other"]))).toBe(true);
  });
  it("registered with an open Section 8, or an open Section 9 renewal: not flagged", () => {
    expect(noOpenDeadline(registered(), rows(["m1", "section_8_declaration"]))).toBe(false);
    expect(noOpenDeadline(registered(), rows(["m1", "office_action_response"], ["m1", "section_9_renewal"]))).toBe(false);
  });
  it("a satisfied Section 8 is not open: still flagged", () => {
    expect(noOpenDeadline(registered(), openDeadlineIndex([{ matter_id: "m1", kind: "section_8_declaration", status: "satisfied" }]))).toBe(true);
  });
  it("another matter's Section 8 doesn't satisfy this one", () => {
    expect(noOpenDeadline(registered(), rows(["m2", "section_8_declaration"]))).toBe(true);
  });
  it("a failed deadlines read (null) flags nothing", () => {
    expect(noOpenDeadline(registered(), null)).toBe(false);
  });
  it("the hint says which rule: registered wording for a registered mark, filed wording otherwise", () => {
    const words = { filed: "F", registered: "R" };
    expect(noOpenDeadlineHint(registered(), words)).toBe("R");
    expect(noOpenDeadlineHint(filed(), words)).toBe("F");
  });
  it("a filed (not registered) matter is unchanged: any open deadline satisfies it", () => {
    expect(noOpenDeadline(filed(), rows(["m1", "office_action_response"]))).toBe(false);
  });
});

describe("the close guard's rule", () => {
  const d = (over: Record<string, unknown> = {}) => ({ id: "d1", kind: "office_action_response", title: null, due_date: "2026-12-01", status: "open", ...over });

  it("on a TM matter every open deadline counts (questions.md R1 default)", () => {
    expect(guardedDeadlines("TM", [d({ kind: "other" }), d({ id: "d2", kind: "hearing" })])).toHaveLength(2);
  });

  it("on another matter only the USPTO trademark kinds count; closed-out deadlines never count", () => {
    expect(guardedDeadlines("CR", [d({ kind: "other" }), d({ id: "d2" }), d({ id: "d3", status: "satisfied" })]).map((x) => x.id)).toEqual(["d2"]);
  });

  it("the USPTO kinds are trademark kinds of the docket enum, never litigation ones", () => {
    for (const k of USPTO_DEADLINE_KINDS) expect(DEADLINE_KINDS).toContain(k);
    for (const k of ["hearing", "trial", "motion_response", "other"]) expect(USPTO_DEADLINE_KINDS).not.toContain(k);
  });

  it("the fixed refusal names the deadline (soonest first) and how many more", () => {
    const text = closeRefusal(guardedDeadlines("TM", [d({ id: "b", due_date: "2027-01-05", title: "Statement of use" }), d({ id: "a", due_date: "2026-12-01" })]));
    expect(text).toContain("Office Action response (due 2026-12-01) and 1 more");
    expect(text).toMatch(/^This matter can't be closed while it has an open deadline/);
  });

  it("recognises 0110's trigger refusal by its prefix and the missing function by its code", () => {
    expect(isCloseGuardRefusal({ message: "matter_close_open_deadline: this matter has an open USPTO deadline" })).toBe(true);
    expect(isCloseGuardRefusal({ message: "something else" })).toBe(false);
    expect(isMissingOverrideFunction({ code: "42883" })).toBe(true);
    expect(isMissingOverrideFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingOverrideFunction({ code: "42501" })).toBe(false);
  });
});

describe("AT5: the override is for the override roles, with a required reason", () => {
  it("owner and attorney only (a role rule, never a name); every other role and an unreadable one are refused", () => {
    expect([...CLOSE_OVERRIDE_ROLES]).toEqual(["owner", "attorney"]);
    for (const role of ROLES) expect(canOverrideClose(role), role).toBe(role === "owner" || role === "attorney");
    expect(canOverrideClose(null)).toBe(false);
    expect(canOverrideClose("Rebecca")).toBe(false);
  });

  it("the reason is required, trimmed, at most 300 characters", () => {
    expect(parseOverrideReason("").ok).toBe(false);
    expect(parseOverrideReason("   ").ok).toBe(false);
    expect(parseOverrideReason(null).ok).toBe(false);
    expect(parseOverrideReason("x".repeat(301)).ok).toBe(false);
    expect(parseOverrideReason("x".repeat(300))).toEqual({ ok: true, reason: "x".repeat(300) });
    expect(parseOverrideReason("  Client abandoned \n the mark  ")).toEqual({ ok: true, reason: "Client abandoned the mark" });
  });
});

describe("review fixes: wording and the type change", () => {
  const d = (over: Record<string, unknown> = {}) => ({ id: "d1", kind: "other", title: null, due_date: "2026-12-01", status: "open", ...over });

  it("the refusal says 'open deadline', never 'USPTO deadline', for an `other` kind", () => {
    const text = closeRefusal(guardedDeadlines("TM", [d()]));
    expect(text).toContain("open deadline: Other");
    expect(text).not.toContain("USPTO");
  });

  it("5b: the stored type and the new one both count: TM in either applies the TM rule", () => {
    expect(guardedDeadlines(["TM", "CR"], [d()])).toHaveLength(1);
    expect(guardedDeadlines(["CR", "TM"], [d()])).toHaveLength(1);
    expect(guardedDeadlines(["CR", "BL"], [d()])).toHaveLength(0);
  });

  it("5b: retyping TM -> CR is refused while a deadline counts only because it is a TM; USPTO kinds keep counting", async () => {
    const { typeChangeUnguards, typeChangeRefusal } = await import("@/lib/matters/deadline-safety");
    expect(typeChangeUnguards("TM", "CR", [d()]).map((x) => x.id)).toEqual(["d1"]);
    expect(typeChangeUnguards("TM", "CR", [d({ kind: "office_action_response" })])).toEqual([]);
    expect(typeChangeUnguards("TM", "TM", [d()])).toEqual([]);
    expect(typeChangeUnguards("CR", "BL", [d()])).toEqual([]);
    expect(typeChangeRefusal([d()])).toMatch(/can't stop being a trademark matter while it has an open deadline: Other/);
  });
});
