import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PERF_FORM, PERF_LIST, renderPerformance } from "./helpers/perf-harness";
import { ASSESSMENT_FORM_ID, BUSINESS_ANSWERS, FORM_ID, assessmentAnswers, assessmentFormRow, formRow, intakeConfig } from "./helpers/forms-db";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import { DEFAULT_ASSESSMENT } from "@/lib/intake-forms/assessment";

/**
 * Sprint 9 F12, F17, D2, D5 and V4: the Results tab, the person drawer it
 * shares with Performance, and the Performance tab after the drawer moved.
 */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

// ── Performance: unchanged apart from the two new cards (F17, V4) ─────────────

const NEW_CARD = /<div class="ifm-card ifm-kpi"><div class="ifm-field-label">(?:Page to contact details|Contact details to finish)<\/div><div class="ifm-kpi-value">[^<]*<\/div><div class="ifm-help">[^<]*<\/div><\/div>/g;

describe("Performance tab after the drawer moved (F17, V4)", () => {
  it("renders exactly the markup it rendered before, once the two new cards are taken out", async () => {
    expect(await renderPerformance()).not.toBe(fixture("performance-tab.html")); // the two new cards are really there
    expect((await renderPerformance()).replace(NEW_CARD, "")).toBe(fixture("performance-tab.html"));
  });

  it("renders the open drawer exactly as before (no lead link, same controls)", async () => {
    const html = (await renderPerformance({ intakeId: PERF_LIST[0].id })).replace(NEW_CARD, "");
    expect(html).toBe(fixture("performance-tab-drawer.html"));
    expect(html).toContain("SANKOFA");
    expect(html).not.toContain("Open the lead");
  });

  it("renders an assessment form's Performance tab exactly as before, including the temperature card", async () => {
    const html = (await renderPerformance({ kind: "assessment" })).replace(NEW_CARD, "");
    expect(html).toBe(fixture("performance-tab-assessment.html"));
    expect(html).toContain("Hot · warm · cold");
  });

  it("adds 'Page to contact details' and 'Contact details to finish' with their medians, after the existing four cards", async () => {
    const html = text(await renderPerformance());
    for (const label of ["Gave contact details", "Finished", "Didn't finish", "Median time to finish", "Page to contact details", "Contact details to finish"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html.indexOf(">Median time to finish<")).toBeLessThan(html.indexOf(">Page to contact details<"));
    expect(html.indexOf(">Page to contact details<")).toBeLessThan(html.indexOf(">Contact details to finish<"));
    // Rows: 1 min and 2 min to give details (median 1.5 min); the one who finished took 3 min more.
    expect(html).toMatch(/Page to contact details<\/div><div class="ifm-kpi-value">2 min</);
    expect(html).toMatch(/Contact details to finish<\/div><div class="ifm-kpi-value">3 min</);
  });

  it("shows a dash for each when there is nothing to take a median of", async () => {
    const html = await renderPerformance({ statRows: [] });
    expect(html).toMatch(/Page to contact details<\/div><div class="ifm-kpi-value">—</);
    expect(html).toMatch(/Contact details to finish<\/div><div class="ifm-kpi-value">—</);
    const noCreated = await renderPerformance({ statRows: [{ started_at: "2026-10-18T15:00:00Z", submitted_at: "2026-10-18T15:04:00Z" }] });
    expect(noCreated).toMatch(/Page to contact details<\/div><div class="ifm-kpi-value">—</);
    expect(noCreated).toMatch(/Median time to finish<\/div><div class="ifm-kpi-value">4 min</);
  });

  it("still shows the failure warning, not dashes, when the numbers couldn't be read", async () => {
    vi.resetModules();
    vi.doMock("@/lib/intake-forms/load-performance", async (orig) => ({
      ...(await orig<typeof import("@/lib/intake-forms/load-performance")>()),
      loadFunnel: vi.fn(async () => ({ status: "unavailable" })),
      loadIntakeList: vi.fn(async () => ({ status: "ok", value: [] })),
      loadIntakeSubmission: vi.fn(),
      loadSubmissionStatRows: vi.fn(async () => ({ status: "unavailable" })),
    }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "UTC") }));
    const { IntakePerformance } = await import("../../src/app/dashboard/forms/_components/IntakePerformance");
    const html = text(renderToStaticMarkup(await IntakePerformance({ form: PERF_FORM, range: 30, intakeId: null, canChangeStatus: true })));
    expect(html).toContain("Completion numbers couldn't be loaded.");
    expect(html).not.toContain("Page to contact details");
  });
});

