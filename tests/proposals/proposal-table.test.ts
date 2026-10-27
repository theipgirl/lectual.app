import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  compactAgo,
  dayMonth,
  expiresLabel,
  lastActivityLine,
  monthDay,
  proposalHeadline,
  proposalRef,
  proposalSubline,
  type ActivityEvent,
} from "@/lib/proposals/list-labels";
import { buildProposalRowView, type ListRowInput } from "@/lib/proposals/list-rows";
import { ProposalsTable } from "@/components/proposal-list/ProposalsTable";
import { formatCents } from "@/lib/quotes/money";

const NOW = Date.parse("2026-10-20T16:00:00Z");
const TZ = "America/New_York";
const NO_NAMES: ReadonlyMap<string, string> = new Map();

function input(over: Partial<ListRowInput> = {}): ListRowInput {
  return {
    id: "p1",
    family_id: "ab12cd34-0000-4000-8000-000000000000",
    version: 1,
    client_name: "Irina Vilarino",
    title: "Trademark package",
    status: "sent",
    source: "agent",
    expires_on: "2026-10-28",
    accepted_at: null,
    updated_at: "2026-10-20T13:00:00Z",
    legal_total_cents: 660_000,
    gov_total_cents: 175_000,
    blocking_issue: null,
    brands: ["Oneforme Pilates"],
    offered: [{ name: "Concierge", legalAtSigningCents: 660_000, usptoAtFilingCents: 175_000 }],
    class_count: 5,
    signed_package: null,
    package_basis: null,
    ...over,
  };
}
const ctx = (over: Partial<Parameters<typeof buildProposalRowView>[1]> = {}) => ({ today: "2026-10-20", tz: TZ, now: NOW, events: new Map<string, ActivityEvent>(), names: NO_NAMES, ...over });

describe("title, reference and sub-line", () => {
  it("title — BRAND, the first two brands uppercased and joined with &, none when there are none", () => {
    expect(proposalHeadline("Trademark package", ["Oneforme Pilates"])).toBe("Trademark package — ONEFORME PILATES");
    expect(proposalHeadline("Portfolio renewal", ["Orin", "Hale", "Third"])).toBe("Portfolio renewal — ORIN & HALE");
    expect(proposalHeadline("Trademark Proposal", [])).toBe("Trademark Proposal");
    expect(proposalHeadline("T", ["  ", ""])).toBe("T");
  });

  it("the ref is pr- and six characters of the family id, with the version once there is a second", () => {
    expect(proposalRef("ab12cd34-0000-4000-8000-000000000000", 1)).toBe("pr-ab12cd");
    expect(proposalRef("ab12cd34-0000-4000-8000-000000000000", 3)).toBe("pr-ab12cd · v3");
  });

  it("sub-line: packages offered and classes; singular forms", () => {
    const base = { ref: "pr-ab12cd", key: "sent" as const, offeredCount: 1, signedPackage: null, classCount: 5, editedFrom: null };
    expect(proposalSubline(base)).toBe("pr-ab12cd · 1 package offered · 5 classes");
    expect(proposalSubline({ ...base, offeredCount: 2, classCount: 1 })).toBe("pr-ab12cd · 2 packages offered · 1 class");
    expect(proposalSubline({ ...base, offeredCount: 0 })).toBe("pr-ab12cd · no package offered · 5 classes");
  });

  it("sub-line once accepted names the package signed", () => {
    expect(proposalSubline({ ref: "pr-ab12cd", key: "accepted", offeredCount: 1, signedPackage: "Enhanced", classCount: 2, editedFrom: null })).toBe(
      "pr-ab12cd · ENHANCED signed · 2 classes",
    );
  });

  it("sub-line says 'edited from <PACKAGE>' only when a field was changed", () => {
    const base = { ref: "pr-ab12cd", key: "draft" as const, offeredCount: 1, signedPackage: null, classCount: 1, editedFrom: "Concierge" };
    expect(proposalSubline(base)).toBe("pr-ab12cd · 1 package offered · 1 class · edited from CONCIERGE");
    expect(proposalSubline({ ...base, editedFrom: null })).not.toContain("edited from");
  });
});

