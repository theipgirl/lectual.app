import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FakeDb } from "../matters/helpers/fake-db";
import { boothRow, daysAgo, formRow, newDb, mockScopedDb } from "./helpers/forms-db";

/**
 * Sprint 9 F15 (Forms list), F16 (event page), D4 (the two agree) and D5
 * (range): the real page and components over one in-memory scoped client.
 */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const NOW = new Date("2026-10-21T12:00:00Z");

const BUSINESS_FULL = { "1": "business", "2": "no", "3": "4_10", "4": "over_1m", "5": "applied", "6": "partial", "7": "none", "8": "right_away" };

/** urban-golf-2026: two finished (2 and 6 minutes), one started and not finished; story2profit-2026: one unfinished. */
function boothTables() {
  const done = (id: string, over: Record<string, unknown>) =>
    boothRow(id, { track: "business", completed_at: daysAgo(NOW, 3, 1), created_at: daysAgo(NOW, 3), answers: BUSINESS_FULL, ...over });
  return [
    done("u1", { score: 40, band: "partial", temperature: "hot", gaps: ["Your name and logo are not federally registered.", "Only part of your revenue is protected by written contracts."], completed_at: daysAgo(NOW, 3, 2) }),
    done("u2", { score: 20, band: "exposed", temperature: "warm", gaps: ["Your name and logo are not federally registered."], completed_at: daysAgo(NOW, 3, 6) }),
    boothRow("u3", { created_at: daysAgo(NOW, 3, 30) }),
    boothRow("s1", { event_code: "story2profit-2026", created_at: daysAgo(NOW, 40) }),
  ];
}

async function listPage(db: FakeDb, role = "owner") {
  vi.resetModules();
  mockScopedDb(db);
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role, org: { id: "org-1", name: "RPB Law" } })) }));
  vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
  vi.doMock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
  vi.doMock("../../src/app/dashboard/forms/actions", () => ({
    createIntakeFormAction: vi.fn(),
    duplicateIntakeFormAction: vi.fn(),
    setIntakeArchivedAction: vi.fn(),
    setIntakeStatusAction: vi.fn(),
  }));
  const mod = await import("../../src/app/dashboard/forms/page");
  return text(renderToStaticMarkup(await mod.default({ searchParams: Promise.resolve({}) })));
}

