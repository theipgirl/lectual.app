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
  noOpenDeadline,
  parseOverrideReason,
} from "@/lib/matters/deadline-safety";
import { DEADLINE_KINDS } from "@/lib/matters/deadline-rules";
import { ROLES } from "@/lib/auth/roles";

const openStage = { code: "17", label: "Application Filed", is_open: true, waiting_on: "uspto" as const };
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
    expect(noOpenDeadline(filed(), new Set())).toBe(true);
    expect(noOpenDeadline(filed(), new Set(["m1"]))).toBe(false);
  });

  it("a matter whose deadlines are only satisfied / waived is flagged too (only OPEN rows go in the set)", () => {
    const rows = [
      { matter_id: "m1", status: "satisfied" },
      { matter_id: "m1", status: "waived" },
    ];
    const open = new Set(rows.filter((r) => r.status === "open").map((r) => r.matter_id));
    expect(noOpenDeadline(filed(), open)).toBe(true);
  });

  it("an unfiled matter is never flagged", () => {
    expect(noOpenDeadline(filed({ serial_number: null }), new Set())).toBe(false);
  });
});

describe("AT2: a failed deadlines read flags nothing", () => {
  it("null (the read failed) is unknown: no matter is flagged", () => {
    expect(noOpenDeadline(filed(), null)).toBe(false);
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
    expect(text).toMatch(/^This matter can't be closed while it has an open USPTO deadline/);
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
