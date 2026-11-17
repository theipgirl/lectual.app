import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES } from "@/lib/auth/roles";
import { canSeeEventPeople, takenAtText } from "@/lib/intake-forms/event-people";
import { canExportCsv } from "@/lib/intake-forms/export-csv";
import type { FakeDb } from "../matters/helpers/fake-db";
import { boothRow, newDb, mockScopedDb } from "./helpers/forms-db";

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#x2F;", "/");
const NOW = new Date("2026-11-16T14:00:00Z");

const lead = (id: string, first: string, last: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: "org-1",
  first_name: first,
  last_name: last,
  business_name: `${last} Studio`,
  email: `${first.toLowerCase()}@example.test`,
  phone: "555-0100",
  ...over,
});

function tables() {
  return {
    crm_booth_scorecard: [
      boothRow("c1", { lead_id: "l1", score: 40, band: "partial", temperature: "hot", gaps: ["Gap A.", "Gap B."], created_at: "2026-11-15T19:42:00Z", completed_at: "2026-11-15T19:46:00Z" }),
      boothRow("c2", { lead_id: "l2", score: 75, band: "protected", temperature: "cold", created_at: "2026-11-15T18:00:00Z", completed_at: "2026-11-15T18:05:00Z" }),
      boothRow("c3", { lead_id: "l3", created_at: "2026-11-14T10:00:00Z" }),
      boothRow("c4", { lead_id: "gone", score: 20, band: "exposed", temperature: "warm", created_at: "2026-10-01T10:00:00Z", completed_at: "2026-10-01T10:04:00Z" }),
      boothRow("o1", { org_id: "org-2", lead_id: "l9", event_code: "urban-golf-2026", created_at: "2026-11-15T20:00:00Z" }),
    ],
    crm_lead: [lead("l1", "Ada", "Quill", { first_name: "=Ada" }), lead("l2", "Bo", "Marsh"), lead("l3", "Cy", "Reed", { business_name: null })],
  };
}