describe("expiresLabel", () => {
  const e = (key: Parameters<typeof expiresLabel>[0]["key"], expiresOn: string | null, acceptedAt: string | null = null) => expiresLabel({ key, expiresOn, acceptedAt, tz: TZ });
  it("a date for Sent and for a Draft or Blocked row that has one", () => {
    expect(e("sent", "2026-08-28")).toBe("Aug 28");
    expect(e("draft", "2026-09-30")).toBe("Sep 30");
    expect(e("blocked", "2026-09-30")).toBe("Sep 30");
  });
  it("Signed 9 Sep once accepted", () => {
    expect(e("accepted", "2026-11-30", "2026-09-09T15:00:00Z")).toBe("Signed 9 Sep");
    expect(e("accepted", null, null)).toBe("—");
  });
  it("Expired Sep 4 for a derived expiry", () => {
    expect(e("expired", "2026-09-04")).toBe("Expired Sep 4");
  });
  it("Not sent for a Draft with no date; — for the rest with none", () => {
    expect(e("draft", null)).toBe("Not sent");
    expect(e("sent", null)).toBe("—");
    expect(e("blocked", null)).toBe("—");
    expect(e("closed", null)).toBe("—");
  });
  it("dates do not slip by a day in any zone", () => {
    expect(monthDay("2026-09-04")).toBe("Sep 4");
    expect(dayMonth("2026-09-10T02:00:00Z", "America/New_York")).toBe("9 Sep");
    expect(dayMonth("2026-09-10T02:00:00Z", "Asia/Tokyo")).toBe("10 Sep");
    expect(dayMonth(null, TZ)).toBe("");
  });
});

describe("lastActivityLine", () => {
  const line = (over: Partial<Parameters<typeof lastActivityLine>[0]> = {}) =>
    lastActivityLine({
      key: "draft",
      source: "manual",
      updatedAt: "2026-10-20T13:00:00Z",
      acceptedAt: null,
      offeredCount: 1,
      blockingIssue: null,
      event: null,
      names: new Map([["u1", "Taylor"]]),
      now: NOW,
      ...over,
    });
  const ev = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({ type: "edited", actor: "staff", actor_user_id: "u1", created_at: "2026-10-20T13:00:00Z", ...over });

  it("the agent's draft reads as drafted by the intake agent from the consult", () => {
    expect(line({ source: "agent", event: ev({ actor: "agent", actor_user_id: null }) })).toBe("Drafted by the intake agent from the consult");
    expect(line({ source: "agent", event: null })).toBe("Drafted by the intake agent from the consult");
    expect(line({ source: "agent", event: ev({ type: "created", actor: "staff" }) })).toBe("Drafted by the intake agent from the consult");
  });

  it("a staff edit reads 'Edited 3h ago · Taylor'", () => {
    expect(line({ event: ev() })).toBe("Edited 3h ago · Taylor");
  });

  it("an edit after the agent's draft is the staff edit, not the agent line", () => {
    expect(line({ source: "agent", event: ev() })).toBe("Edited 3h ago · Taylor");
  });

  it("drops the name when it isn't known, never shows an id", () => {
    expect(line({ event: ev({ actor_user_id: "u-unknown" }) })).toBe("Edited 3h ago");
    expect(line({ event: ev({ actor_user_id: null }) })).toBe("Edited 3h ago");
    expect(line({ event: ev({ actor_user_id: "u-unknown" }) })).not.toContain("u-unknown");
  });

  it("other events use their own verb", () => {
    expect(line({ event: ev({ type: "sent", created_at: "2026-10-18T13:00:00Z" }) })).toBe("Link turned on 2d ago · Taylor");
    expect(line({ event: ev({ type: "approved" }) })).toBe("Saved 3h ago · Taylor");
  });

  it("a derived expiry says the stored status still says sent", () => {
    expect(line({ key: "expired", event: ev({ type: "sent" }) })).toBe("Stored status still says sent");
  });

  it("blocked: no package offered yet, else the first thing blocking approval", () => {
    expect(line({ key: "blocked", offeredCount: 0, blockingIssue: "Name the package." })).toBe("No package offered yet");
    expect(line({ key: "blocked", offeredCount: 1, blockingIssue: "Add the pay link before creating the link." })).toBe("Add the pay link before creating the link.");
  });

  it("accepted: 'Accepted by the client · <when>'", () => {
    expect(line({ key: "accepted", acceptedAt: "2026-10-18T16:00:00Z" })).toBe("Accepted by the client · 2d ago");
  });

  it("when the events read failed, every cell falls back to a derived line from updated_at", () => {
    expect(line({ event: "unavailable" })).toBe("Updated 3h ago");
    expect(line({ source: "agent", event: "unavailable" })).toBe("Updated 3h ago");
    expect(line({ key: "sent", event: "unavailable" })).toBe("Updated 3h ago");
  });

  it("a row with no event reads from updated_at", () => {
    expect(line({ event: null })).toBe("Updated 3h ago");
  });

  it("compactAgo", () => {
    expect(compactAgo("2026-10-20T15:59:40Z", NOW)).toBe("just now");
    expect(compactAgo("2026-10-20T15:54:00Z", NOW)).toBe("6m ago");
    expect(compactAgo("2026-10-20T13:00:00Z", NOW)).toBe("3h ago");
    expect(compactAgo("2026-10-18T16:00:00Z", NOW)).toBe("2d ago");
    expect(compactAgo("2026-08-01T16:00:00Z", NOW)).toMatch(/^Aug 1$/);
    expect(compactAgo(null, NOW)).toBe("");
  });
});

