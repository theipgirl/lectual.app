import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));
import { renderToStaticMarkup } from "react-dom/server";
import { groupBySource } from "@/lib/intake-forms/where-from";
import { WhereTheyCameFrom } from "../../src/app/dashboard/forms/_components/WhereTheyCameFrom";
import { IntakeLinksForChannels } from "../../src/app/dashboard/forms/_components/IntakeLinksForChannels";
import { channelLinks, parseUtmParams } from "@/lib/intake-forms/utm";
import { leadFromSubmission } from "@/lib/intake-forms/public-submit";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import { intakeTags } from "@/lib/intake-forms/lawmatics-sync";


const c = (utm?: Record<string, string>) => ({ contact: { name: "A", email: "a@example.com", ...(utm ? { utm } : {}) } });

describe("groupBySource", () => {
  const rows = [
    c({ source: "ig", campaign: "UGW-2026" }),
    c({ source: "ig", campaign: "UGW-2026" }),
    c({ source: "ig" }),
    c({ source: "li", campaign: "UGW-2026" }),
    c({ source: "newsletter" }),
    c(),
    c(),
    { contact: "garbage" },
  ];
  const w = groupBySource(rows);

  it("counts by source and campaign, biggest first, and the totals add up to the rows", () => {
    expect(w.groups.map((g) => [g.source, g.count])).toEqual([
      ["ig", 3],
      ["li", 1],
      ["newsletter", 1],
    ]);
    expect(w.groups[0].campaigns).toEqual([
      { campaign: "UGW-2026", count: 2 },
      { campaign: null, count: 1 },
    ]);
    expect(w.direct).toBe(3);
    expect(w.groups.reduce((n, g) => n + g.count, 0) + w.direct).toBe(w.total);
    expect(w.total).toBe(rows.length);
  });

  it("labels known codes and leaves unknown ones as typed", () => {
    expect(w.groups.map((g) => g.label)).toEqual(["Instagram bio", "LinkedIn", "newsletter"]);
  });

  it("files a person with only a campaign under (no source), and drops forged values to Direct", () => {
    const g = groupBySource([c({ campaign: "UGW-2026" }), c({ source: "<script>" })]);
    expect(g.groups.map((x) => x.label)).toEqual(["(no source)"]);
    expect(g.direct).toBe(1);
  });
});

describe("Where they came from (three states)", () => {
  const ok = (rows: { contact: unknown }[], capped = false) => renderToStaticMarkup(<WhereTheyCameFrom state={{ status: "ok", rows, capped }} />);

  it("shows the table with campaigns under each source and Direct (no tag)", () => {
    const html = ok([c({ source: "ig", campaign: "UGW-2026" }), c()]);
    expect(html).toContain("Where they came from");
    expect(html).toContain("Instagram bio");
    expect(html).toContain("UGW-2026");
    expect(html).toContain("Direct (no tag)");
    expect(html).toContain("2 people in this range.");
  });

  it("with people but none tagged shows only Direct (no tag)", () => {
    const html = ok([c(), c(), c()]);
    expect(html).toContain("Direct (no tag)");
    expect(html).toContain("<td>3</td>");
    expect(html).not.toContain("Instagram");
    expect(html).toContain("3 people in this range.");
  });

  it("escapes an unknown source as text", () => {
    const html = ok([{ contact: { utm: { source: "<b>x</b>" } } }]);
    expect(html).not.toContain("<b>x</b>"); // a value with angle brackets is dropped whole by parseUtm
    expect(html).toContain("Direct (no tag)");
  });

  it("says when the rows were capped", () => {
    expect(ok([c()], true)).toContain("latest 5,000 people");
  });

  it("never draws a table or a zero for an unreadable or unconfigured read", () => {
    const bad = renderToStaticMarkup(<WhereTheyCameFrom state={{ status: "unavailable" }} />);
    expect(bad).toContain("Can&#x27;t show where people came from right now. Refresh to try again.");
    expect(bad).not.toContain("<table");
    expect(bad).not.toContain("Direct");
    const off = renderToStaticMarkup(<WhereTheyCameFrom state={{ status: "unconfigured" }} />);
    expect(off).toContain("Forms isn&#x27;t switched on for your firm yet. Lectual will turn it on.");
    expect(off).not.toContain("<table");
  });
});

describe("Links for each channel", () => {
  const render = (shareable: boolean) =>
    renderToStaticMarkup(<IntakeLinksForChannels slug="ugw-2026" name="UGW 2026" sourceTag="UGW 2026" origin="https://app.example.test" shareable={shareable} />);

  it("draws seven rows with Copy and a QR button for a live form", () => {
    const html = render(true);
    expect(html.match(/<li>/g)).toHaveLength(7);
    expect(html.match(/>Copy</g)).toHaveLength(7);
    expect(html.match(/QR code/g)).toHaveLength(7);
    for (const label of ["Instagram bio", "LinkedIn", "Facebook", "TikTok", "Website", "Email signature", "Event QR"]) expect(html).toContain(label);
  });

  it("draws no URLs for a draft or archived form", () => {
    const html = render(false);
    expect(html).toContain("Not live yet. Publish the form to share it.");
    expect(html).not.toContain("utm_source");
    expect(html).not.toContain("<li>");
  });
});

describe("a visitor on the generated Instagram link, end to end through the pure parts", () => {
  it("becomes a tagged lead, a stored utm and a Results row under Instagram bio", () => {
    const ig = channelLinks("ugw-2026", "UGW 2026", "https://app.example.test")[0];
    const utm = parseUtmParams(Object.fromEntries(new URL(ig.url).searchParams)); // what the page reads
    const lead = leadFromSubmission({ mode: "form", contact: { name: "Ana Rivera", email: "ana@example.com", phone: "", company: "" }, answers: [] }, defaultIntakeConfig(), "instagram.com", "UGW 2026", utm);
    expect(lead.referral_detail).toBe("UGW 2026 · ig / social / link_in_bio / UGW-2026 · Form on instagram.com");
    expect(intakeTags("UGW 2026", null, utm)).toEqual(["UGW 2026", "UTM: ig", "Campaign: UGW-2026"]);
    const stored = { contact: { name: "Ana Rivera", email: "ana@example.com", utm } };
    const g = groupBySource([stored, c()]);
    expect(g.groups[0].label).toBe("Instagram bio");
    expect(g.groups[0].campaigns).toEqual([{ campaign: "UGW-2026", count: 1 }]);
    expect(g.direct).toBe(1);
  });
});