// ── Results tab ───────────────────────────────────────────────────────────────

const t = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();

const intakeForm: IntakeFormRecord = { ...PERF_FORM, id: FORM_ID, config: intakeConfig() };
const assessmentForm: IntakeFormRecord = {
  ...PERF_FORM,
  id: ASSESSMENT_FORM_ID,
  slug: "booth-assessment",
  kind: "assessment",
  config: { ...defaultIntakeConfig(), assessment: { ...DEFAULT_ASSESSMENT } },
};

function people() {
  return [
    {
      id: "22222222-2222-4222-8222-222222222222",
      contact: { name: "Mireille Toussaint", email: "m@example.com" },
      answers: [
        { id: "q-name", question: "What name do you want to protect?", answer: "SANKOFA" },
        { id: "q-use", question: "Have you used it publicly?", answer: "Yes" },
      ],
      started_at: t(0),
      submitted_at: t(4),
      lead_id: "lead-mt",
      score: null,
      band: null,
      temperature: null,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      contact: { name: "Dana Cole", email: "d@example.com" },
      answers: [{ id: "q-name", question: "What name do you want to protect?", answer: "ACME" }],
      started_at: t(10),
      submitted_at: t(13),
      lead_id: null,
      score: null,
      band: null,
      temperature: null,
    },
    { id: "44444444-4444-4444-8444-444444444441", contact: { name: "Walked Away", email: "w@example.com" }, answers: [], started_at: t(20), submitted_at: null, lead_id: "lead-w", score: null, band: null, temperature: null },
  ];
}

type Read = { status: "ok"; value: { rows: unknown[]; capped: boolean } } | { status: "unconfigured" } | { status: "unavailable" };