describe("one table row per status (the design's cells)", () => {
  const sent = buildProposalRowView(input(), ctx());
  const accepted = buildProposalRowView(
    input({
      id: "p2",
      family_id: "cd34ef56-0000-4000-8000-000000000000",
      status: "accepted",
      source: "manual",
      client_name: "Maison Petra",
      brands: ["Petra"],
      accepted_at: "2026-09-09T15:00:00Z",
      signed_package: "Enhanced",
      class_count: 2,
      legal_total_cents: 490_800,
      gov_total_cents: 70_000,
    }),
    ctx(),
  );
  const expired = buildProposalRowView(
    input({ id: "p3", family_id: "ef56ab78-0000-4000-8000-000000000000", client_name: "Orin & Hale", title: "Portfolio renewal", brands: ["Orin", "Hale"], expires_on: "2026-09-04", class_count: 3, legal_total_cents: 495_000, gov_total_cents: 105_000, source: "manual" }),
    ctx(),
  );
  const draft = buildProposalRowView(
    input({ id: "p4", family_id: "01ab23cd-0000-4000-8000-000000000000", status: "draft", client_name: "Vela Athletics", brands: ["Vela"], expires_on: null, class_count: 1, source: "manual", legal_total_cents: 195_000, gov_total_cents: 35_000 }),
    ctx({ events: new Map([["p4", { type: "edited", actor: "staff", actor_user_id: "u1", created_at: "2026-10-20T13:00:00Z" }]]), names: new Map([["u1", "Taylor"]]) }),
  );
  const blocked = buildProposalRowView(
    input({ id: "p5", family_id: "23cd45ef-0000-4000-8000-000000000000", status: "draft", client_name: "Birchwood Coffee Co.", brands: ["Birchwood"], expires_on: "2026-09-30", offered: [], class_count: 2, blocking_issue: "Name the package.", source: "manual", legal_total_cents: 325_000, gov_total_cents: 70_000 }),
    ctx(),
  );
  const closed = buildProposalRowView(input({ id: "p6", status: "withdrawn", source: "manual", brands: [] }), ctx());

  it("Sent", () => {
    expect(sent).toMatchObject({
      key: "sent",
      headline: "Trademark package — ONEFORME PILATES",
      subline: "pr-ab12cd · 1 package offered · 5 classes",
      client: "Irina Vilarino",
      statusLabel: "Link live",
      statusTone: "ok",
      expires: "Oct 28",
      activity: "Drafted by the intake agent from the consult",
      atSigningCents: 660_000,
      atFilingCents: 175_000,
    });
  });
  it("Accepted", () => {
    expect(accepted).toMatchObject({ key: "accepted", statusLabel: "Accepted by client", statusTone: "ok", subline: "pr-cd34ef · ENHANCED signed · 2 classes", expires: "Signed 9 Sep", activity: expect.stringMatching(/^Accepted by the client · /) });
  });
  it("Expired", () => {
    expect(expired).toMatchObject({ key: "expired", statusLabel: "Expired", statusTone: "warn", headline: "Portfolio renewal — ORIN & HALE", expires: "Expired Sep 4", activity: "Stored status still says sent" });
  });
  it("Draft", () => {
    expect(draft).toMatchObject({ key: "draft", statusLabel: "Draft", statusTone: "mute", expires: "Not sent", activity: "Edited 3h ago · Taylor", subline: "pr-01ab23 · 1 package offered · 1 class" });
  });
  it("Blocked", () => {
    expect(blocked).toMatchObject({ key: "blocked", statusLabel: "Blocked", statusTone: "risk", expires: "Sep 30", activity: "No package offered yet", subline: "pr-23cd45 · no package offered · 2 classes", statusSub: "Name the package." });
  });
  it("Closed", () => {
    expect(closed).toMatchObject({ key: "closed", statusLabel: "Closed", statusTone: "mute", headline: "Trademark package" });
  });

  it("a failed events read leaves every cell with a derived line", () => {
    const rows = [input(), input({ id: "p4", status: "draft", source: "manual" }), input({ id: "p7", status: "sent", source: "manual" })].map((i) => buildProposalRowView(i, ctx({ events: "unavailable" })));
    for (const r of rows) expect(r.activity).toBe("Updated 3h ago");
  });
});