async function eventPage(db: FakeDb, code: string, range: "all" | 7 | 30 | 90 = "all") {
  vi.resetModules();
  mockScopedDb(db);
  const { EventPage } = await import("../../src/app/dashboard/forms/_components/EventPage");
  return text(renderToStaticMarkup(await EventPage({ code, range, now: NOW })));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Forms list: Event assessments (F15)", () => {
  it("shows one read-only row per event code with started, finished and median, each linking to ?event=<code>", async () => {
    const html = await listPage(newDb({ crm_booth_scorecard: boothTables() }));
    const section = html.slice(html.indexOf('aria-label="Event assessments"'));
    expect(section).toContain(">Event assessments<");
    const rows = section.split("<article").slice(1);
    expect(rows).toHaveLength(2);
    const urban = rows.find((r) => r.includes("urban-golf-2026"))!;
    const story = rows.find((r) => r.includes("story2profit-2026"))!;
    const dd = (row: string, label: string) => row.match(new RegExp(`<dt>${label}</dt><dd>(.*?)</dd>`))?.[1].replace(/<[^>]+>/g, "").trim();
    expect(dd(urban, "Started")).toBe("3");
    expect(dd(urban, "Finished")).toBe("2 66.7%");
    expect(dd(urban, "Median time")).toBe("4 min"); // (2 + 6) / 2 minutes
    expect(dd(story, "Started")).toBe("1");
    expect(dd(story, "Finished")).toBe("0 0.0%");
    expect(dd(story, "Median time")).toBe("—");
    expect(urban).toContain('href="/dashboard/forms?event=urban-golf-2026"');
    expect(story).toContain('href="/dashboard/forms?event=story2profit-2026"');
    // Most recently active first.
    expect(section.indexOf("urban-golf-2026")).toBeLessThan(section.indexOf("story2profit-2026"));
  });

  it("URL-encodes the code in the link", async () => {
    const html = await listPage(newDb({ crm_booth_scorecard: [boothRow("x", { event_code: "ugw 2026&x/y" })] }));
    expect(html).toContain('href="/dashboard/forms?event=ugw%202026%26x%2Fy"');
  });

  it("has no create, edit, archive, duplicate or copy control in the section", async () => {
    const html = await listPage(newDb({ crm_booth_scorecard: boothTables() }));
    const section = html.slice(html.indexOf('aria-label="Event assessments"'));
    for (const word of ["<button", "<form", "<input", "<select", "Archive", "Duplicate", "New intake", "Copy link", ">Edit<", "disabled"]) expect(section).not.toContain(word);
  });

  it("says the event assessments couldn't be loaded when the read fails: not 'none' and not zeros", async () => {
    const db = newDb({ crm_booth_scorecard: boothTables() });
    db.fail("crm_booth_scorecard", "select");
    const html = await listPage(db);
    expect(html).toContain("Event assessments couldn't be loaded. This is a problem reaching the database, not an empty list.");
    expect(html).not.toContain('aria-label="Event assessments"');
    expect(html).not.toContain("urban-golf-2026");
    // The intakes above it are still listed.
    expect(html).toContain("UGW 2026 booth");
  });

  it("says it isn't set up in this environment when the table is missing", async () => {
    const db = newDb({ crm_booth_scorecard: boothTables() });
    db.fail("crm_booth_scorecard", "select", { code: "PGRST205", message: "Could not find the table 'public.crm_booth_scorecard'" });
    const html = await listPage(db);
    expect(html).toContain("Event assessments aren't set up in this environment (lectual migration 0086).");
    expect(html).not.toContain("couldn't be loaded. This is a problem reaching the database, not an empty list.");
  });

  it("shows no section at all for a firm with no booth cards", async () => {
    const html = await listPage(newDb({ crm_booth_scorecard: [] }));
    expect(html).not.toContain("Event assessments");
    expect(html).toContain("UGW 2026 booth");
  });

  it("shows a read-only role the same rows, with no edit controls anywhere", async () => {
    const html = await listPage(newDb({ crm_booth_scorecard: boothTables() }, "viewer"), "viewer");
    expect(html).toContain('aria-label="Event assessments"');
    expect(html).not.toContain("New intake");
    expect(html).not.toContain("Duplicate");
  });

  it("keeps the existing list as before: intakes, create, duplicate, archive, QR, numbers", async () => {
    const html = await listPage(newDb({ crm_booth_scorecard: boothTables() }));
    const list = html.slice(0, html.indexOf('aria-label="Event assessments"'));
    expect(list).toContain("Intake forms");
    expect(list).toContain("UGW 2026 booth");
    expect(list).toContain("New intake");
    expect(list).toContain("Duplicate");
    expect(list).toContain("Archive");
    expect(list).toContain("Copy link");
    expect(list).toContain("Numbers are for the last 30 days.");
  });

  it("does not show another firm's booth cards", async () => {
    const html = await listPage(newDb({ crm_booth_scorecard: [boothRow("z", { org_id: "org-2", event_code: "their-event" })] }));
    expect(html).not.toContain("their-event");
    expect(html).not.toContain("Event assessments");
  });
});