async function eventPage(db: FakeDb, role: unknown, range: "all" | 7 = "all") {
  vi.resetModules();
  mockScopedDb(db);
  const { EventPage } = await import("../../src/app/dashboard/forms/_components/EventPage");
  return text(renderToStaticMarkup(await EventPage({ code: "urban-golf-2026", range, role, now: NOW })));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("roles", () => {
  it("canSeeEventPeople: every role but viewer and social_media; unknown is no", () => {
    for (const r of ROLES) expect(canSeeEventPeople(r), r).toBe(r !== "viewer" && r !== "social_media");
    for (const bad of [undefined, null, "", "root", 3]) expect(canSeeEventPeople(bad)).toBe(false);
  });
  it("shows every role that can see people the Download CSV button only if it may export", () => {
    for (const r of ROLES) if (canExportCsv(r)) expect(canSeeEventPeople(r), r).toBe(true);
  });
});

describe("the People section", () => {
  it("lists one card per scorecard of this firm, newest first, with name, business, zoned time, score, temperature and a lead link", async () => {
    const html = await eventPage(newDb(tables()), "owner");
    const section = html.slice(html.indexOf('aria-label="People who took this assessment"'));
    expect(section.match(/<li class="ifm-card ev-person"/g)).toHaveLength(4);
    expect(section.indexOf("=Ada")).toBeLessThan(section.indexOf("Bo Marsh"));
    expect(section).toContain("Quill Studio");
    expect(section).toContain("Nov 15, 2026, 2:42 PM EST");
    expect(section).toContain("40 · Partly protected");
    expect(section).toContain("Temperature (staff only)");
    expect(section).toContain('ev-temp-hot">Hot<');
    expect(section).toContain("Finished");
    expect(section).toContain("Didn’t finish");
    expect(section).toContain('href="/dashboard/leads/l1"');
    expect(section).toContain("4 people.");
    expect(section).not.toContain("l9");
  });

  it("a missing lead is 'Lead not available' with no link", async () => {
    const html = await eventPage(newDb(tables()), "owner");
    const card = html.split('<li class="ifm-card ev-person"').find((c) => c.includes("20 · Exposed"))!;
    expect(card).toContain("Lead not available");
    expect(card).not.toContain("/dashboard/leads/");
  });

  it("a failed scorecard read or lead read says People couldn't be loaded, never nobody", async () => {
    for (const table of ["crm_lead"]) {
      const bad = newDb(tables());
      bad.fail(table, "select");
      const out = await eventPage(bad, "owner");
      expect(out).toContain("People couldn't be loaded. Refresh to try again.");
      expect(out).not.toContain("No one in this range");
      expect(out).not.toContain("ev-person");
    }
  });

  it("respects the range and says when it is empty", async () => {
    const html = await eventPage(newDb(tables()), "owner", 7);
    expect(html.match(/<li class="ifm-card ev-person"/g)).toHaveLength(3);
    expect(html).toContain("3 people.");
    expect(html).not.toContain("Lead not available");
  });

  it("viewer, social_media and unknown roles see no People and no lead is read", async () => {
    for (const role of ["viewer", "social_media", undefined, "mystery"]) {
      const db = newDb(tables());
      const html = await eventPage(db, role);
      expect(html).not.toContain("People who took this assessment");
      expect(html).not.toContain("Download CSV");
      expect(db.selects.some(([t]) => t === "crm_lead")).toBe(false);
      expect(html).toContain("Performance");
    }
  });

  it("offers Download CSV only to roles that may export", async () => {
    expect(await eventPage(newDb(tables()), "owner")).toContain('href="/dashboard/forms/event-export/?event=urban-golf-2026"');
    const html = await eventPage(newDb(tables(), "viewer"), "viewer");
    expect(html).not.toContain("event-export");
  });

  it("reads only the display columns, never email or phone, and writes nothing", async () => {
    const db = newDb(tables());
    await eventPage(db, "owner");
    expect(db.selects.filter(([t]) => t === "crm_lead").map(([, c]) => c)).toEqual(["id, first_name, last_name, business_name"]);
    expect(db.writes).toEqual([]);
  });

  it("caps the cards at 200 with Showing N of M", async () => {
    const many = Array.from({ length: 230 }, (_, i) =>
      boothRow(`m${i}`, { lead_id: "l2", created_at: new Date(Date.parse("2026-11-15T00:00:00Z") + i * 60000).toISOString() }),
    );
    const html = await eventPage(newDb({ crm_booth_scorecard: many, crm_lead: tables().crm_lead }), "owner");
    expect(html.match(/<li class="ifm-card ev-person"/g)).toHaveLength(200);
    expect(html).toContain("Showing 200 of 230.");
  });
});

describe("takenAtText", () => {
  it("names the zone and falls back to UTC for an unknown one", () => {
    expect(takenAtText("2026-11-15T19:42:00Z", "America/New_York")).toBe("Nov 15, 2026, 2:42 PM EST");
    expect(takenAtText("2026-11-15T19:42:00Z", "Not/AZone")).toContain("UTC");
    expect(takenAtText("nonsense", "UTC")).toBe("");
  });
});

describe("peopleCountLine", () => {
  it("says how many are shown, and 'more than' when the read was capped", async () => {
    const { peopleCountLine } = await import("../../src/lib/intake-forms/event-people");
    expect(peopleCountLine(6, 6, false)).toBe("6 people.");
    expect(peopleCountLine(1, 1, false)).toBe("1 person.");
    expect(peopleCountLine(200, 230, false)).toBe("Showing 200 of 230.");
    expect(peopleCountLine(200, 5000, true)).toBe("Showing 200 of more than 5,000.");
  });
});

describe("director fixes (Nov 17)", () => {
  it("the h1 reads the name, a space, then the code (no glued text for screen readers or copy)", async () => {
    const html = await eventPage(newDb(tables()), "owner");
    const h1 = html.match(/<h1 class="lx-h1">([\s\S]*?)<\/h1>/)![1].replace(/<[^>]+>/g, "");
    expect(h1).toBe("Urban Golf 2026 urban-golf-2026");
  });

  it("a missing scorecard table says its own not-switched-on sentence, not 'couldn't be loaded', and no People", async () => {
    const db = newDb(tables());
    db.fail("crm_booth_scorecard", "select", { code: "PGRST205", message: "x" });
    const out = await eventPage(db, "owner");
    expect(out).toContain("switched on for your firm yet");
    expect(out).not.toContain("couldn't be loaded");
    expect(out).not.toContain("ev-person");
  });

  it("canSeeEventPeople holds the same roles as MATTER_WRITE_ROLES (and canExportCsv)", async () => {
    const { canSeeEventPeople } = await import("../../src/lib/intake-forms/event-people");
    const { MATTER_WRITE_ROLES } = await import("../../src/lib/matters/matters");
    const { canExportCsv } = await import("../../src/lib/intake-forms/export-csv");
    expect(ROLES.filter((r) => canSeeEventPeople(r)).sort()).toEqual([...MATTER_WRITE_ROLES].sort());
    for (const r of ROLES) expect(canSeeEventPeople(r), r).toBe(canExportCsv(r));
  });
});

describe("isEventCode", () => {
  it("takes the three real codes and refuses anything not shaped like one", async () => {
    const { isEventCode } = await import("../../src/lib/intake-forms/event-name");
    for (const c of ["legal-assessment", "story2profit-2026", "urban-golf-2026", "a_b"]) expect(isEventCode(c), c).toBe(true);
    for (const c of ["", "x".repeat(121), 'a"b', "a\r\nb", "a b", "a/b", "é", undefined, ["a"]]) expect(isEventCode(c), String(c)).toBe(false);
  });
});
