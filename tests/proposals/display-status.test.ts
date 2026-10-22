import { describe, it, expect } from "vitest";
import { proposalDisplayStatus, parseDisplayFilter, proposalDisplayTone } from "@/lib/proposals/display-status";
import { validateContent } from "@/lib/proposals/validate";
import { sevetri } from "./fixture";
import type { ProposalStatus } from "@/lib/proposals/types";

const TODAY = "2026-10-20";
const row = (status: ProposalStatus, expires_on: string | null = null) => ({ status, expires_on });
const show = (status: ProposalStatus, expires_on: string | null = null, issues: string[] | null = null) =>
  proposalDisplayStatus(row(status, expires_on), { today: TODAY, issues });

describe("proposalDisplayStatus", () => {
  it("a sent proposal is Expired the day after its expiry, Sent on the day, Sent with no expiry", () => {
    expect(show("sent", "2026-10-19")).toMatchObject({ key: "expired", label: "Expired" });
    expect(show("sent", "2026-10-20")).toMatchObject({ key: "sent", label: "Link live" });
    expect(show("sent", "2026-10-30").key).toBe("sent");
    expect(show("sent", null).key).toBe("sent");
  });

  it("a draft with a blocking issue is Blocked, and the sub-label is the first issue's message", () => {
    const issues = validateContent(sevetri(), { forApproval: true, title: "T", expires_on: null, pay_url: null, client_email: null }).filter((i) => i.level === "error");
    expect(issues.length).toBeGreaterThan(0);
    const s = show("draft", null, issues.map((i) => i.message));
    expect(s).toMatchObject({ key: "blocked", label: "Blocked", sub: issues[0].message });
  });

  it("a draft with no issue is Draft; approved is Draft with its sub-label", () => {
    expect(show("draft", "2026-10-30")).toEqual({ key: "draft", label: "Draft", sub: null });
    expect(show("approved", "2026-10-30")).toEqual({ key: "draft", label: "Draft", sub: "saved, link not live" });
  });

  it("an approved proposal with a blocking issue is Blocked", () => {
    expect(show("approved", null, ["Set an expiry date before creating the link."])).toMatchObject({ key: "blocked", sub: "Set an expiry date before creating the link." });
  });

  it("accepted is Accepted; withdrawn and superseded are Closed", () => {
    expect(show("accepted")).toMatchObject({ key: "accepted", label: "Accepted by client" });
    expect(show("withdrawn")).toMatchObject({ key: "closed", label: "Closed" });
    expect(show("superseded")).toMatchObject({ key: "closed", label: "Closed" });
  });

  it("never returns Expired for a row that is not sent, whatever its date", () => {
    for (const status of ["draft", "approved", "accepted", "withdrawn", "superseded"] as const) {
      expect(show(status, "2020-01-01").key).not.toBe("expired");
    }
  });

  it("ignores issues on a row that cannot be approved any more", () => {
    expect(show("sent", "2026-10-30", ["x"]).key).toBe("sent");
    expect(show("accepted", null, ["x"]).key).toBe("accepted");
  });

  it("uses the pill tones the firm expects", () => {
    expect(proposalDisplayTone("blocked")).toBe("risk");
    expect(proposalDisplayTone("expired")).toBe("warn");
    expect(proposalDisplayTone("sent")).toBe("ok");
    expect(proposalDisplayTone("accepted")).toBe("ok");
    expect(proposalDisplayTone("draft")).toBe("mute");
    expect(proposalDisplayTone("closed")).toBe("mute");
  });
});

describe("parseDisplayFilter", () => {
  it("takes display keys, maps stored values from older links, and ignores the rest", () => {
    expect(parseDisplayFilter("expired")).toBe("expired");
    expect(parseDisplayFilter("approved")).toBe("draft");
    expect(parseDisplayFilter("withdrawn")).toBe("closed");
    expect(parseDisplayFilter("superseded")).toBe("closed");
    expect(parseDisplayFilter("nonsense")).toBeUndefined();
    expect(parseDisplayFilter(undefined)).toBeUndefined();
  });
});