describe("event page (F16)", () => {
  it("renders the performance numbers, the distribution blocks, option counts with card labels, the stored top gaps and the drop-off section", async () => {
    const html = await eventPage(newDb({ crm_booth_scorecard: boothTables() }), "urban-golf-2026");
    expect(html).toContain('<h1 class="lx-h1">urban-golf-2026</h1>');
    const kpi = (label: string) => html.match(new RegExp(`${label}</div><div class="ifm-kpi-value">([^<]*)</div>`))?.[1];
    expect(kpi("Started")).toBe("3");
    expect(kpi("Finished")).toBe("2");
    expect(kpi("Completion rate")).toBe("66.7%");
    expect(kpi("Median time to finish")).toBe("4 min");
    for (const heading of ["Score bands", "Hot, warm and cold", "Score distribution", "Most common gaps", "Drop-off by question"]) expect(html).toContain(`>${heading}<`);
    expect(html).toContain("2 people finished at this event. 1 more gave contact details and didn't finish.");
    // Option counts use the card's labels, with options nobody chose present.
    expect(html).toContain("Is your business name or logo federally registered?");
    expect(html).toContain("Application pending");
    expect(html).toContain("Yes, registered");
    // The gaps stored at capture, most common first.
    const gaps = html.slice(html.indexOf(">Most common gaps<"));
    expect(gaps.indexOf("Your name and logo are not federally registered.")).toBeLessThan(gaps.indexOf("Only part of your revenue"));
    expect(gaps).toContain("· 2 people");
    // Hot and warm from the two finished cards.
    expect(html).toMatch(/<span class="ifr-bar-label">Hot<\/span>.*?<span class="ifr-bar-count">1<\/span>/);
  });

  it("filter links work: All time, 7, 30, 90 days, each keeping event=<code>", async () => {
    const html = await eventPage(newDb({ crm_booth_scorecard: boothTables() }), "urban-golf-2026", 30);
    const nav = html.slice(html.indexOf('aria-label="Date range"'));
    const links = [...nav.matchAll(/<a class="(on)?" (?:aria-current="page" )?href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[3], m[2], m[1]]);
    expect(links.map((l) => l[0])).toEqual(["All time", "7 days", "30 days", "90 days"]);
    expect(links.map((l) => l[1])).toEqual([
      "/dashboard/forms?event=urban-golf-2026&range=all",
      "/dashboard/forms?event=urban-golf-2026&range=7",
      "/dashboard/forms?event=urban-golf-2026&range=30",
      "/dashboard/forms?event=urban-golf-2026&range=90",
    ]);
    expect(links.find((l) => l[0] === "30 days")![2]).toBe("on");
  });

  it("is notFound() for an event code with no cards in this firm, including one only another firm has", async () => {
    const db = newDb({ crm_booth_scorecard: [...boothTables(), boothRow("o", { org_id: "org-2", event_code: "their-event" })] });
    await expect(eventPage(db, "no-such-event")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(eventPage(db, "their-event")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("shows the three-state warning, not an empty page, when the read fails or the table is missing", async () => {
    const failing = newDb({ crm_booth_scorecard: boothTables() });
    failing.fail("crm_booth_scorecard", "select");
    const html = await eventPage(failing, "urban-golf-2026");
    expect(html).toContain("This event's scorecards couldn't be loaded.");
    expect(html).toContain("not an empty result");
    expect(html).not.toContain("ifm-kpi-value");
    const missing = newDb({ crm_booth_scorecard: boothTables() });
    missing.fail("crm_booth_scorecard", "select", { code: "42P01", message: "relation does not exist" });
    expect(await eventPage(missing, "urban-golf-2026")).toContain("aren't set up in this environment (lectual migration 0086)");
  });

  it("renders no setup controls: it is read-only", async () => {
    const html = await eventPage(newDb({ crm_booth_scorecard: boothTables() }), "urban-golf-2026");
    for (const word of ["<button", "<form", "<input", "<select", "<textarea", "Save changes", "Archive", "Duplicate", "disabled"]) expect(html).not.toContain(word);
  });

  it("names only the booth columns it shows, never consent, Lawmatics ids or the lead", async () => {
    const db = newDb({ crm_booth_scorecard: boothTables() });
    await eventPage(db, "urban-golf-2026");
    const cols = db.selects.filter(([t]) => t === "crm_booth_scorecard").map(([, c]) => c);
    expect(cols).toEqual(["id, event_code, track, score, band, temperature, answers, gaps, created_at, completed_at"]);
    expect(db.writes).toEqual([]);
  });
});

describe("drop-off on the event page (F10, deviation 3)", () => {
  it("says answers aren't recorded for unfinished cards, and draws no chart of identical bars", async () => {
    const html = await eventPage(newDb({ crm_booth_scorecard: boothTables() }), "urban-golf-2026");
    const drop = html.slice(html.indexOf(">Drop-off by question<"));
    expect(drop).toContain("1 card was started and not finished. Answers are saved when a card is finished, so where people stopped isn't recorded for these cards.");
    expect(drop).not.toContain("ifr-bars");
    expect(drop).not.toContain("stopped at");
  });

  it("charts where unfinished cards stopped, in card order, when partial answers are recorded", async () => {
    const rows = [
      boothRow("p1", { answers: { "1": "business" } }),
      boothRow("p2", { answers: { "1": "business", "2": "yes", "3": "0_3" } }),
      boothRow("p3", { answers: { "1": "business", "2": "yes", "3": "0_3", "4": "over_1m", "5": "no", "6": "no" } }),
      boothRow("done", { completed_at: "2026-10-17T15:03:00Z", answers: BUSINESS_FULL, score: 50, band: "partial", temperature: "warm" }),
    ];
    const html = await eventPage(newDb({ crm_booth_scorecard: rows }), "urban-golf-2026");
    const drop = html.slice(html.indexOf(">Drop-off by question<"));
    expect(drop).toContain("3 cards were started and not finished. Each is counted at the first question it has no answer for.");
    const bars = [...drop.matchAll(/<span class="ifr-bar-label">([^<]+)<\/span>.*?<span class="ifr-bar-count">(\d+)<\/span>/g)].map((m) => [m[1], Number(m[2])]);
    expect(bars.map((b) => b[1])).toEqual([0, 1, 0, 1, 0, 0, 1, 0]);
    expect(bars[0][0]).toBe("Do you have a business, a personal brand, or both?");
    expect(bars[6][0]).toBe("Is your revenue protected by contracts?");
  });

  it("says everyone finished when no card is unfinished", async () => {
    const html = await eventPage(newDb({ crm_booth_scorecard: [boothRow("a", { completed_at: "2026-10-17T15:03:00Z", answers: BUSINESS_FULL, score: 50, band: "partial", temperature: "warm" })] }), "urban-golf-2026");
    expect(html).toContain("Everyone who gave contact details finished the card in this range.");
  });
});

describe("the list and the event page agree (D4) and the range shrinks the counts (D5)", () => {
  it("shows the same started, finished and median on the list row and on the event page", async () => {
    const db = newDb({ crm_booth_scorecard: boothTables() });
    const list = await listPage(db);
    const row = list.slice(list.indexOf("urban-golf-2026"), list.indexOf("</article>", list.indexOf("urban-golf-2026")));
    const dd = (label: string) => row.match(new RegExp(`<dt>${label}</dt><dd>(.*?)</dd>`))?.[1].replace(/<[^>]+>/g, "").trim();
    const page = await eventPage(db, "urban-golf-2026");
    const kpi = (label: string) => page.match(new RegExp(`${label}</div><div class="ifm-kpi-value">([^<]*)</div>`))?.[1];
    expect(dd("Started")).toBe(kpi("Started"));
    expect(dd("Finished")?.split(" ")[0]).toBe(kpi("Finished"));
    expect(dd("Finished")?.split(" ")[1]).toBe(kpi("Completion rate"));
    expect(dd("Median time")).toBe(kpi("Median time to finish"));
  });

  it("filters one event to 7, 30, 90 days and all time against a fixed clock", async () => {
    const at = (n: number, id: string) => boothRow(id, { created_at: daysAgo(NOW, n), completed_at: daysAgo(NOW, n, 3), answers: BUSINESS_FULL, score: 50, band: "partial", temperature: "warm" });
    const db = newDb({ crm_booth_scorecard: [at(3, "a"), at(20, "b"), at(60, "c"), at(200, "d")] });
    const started: Record<string, string | undefined> = {};
    for (const range of ["all", 7, 30, 90] as const) {
      const html = await eventPage(db, "urban-golf-2026", range);
      started[String(range)] = html.match(/Started<\/div><div class="ifm-kpi-value">([^<]*)</)?.[1];
    }
    expect(started).toEqual({ all: "4", "7": "1", "30": "2", "90": "3" });
  });

  it("keeps an event with nothing in the range as a known event with zeros, not a 404", async () => {
    const db = newDb({ crm_booth_scorecard: [boothRow("old", { created_at: daysAgo(NOW, 200), completed_at: daysAgo(NOW, 200, 3), answers: BUSINESS_FULL, score: 50, band: "partial", temperature: "warm" })] });
    const html = await eventPage(db, "urban-golf-2026", 7);
    expect(html).toMatch(/Started<\/div><div class="ifm-kpi-value">0</);
    expect(html).toContain("Nobody has finished the assessment in this range");
  });

  it("filters the intake submissions the Performance numbers and Results read by the same range, with the clock fixed", async () => {
    const db = newDb({
      crm_intake_form: [formRow()],
      crm_intake_submission: [3, 20, 60, 200].map((n, i) => ({
        id: `s${i}`,
        org_id: "org-1",
        form_id: formRow().id,
        started_at: daysAgo(NOW, n),
        created_at: daysAgo(NOW, n, 1),
        submitted_at: daysAgo(NOW, n, 4),
        contact: { name: `P${i}` },
        answers: [],
        lead_id: null,
        score: null,
        band: null,
        temperature: null,
      })),
    });
    vi.resetModules();
    mockScopedDb(db);
    const perf = await import("../../src/lib/intake-forms/load-performance");
    const results = await import("../../src/lib/intake-forms/load-results");
    const counts = { perf: [] as number[], results: [] as number[] };
    for (const range of [7, 30, 90] as const) {
      const p = await perf.loadSubmissionStatRows(formRow().id as string, range, NOW);
      const r = await results.loadResultSubmissions(formRow().id as string, range, NOW);
      counts.perf.push(p.status === "ok" ? p.value.rows.length : -1);
      counts.results.push(r.status === "ok" ? r.value.rows.length : -1);
    }
    expect(counts).toEqual({ perf: [1, 2, 3], results: [1, 2, 3] });
  });
});