describe("the table", () => {
  const rows = [
    buildProposalRowView(input(), ctx()),
    buildProposalRowView(input({ id: "p5", status: "draft", blocking_issue: "Name the package.", offered: [], source: "manual", legal_total_cents: 325_000, gov_total_cents: 70_000 }), ctx()),
    buildProposalRowView(input({ id: "p2", status: "accepted", accepted_at: "2026-09-09T15:00:00Z", signed_package: "Enhanced", source: "manual", legal_total_cents: 490_800, gov_total_cents: 70_000 }), ctx()),
  ];
  const html = renderToStaticMarkup(createElement(ProposalsTable, { rows, footerLeft: "All 3 proposals", footerRight: "Government filing fees are $350 per class, paid before the application goes in." }));

  it("has the nine columns, in order", () => {
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(["Proposal", "Client", "Status", "Accepted", "Paid", "At signing", "At filing", "Expires", "Last activity"]);
  });

  it("shows the legal fee and the USPTO fees as two separate cells, and never a sum or a 'total'", () => {
    const first = html.slice(html.indexOf("<tr", html.indexOf("<tbody")), html.indexOf("</tr>", html.indexOf("<tbody")));
    const money = [...first.matchAll(/<td class="pq-money[^"]*">([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(money).toEqual([formatCents(660_000), formatCents(175_000)]);
    expect(html.toLowerCase()).not.toContain("total");
    expect(html).not.toContain(formatCents(660_000 + 175_000));
    expect(html).not.toContain(formatCents(325_000 + 70_000));
    expect(html).not.toContain(formatCents(490_800 + 70_000));
  });

  it("links the title to the proposal, and shows the footer", () => {
    expect(html).toMatch(/href="\/dashboard\/proposals\/p1\/?"/);
    expect(html).toContain("All 3 proposals");
    expect(html).toContain("Government filing fees are $350 per class, paid before the application goes in.");
  });
});