async function renderResults(opts: { form?: IntakeFormRecord; read?: Read; intakeId?: string | null; range?: 7 | 30 | 90; canExport?: boolean } = {}) {
  vi.resetModules();
  const read: Read = opts.read ?? { status: "ok", value: { rows: people(), capped: false } };
  vi.doMock("@/lib/intake-forms/load-results", async (orig) => ({
    ...(await orig<typeof import("@/lib/intake-forms/load-results")>()),
    loadResultSubmissions: vi.fn(async () => read),
  }));
  vi.doMock("@/lib/intake-forms/load-performance", async (orig) => ({
    ...(await orig<typeof import("@/lib/intake-forms/load-performance")>()),
    loadIntakeSubmission: vi.fn(async (id: string) => {
      const row = people().find((p) => p.id === id);
      return { status: "ok", value: row ? { ...row, mode: "form", fit: "unscored", status: "new", screening_note: null, last_active_at: row.started_at } : null };
    }),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "UTC") }));
  const { IntakeResults } = await import("../../src/app/dashboard/forms/_components/IntakeResults");
  return text(
    renderToStaticMarkup(
      await IntakeResults({ form: opts.form ?? intakeForm, range: opts.range ?? 30, intakeId: opts.intakeId ?? null, canChangeStatus: true, canExport: opts.canExport ?? true }),
    ),
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Results tab, intake form (F12)", () => {
  it("lists answers per question: who, when and the answer, newest first, with a link to the lead", async () => {
    const html = await renderResults();
    expect(html).toContain("<h2 class=\"ifm-title\" style=\"flex:1\">Results</h2>");
    const first = html.slice(html.indexOf('aria-label="What name do you want to protect?"'));
    expect(first.indexOf("Dana Cole")).toBeLessThan(first.indexOf("Mireille Toussaint"));
    expect(first).toContain("ACME");
    expect(first).toContain("SANKOFA");
    expect(first).toContain("Oct 18, 3:13 PM");
    expect(html).toMatch(/href="\/dashboard\/leads\/lead-mt\/?"/);
    expect(html).toContain("2 answers");
    expect(html).toContain("1 answer");
    expect(html).toContain("2 people sent answers in the last 30 days. 1 more gave contact details and didn't finish.");
    // The person who walked away has no answers to list.
    expect(html).not.toContain("Walked Away");
  });

  it("opens the existing drawer from a row, through a link carrying tab=results and the person's id", async () => {
    const html = await renderResults();
    expect(html).toMatch(/href="\/dashboard\/forms\?form=11111111-1111-4111-8111-111111111111&tab=results&range=30&intake=22222222-2222-4222-8222-222222222222"/);
    expect(html).not.toContain("ifm-drawer-wrap");
  });

  it("D2: with that intake open it shows the drawer with the person's answers, a lead link, and a close link back to the Results URL with its range", async () => {
    const html = await renderResults({ intakeId: "22222222-2222-4222-8222-222222222222", range: 90 });
    const drawer = html.slice(html.indexOf("ifm-drawer-wrap"));
    expect(drawer).toContain("Mireille Toussaint");
    expect(drawer).toContain("SANKOFA");
    expect(drawer).toContain("What name do you want to protect?");
    expect(drawer).toMatch(/<a href="\/dashboard\/leads\/lead-mt\/?">Open the lead<\/a>/);
    expect(drawer).toMatch(/class="ifm-drawer-scrim" aria-label="Close" href="\/dashboard\/forms\?form=11111111-1111-4111-8111-111111111111&tab=results&range=90"/);
    expect(drawer).not.toContain("tab=performance");
  });

  it("offers no lead link in the drawer for a person with no lead", async () => {
    const html = await renderResults({ intakeId: "33333333-3333-4333-8333-333333333333" });
    expect(html).toContain("ifm-drawer-wrap");
    expect(html).not.toContain("Open the lead");
  });

  it("the range links change range and keep tab=results", async () => {
    const html = await renderResults({ range: 7 });
    const links = [...html.matchAll(/<a class="(on)?" (?:aria-current="page" )?href="([^"]+)">(\d+) days<\/a>/g)].map((m) => [m[3], m[2], m[1]]);
    expect(links.map((l) => l[0])).toEqual(["7", "30", "90"]);
    for (const [days, href] of links) expect(href).toBe(`/dashboard/forms?form=${FORM_ID}&tab=results&range=${days}`);
    expect(links.find((l) => l[0] === "7")![2]).toBe("on");
  });

  it("links Export CSV to the export route with the form and range, for staff only", async () => {
    const html = await renderResults({ range: 90 });
    expect(html).toMatch(/<a class="lx-btn lx-btn-sec" href="\/dashboard\/forms\/export\/?\?form=11111111-1111-4111-8111-111111111111&range=90" download="">Export CSV<\/a>/);
    const viewer = await renderResults({ canExport: false });
    expect(viewer).not.toContain("Export CSV");
    expect(viewer).toContain("CSV export is for staff roles.");
  });

  it("shows a question the form no longer asks, and a form question with no answers, under their own headings", async () => {
    const rows = [{ ...people()[0], answers: [{ id: "q-removed", question: "Since removed", answer: "legacy" }] }];
    const html = await renderResults({ read: { status: "ok", value: { rows, capped: false } } });
    expect(html).toContain("Since removed");
    expect(html).toContain("1 answer · no longer asked");
    expect(html).toContain("No answers to this question in this range.");
  });

  it("says 'Showing the latest 50 of N' for a question with more answers", async () => {
    const rows = Array.from({ length: 53 }, (_, i) => ({ ...people()[0], id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, started_at: t(i), submitted_at: t(i + 1), answers: [{ id: "q-name", question: "q", answer: `answer ${i}` }] }));
    const html = await renderResults({ read: { status: "ok", value: { rows, capped: false } } });
    expect(html).toContain("Showing the latest 50 of 53.");
    expect(html.match(/answer \d+/g)!.length).toBeGreaterThanOrEqual(50);
  });

  it("when the read failed, says so, and draws neither an empty list nor zero", async () => {
    const html = await renderResults({ read: { status: "unavailable" } });
    expect(html).toContain("Results couldn't be loaded. This is a problem reaching the database, not an empty result.");
    expect(html).not.toContain("No answers to this question");
    expect(html).not.toContain("people sent answers");
    expect(html).not.toContain("0 answers");
    const missing = await renderResults({ read: { status: "unconfigured" } });
    expect(missing).toContain("Results aren't set up in this environment");
  });

  it("says the latest 5,000 are covered when the read was capped", async () => {
    const html = await renderResults({ read: { status: "ok", value: { rows: people(), capped: true } } });
    expect(html).toContain("Results cover the latest 5,000 people in this range.");
  });
});

describe("Results tab, assessment form (F12, D3)", () => {
  const variants = [
    { ...BUSINESS_ANSWERS, "1": "business" },
    { ...BUSINESS_ANSWERS, "1": "brand", "2": "yes" },
    { ...BUSINESS_ANSWERS, "1": "both", "5": "registered", "6": "documented", "7": "all", "8": "3_plus_months", "4": "under_150k", "2": "yes" },
    { ...BUSINESS_ANSWERS, "4": "under_150k", "8": "3_plus_months" },
    { ...BUSINESS_ANSWERS, "5": "unsure" },
  ];
  const scored = variants.map((v) => assessmentAnswers(v));
  const rows = scored.map((a, i) => ({
    id: `55555555-5555-4555-8555-55555555555${i}`,
    contact: { name: `P${i}`, email: `p${i}@example.com` },
    answers: a.answerList,
    started_at: t(i),
    submitted_at: t(i + 2),
    lead_id: null,
    score: a.score.score,
    band: a.score.band,
    temperature: a.score.temperature,
  }));
  const walked = { ...rows[0], id: "66666666-6666-4666-8666-666666666666", submitted_at: null, answers: [], score: null, band: null, temperature: null };

  it("renders the distribution blocks, with unfinished people in a line and not in the charts", async () => {
    const html = await renderResults({ form: assessmentForm, read: { status: "ok", value: { rows: [...rows, walked], capped: false } } });
    for (const heading of ["Score bands", "Hot, warm and cold", "Score distribution", "Most common gaps"]) expect(html).toContain(`>${heading}<`);
    expect(html).toContain("5 people finished in the last 30 days. 1 more gave contact details and didn't finish. They are not in the charts below.");
    expect(html).toContain("Staff only. The person never sees this.");
    // Per-question option counts, including options nobody chose.
    expect(html).toContain("Is your business name or logo federally registered?");
    expect(html).toContain("Application pending");
    expect(html).toContain("Not sure");
    const exposed = scored.filter((a) => a.score.band === "exposed").length;
    expect(html).toMatch(new RegExp(`<span class="ifr-bar-label">Exposed</span><span class="ifr-bar" aria-hidden="true"><i style="width:\\d+%"></i></span><span class="ifr-bar-count">${exposed}</span>`));
    // The per-question list is for intakes, not assessments.
    expect(html).not.toContain("sent answers in the last");
  });

  it("D3: the exact distribution, temperature split, option counts and top gaps for five people", async () => {
    const html = await renderResults({ form: assessmentForm, read: { status: "ok", value: { rows, capped: false } } });
    const count = (label: string) => Number(html.match(new RegExp(`<span class="ifr-bar-label">${label}</span>.*?<span class="ifr-bar-count">(\\d+)</span>`))?.[1]);
    const temps = { Hot: 0, Warm: 0, Cold: 0 };
    for (const a of scored) temps[({ hot: "Hot", warm: "Warm", cold: "Cold" } as const)[a.score.temperature]]++;
    expect(count("Hot")).toBe(temps.Hot);
    expect(count("Warm")).toBe(temps.Warm);
    expect(count("Cold")).toBe(temps.Cold);
    // The most common gap is the one most people were shown.
    const tally = new Map<string, number>();
    for (const a of scored) for (const g of a.score.gaps) tally.set(g, (tally.get(g) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const gapsBlock = html.slice(html.indexOf(">Most common gaps<"));
    expect(gapsBlock.indexOf(top[0])).toBeGreaterThan(-1);
    expect(gapsBlock).toContain(`· ${top[1]} ${top[1] === 1 ? "person" : "people"}`);
    expect(gapsBlock).toContain("Counted over 5 people.");
  });

  it("says when nobody has finished, instead of drawing empty charts", async () => {
    const html = await renderResults({ form: assessmentForm, read: { status: "ok", value: { rows: [walked], capped: false } } });
    expect(html).toContain("Nobody has finished the assessment in this range, so there are no scores to chart.");
    expect(html).toContain("1 person gave contact details and didn&#x27;t finish.".replace("&#x27;", "'"));
    expect(html).not.toContain(">Score bands<");
  });

  it("says 'Gaps unavailable' for people whose answers can't be matched, without inventing gaps", async () => {
    const odd = { ...rows[0], id: "77777777-7777-4777-8777-777777777777", answers: [{ id: "1", question: "q", answer: "A business" }, { id: "2", question: "q", answer: "Dunno" }] };
    const html = await renderResults({ form: assessmentForm, read: { status: "ok", value: { rows: [odd], capped: false } } });
    expect(html).toContain("Gaps unavailable for 1");
    expect(html).toContain("No gaps could be read for this range.");
  });

  it("shows the failure warning, not zero charts, when the read failed", async () => {
    const html = await renderResults({ form: assessmentForm, read: { status: "unavailable" } });
    expect(html).toContain("Results couldn't be loaded.");
    expect(html).not.toContain(">Score bands<");
  });
});

// ── the page: slots and tab links ─────────────────────────────────────────────

describe("forms page, tabs and slots (F12)", () => {
  async function page(searchParams: Record<string, string>) {
    vi.resetModules();
    const { createFakeDb } = await import("../matters/helpers/fake-db");
    const db = createFakeDb({ role: "attorney", tables: { crm_intake_form: [formRow(), assessmentFormRow()], crm_intake_submission: [], crm_booth_scorecard: [] } });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => db.client()) }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney", org: { id: "org-1", name: "RPB Law" } })) }));
    vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
    vi.doMock("@/lib/intake-forms/store", async (orig) => ({ ...(await orig<typeof import("@/lib/intake-forms/store")>()), loadIntakePackages: vi.fn(async () => ({ status: "ok", items: [] })) }));
    const mod = await import("../../src/app/dashboard/forms/page");
    return (await mod.default({ searchParams: Promise.resolve(searchParams) })) as { props: Record<string, unknown> };
  }

  it("hands the Results tab in as a slot only on tab=results, and keeps Setup and Performance slot-based", async () => {
    const results = await page({ form: FORM_ID, tab: "results", range: "7" });
    expect(results.props.tab).toBe("results");
    expect(results.props.range).toBe(7);
    expect(results.props.results).not.toBeNull();
    expect(results.props.performance).toBeNull();
    const perf = await page({ form: FORM_ID, tab: "performance" });
    expect(perf.props.tab).toBe("performance");
    expect(perf.props.performance).not.toBeNull();
    expect(perf.props.results).toBeNull();
    const setup = await page({ form: FORM_ID });
    expect(setup.props.tab).toBe("setup");
    expect(setup.props.performance).toBeNull();
    expect(setup.props.results).toBeNull();
    expect((await page({ form: FORM_ID, tab: "nonsense" })).props.tab).toBe("setup");
  });
});

describe("workspace tabs", () => {
  it("shows Results as one more tab link beside Setup and Performance, keeping the range", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
    vi.doMock("../../src/app/dashboard/forms/actions", () => ({ saveIntakeFormAction: vi.fn() }));
    const { IntakeFormsWorkspace } = await import("../../src/app/dashboard/forms/_components/IntakeFormsWorkspace");
    const html = text(
      renderToStaticMarkup(
        <IntakeFormsWorkspace
          form={intakeForm}
          orgName="RPB Law"
          packages={{ status: "ok", items: [] }}
          origin="https://app.example.test"
          canEdit
          tab="results"
          range={90}
          performance={null}
          results={<div id="results-slot">results here</div>}
        />,
      ),
    );
    const nav = html.slice(html.indexOf('<nav class="ifm-tabs"'), html.indexOf("</nav>", html.indexOf('<nav class="ifm-tabs"')));
    expect([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(["Form setup", "Performance", "Results"]);
    expect(nav).toMatch(/href="\/dashboard\/forms\?form=11111111-1111-4111-8111-111111111111&tab=results&range=90"/);
    expect(nav).toMatch(/aria-current="page" href="[^"]*tab=results/);
    expect(html).toContain('<div id="results-slot">results here</div>');
  });
});
