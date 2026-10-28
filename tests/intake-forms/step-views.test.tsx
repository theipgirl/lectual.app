import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadActions, person, QUESTIONS, intakeConfigRow } from "./helpers/step-harness";
import { FORM_A, type Row } from "./helpers/step-db";
import { parseIntakeConfig, defaultIntakeConfig, type IntakeFormConfig } from "@/lib/intake-forms/config";
import { DEFAULT_ASSESSMENT, publicAssessment, scoreAssessmentAnswers } from "@/lib/intake-forms/assessment";
import { askedQuestions } from "@/lib/intake-forms/assessment-asked";
import { assessmentResults } from "@/lib/intake-forms/results";
import { assessmentQuestions } from "@/lib/intake-forms/assessment";
import { sampleFromSubmission } from "@/lib/intake-forms/assessment-samples";
import { submissionItem } from "@/lib/answers/items";
import { AnswersCard } from "@/components/answers/AnswersCard";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";

/**
 * Sprint 10 F25, F26 and D2 to D6. The writes go through the real public
 * actions against an in-memory service-role store, and the staff pages read
 * the same store through the real loaders, so what the write side records and
 * what the read side shows have to agree on indices and question ids.
 */

const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);
const setNow = (sec: number) => vi.setSystemTime(new Date(T0 + sec * 1000));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const SLUG = "ugw-2026";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow(-3600);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function formRecord(config: IntakeFormConfig, kind: "intake" | "assessment" = "intake"): IntakeFormRecord {
  return {
    id: FORM_A,
    name: "UGW 2026",
    slug: SLUG,
    sourceTag: "UGW 2026",
    kind,
    status: "live",
    config,
    allowedDomains: [],
    receivesReferrals: false,
    agreementSignedAt: null,
    publishedAt: null,
    everSaved: true,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

/** A person row the staff pages can read: contact, status and the columns every loader names. */
function human(n: number, startedSec: number, over: Row = {}): { token: string; row: Row } {
  const p = person({
    id: uuid(n),
    contact: { name: `Person ${n}`, email: `p${n}@example.com` },
    mode: "form",
    fit: "unscored",
    status: "new",
    lead_id: null,
    score: null,
    band: null,
    temperature: null,
    started_at: new Date(T0 + startedSec * 1000).toISOString(),
    created_at: new Date(T0 + (startedSec + 5) * 1000).toISOString(),
    last_active_at: new Date(T0 + (startedSec + 5) * 1000).toISOString(),
    ...over,
  });
  return p;
}

async function boot(opts: { people: Row[]; config?: IntakeFormConfig; kind?: "intake" | "assessment"; tables?: Record<string, Row[]> }) {
  const config = opts.config ?? intakeConfigRow();
  const h = await loadActions({ people: opts.people, config, kind: opts.kind, scoped: true, tables: opts.tables });
  const { IntakeResults } = await import("../../src/app/dashboard/forms/_components/IntakeResults");
  const { IntakePerformance } = await import("../../src/app/dashboard/forms/_components/IntakePerformance");
  const form = formRecord(parseIntakeConfig(config), opts.kind ?? "intake");
  return {
    ...h,
    form,
    async results(o: { range?: 7 | 30 | 90; intakeId?: string | null } = {}) {
      return text(renderToStaticMarkup(await IntakeResults({ form, range: o.range ?? 30, intakeId: o.intakeId ?? null, canChangeStatus: true, canExport: true })));
    },
    async performance(o: { range?: 7 | 30 | 90; intakeId?: string | null } = {}) {
      return text(renderToStaticMarkup(await IntakePerformance({ form, range: o.range ?? 30, intakeId: o.intakeId ?? null, canChangeStatus: true })));
    },
  };
}

/** The cells of each body row of the table inside the section with this label. */
function tableRows(html: string, label: string): string[][] {
  const start = html.indexOf(`aria-label="${label}"`);
  if (start < 0) return [];
  const end = html.indexOf("</section>", start);
  const section = html.slice(start, end);
  return [...section.matchAll(/<tr>(.*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, "")))
    .filter((cells) => cells.length && !/^Question$/.test(cells[0]));
}

/** The "Stopped at" cell for each person in the All intakes table, by name. */
function stoppedCells(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<tr[^>]*><td class="pri"><a [^>]*>([^<]*)<\/a>.*?<td class="ifm-stopped[^"]*">([^<]*)<\/td><\/tr>/g)) out[m[1]] = m[2];
  return out;
}

const FIRST_Q = QUESTIONS[0].text;

/** Four people through the three-question form, driven through the real step and completion actions. */
async function story() {
  const A = human(1, -60);
  const B = human(2, -55);
  const C = human(3, 1);
  const D = human(4, -40);
  const w = await boot({ people: [A.row, B.row, C.row, D.row] });
  const step = async (sec: number, p: { token: string }, index: number, questionId: string, progress: Record<string, unknown> = {}) => {
    setNow(sec);
    await w.actions.recordIntakeStepAction(SLUG, { token: p.token, stepIndex: index, questionId, progress });
  };
  await step(0, A, 0, "q-name");
  await step(10, A, 1, "q-pick", { "q-name": "SANKOFA" });
  await step(25, A, 2, "q-many", { "q-name": "SANKOFA", "q-pick": "Yes" });
  setNow(40);
  const done = await w.actions.submitIntakeAction(SLUG, { token: A.token, mode: "form", answers: { "q-name": "SANKOFA", "q-pick": "Yes", "q-many": ["Logo"] } });
  expect(done).toMatchObject({ ok: true });
  await step(0, B, 0, "q-name");
  await step(30, B, 1, "q-pick", { "q-name": "ACME" });
  await step(5, D, 0, "q-name");
  setNow(3600);
  return { w, A, B, C, D };
}

describe("write side and read side agree (D3)", () => {
  it("the real step action and completion produce events and progress that the aggregation reads back", async () => {
    const { w, A, B } = await story();
    const events = w.db.rows("crm_intake_event").filter((e) => e.kind === "step");
    expect(events.map((e) => [e.submission_id, e.question_id, e.step_index])).toEqual([
      [A.row.id, "q-name", 0],
      [A.row.id, "q-pick", 1],
      [A.row.id, "q-many", 2],
      [B.row.id, "q-name", 0],
      [B.row.id, "q-pick", 1],
      [w.db.rows("crm_intake_submission")[3].id, "q-name", 0],
    ]);
    expect(w.db.rows("crm_intake_submission").find((r) => r.id === B.row.id)?.progress).toEqual({ "q-name": "ACME" });

    const html = await w.results();
    expect(tableRows(html, "Drop-off by question")).toEqual([
      [`Q1. ${FIRST_Q}`, "3", "2", "2", "1 · 33.3%"],
      ["Q2. Have you used it publicly?", "2", "1", "1", "1 · 50.0%"],
      ["Q3. Which of these do you have?", "1", "1", "1", "0 · 0.0%"],
    ]);
  });

  it("the Performance tab reads the same people: medians per step and each person's reading", async () => {
    const { w } = await story();
    const html = await w.performance();
    expect(tableRows(html, "Typical time per step (median)")).toEqual([
      [`Q1. ${FIRST_Q}`, "20 sec", "3"],
      ["Q2. Have you used it publicly?", "15 sec", "2"],
      ["Q3. Which of these do you have?", "15 sec", "1"],
    ]);
    expect(stoppedCells(html)).toEqual({ "Person 1": "—", "Person 2": "Stopped at Q2", "Person 3": "Stopped before Q1", "Person 4": "Stopped at Q1" });
  });
});

describe("the surfaces agree (D4)", () => {
  it("gives the same reached, answered and drop-off on Results and the same medians on Performance, and one reading in the table and the drawer", async () => {
    const { w, B } = await story();
    const results = tableRows(await w.results(), "Drop-off by question");
    const perf = await w.performance();
    const medians = tableRows(perf, "Typical time per step (median)");
    // Same questions, same order, same number of people who reached each.
    expect(medians.map((r) => r[0])).toEqual(results.map((r) => r[0]));
    expect(medians.map((r) => r[2])).toEqual(results.map((r) => r[1]));

    const table = stoppedCells(perf);
    const drawerOnPerformance = await w.performance({ intakeId: String(B.row.id) });
    const drawerOnResults = await w.results({ intakeId: String(B.row.id) });
    for (const html of [drawerOnPerformance, drawerOnResults]) {
      const drawer = html.slice(html.indexOf("ifm-drawer-wrap"));
      expect(drawer).toContain("Where they stopped");
      expect(drawer).toContain(table["Person 2"]);
    }
    expect(table["Person 2"]).toBe("Stopped at Q2");
  });
});

describe("the person drawer (F25)", () => {
  it("shows where they stopped and 'Answers so far (not submitted)' when progress was saved", async () => {
    const { w, B } = await story();
    const html = await w.performance({ intakeId: String(B.row.id) });
    const drawer = html.slice(html.indexOf("ifm-drawer-wrap"));
    expect(drawer).toContain("Answers so far (not submitted)");
    expect(drawer).toMatch(/<dt>What name do you want to protect\?<\/dt><dd>ACME<\/dd>/);
    expect(drawer).toContain("Stopped at Q2");
  });

  it("shows the reading but no 'Answers so far' for someone with nothing saved", async () => {
    const { w, D } = await story();
    const drawer = (await w.performance({ intakeId: String(D.row.id) })).split("ifm-drawer-wrap")[1];
    expect(drawer).toContain("Stopped at Q1");
    expect(drawer).not.toContain("Answers so far");
  });

  it("shows neither for someone who finished, and the rest of the drawer is as before", async () => {
    const { w, A } = await story();
    const drawer = (await w.performance({ intakeId: String(A.row.id) })).split("ifm-drawer-wrap")[1];
    expect(drawer).not.toContain("Where they stopped");
    expect(drawer).not.toContain("Answers so far");
    expect(drawer).toContain("Screening note");
    expect(drawer).toContain("SANKOFA");
  });

  it("labels a multi choice answer so far with its stored labels", async () => {
    const A = human(1, -60);
    const w = await boot({ people: [A.row] });
    setNow(0);
    await w.actions.recordIntakeStepAction(SLUG, { token: A.token, stepIndex: 2, questionId: "q-many", progress: { "q-many": ["Slogan, tagline", "Word mark"] } });
    setNow(3600);
    const drawer = (await w.performance({ intakeId: uuid(1) })).split("ifm-drawer-wrap")[1];
    expect(drawer).toMatch(/<dt>Which of these do you have\?<\/dt><dd>Word mark, Slogan, tagline<\/dd>/);
  });
});

describe("the range (D5)", () => {
  it("gives a shrinking funnel over 7, 30 and 90 days, and the same range on the median table", async () => {
    const day = 86_400;
    const people = [human(1, -3 * day), human(2, -20 * day), human(3, -60 * day)];
    const w = await boot({ people: people.map((p) => p.row) });
    for (const [i, p] of people.entries()) {
      const born = [-3 * day, -20 * day, -60 * day][i];
      setNow(born + 10);
      await w.actions.recordIntakeStepAction(SLUG, { token: p.token, stepIndex: 0, questionId: "q-name", progress: { "q-name": "x" } });
      setNow(born + 40);
      await w.actions.recordIntakeStepAction(SLUG, { token: p.token, stepIndex: 1, questionId: "q-pick" });
    }
    setNow(0);
    const reached = async (range: 7 | 30 | 90) => tableRows(await w.results({ range }), "Drop-off by question").map((r) => r[1]);
    expect(await reached(7)).toEqual(["1", "1", "0"]);
    expect(await reached(30)).toEqual(["2", "2", "0"]);
    expect(await reached(90)).toEqual(["3", "3", "0"]);
    const perf = await w.performance({ range: 7 });
    expect(perf).toContain("Last 7 days");
    expect(tableRows(perf, "Typical time per step (median)")[0]).toEqual([`Q1. ${FIRST_Q}`, "30 sec", "1"]);
  });
});

describe("a database that predates step recording (D6)", () => {
  it("reads every unfinished row as 'not recorded' with an empty funnel, then shows a new person's row while the old ones still say 'not recorded'", async () => {
    const old1 = human(1, -7200, { submitted_at: new Date(T0 - 7000 * 1000).toISOString() });
    const old2 = human(2, -7000);
    const old3 = human(3, -6000);
    const w = await boot({ people: [old1.row, old2.row, old3.row] });
    setNow(0);
    let results = await w.results();
    let perf = await w.performance();
    expect(results).toContain("Step data isn't recorded yet for this intake in the last 30 days.");
    expect(tableRows(results, "Drop-off by question")).toEqual([]);
    expect(perf).toContain("Step data isn't recorded yet for this intake in the last 30 days.");
    expect(stoppedCells(perf)).toEqual({ "Person 1": "—", "Person 2": "not recorded", "Person 3": "not recorded" });

    // One person starts after step recording turned on, and reaches the first question.
    const fresh = human(4, 100);
    w.db.rows("crm_intake_submission").push(fresh.row);
    setNow(110);
    await w.actions.recordIntakeStepAction(SLUG, { token: fresh.token, stepIndex: 0, questionId: "q-name", progress: { "q-name": "typing" } });
    setNow(3600);
    results = await w.results();
    perf = await w.performance();
    expect(tableRows(results, "Drop-off by question")[0]).toEqual([`Q1. ${FIRST_Q}`, "1", "1", "0", "1 · 100.0%"]);
    expect(stoppedCells(perf)).toEqual({ "Person 1": "—", "Person 2": "not recorded", "Person 3": "not recorded", "Person 4": "Stopped at Q1" });
  });
});

describe("three states (F26)", () => {
  const people = () => [human(1, -60), human(2, -50, { submitted_at: new Date(T0 - 10_000).toISOString(), answers: [{ id: "q-name", question: FIRST_Q, answer: "SANKOFA" }] })];
  const stepReads = (_p: unknown, eq: Record<string, unknown>) => eq.kind === "step";

  async function degraded(error: unknown) {
    const ps = people();
    const w = await boot({ people: ps.map((p) => p.row) });
    w.db.fail("crm_intake_event", "select", error, stepReads);
    setNow(0);
    return w;
  }

  it("unconfigured says step data isn't recorded yet, not zeros, and leaves the rest of each tab standing", async () => {
    const w = await degraded({ code: "42703", message: 'column "step_index" does not exist' });
    const results = await w.results();
    const perf = await w.performance();
    for (const html of [results, perf]) {
      expect(html).toContain("Step data isn't recorded yet for this intake.");
      expect(html).not.toContain("Couldn't load step data");
      expect(html).not.toMatch(/Drop-off<\/th>/);
    }
    // The rest of Results: the per-question answers. The rest of Performance: the funnel, the cards and the table.
    expect(results).toContain("SANKOFA");
    expect(perf).toContain("Gave contact details");
    expect(perf).toContain("Visited");
    expect(perf).toContain("All intakes");
    expect(stoppedCells(perf)).toEqual({ "Person 1": "not recorded", "Person 2": "—" });
  });

  it("unavailable says the step data couldn't be loaded, never 'no drop-off', and leaves the rest of each tab standing", async () => {
    const w = await degraded({ code: "57014", message: "statement timeout, secret detail" });
    const results = await w.results();
    const perf = await w.performance();
    for (const html of [results, perf]) {
      expect(html).toContain("Couldn&#x27;t load step data".replace("&#x27;", "'"));
      expect(html).not.toContain("secret detail");
      expect(html).not.toContain("isn't recorded yet");
      expect(html).not.toMatch(/0 · 0\.0%/);
    }
    expect(results).toContain("SANKOFA");
    expect(perf).toContain("Gave contact details");
    expect(stoppedCells(perf)["Person 1"]).toBe("Couldn't load");
  });

  it("a person's drawer says 'not recorded' or couldn't load, in its own words", async () => {
    const w = await degraded({ code: "42703", message: "column does not exist" });
    expect((await w.performance({ intakeId: uuid(1) })).split("ifm-drawer-wrap")[1]).toContain("not recorded");
    const w2 = await degraded({ code: "57014", message: "timeout" });
    expect((await w2.performance({ intakeId: uuid(1) })).split("ifm-drawer-wrap")[1]).toContain("Couldn't load step data");
  });

  it("only reads step data through the staff's scoped client, never writing anything", async () => {
    const { w } = await story();
    const before = w.db.writes.length;
    await w.results();
    await w.performance({ intakeId: uuid(2) });
    expect(w.db.writes.length).toBe(before);
  });
});

describe("the assessment with its own questions and team size hidden (D2, F14, F25)", () => {
  const extras = [
    { id: "qwhere", text: "Where did you hear about us?", required: true, type: "text" as const },
    { id: "qsell", text: "What do you sell?", required: false, type: "multi" as const, options: ["Goods", "Services, software"] },
  ];
  const settings = { ...DEFAULT_ASSESSMENT, hidden: ["3"], extras };
  const config = { ...defaultIntakeConfig(), assessment: settings };
  const HOT = { "1": "business", "2": "no", "4": "500k_1m", "5": "no", "6": "no", "7": "none", "8": "right_away" };

  /** The payload the page builds: it answers exactly the questions it is asked, in the order it asks them. */
  function browserAnswers() {
    const card = publicAssessment(settings);
    const answers: Record<string, string | string[]> = {};
    const pick: Record<string, string | string[]> = { ...HOT, qwhere: "Booth 12", qsell: ["Services, software", "Goods"] };
    let asked = askedQuestions(card, answers);
    const order: string[] = [];
    for (let i = 0; i < asked.length && i < 30; i++) {
      const q = asked[i];
      order.push(q.key);
      if (pick[q.key] !== undefined) answers[q.key] = pick[q.key];
      asked = askedQuestions(card, answers);
    }
    return { answers, order };
  }

  async function finished() {
    const A = human(1, -60, { mode: "assessment" });
    const w = await boot({ people: [A.row], config, kind: "assessment" });
    const { answers, order } = browserAnswers();
    setNow(0);
    const res = await w.actions.completeAssessmentAction(SLUG, { token: A.token, answers });
    setNow(3600);
    return { w, res, order, A };
  }

  it("is asked the card without team size, then its own questions, in order", () => {
    const { order } = browserAnswers();
    expect(order).toEqual(["1", "2", "4", "5", "6", "7", "8", "qwhere", "qsell"]);
    expect(order).not.toContain("3");
  });

  it("scores the card exactly as it would without extras and without hiding", async () => {
    const { res, w } = await finished();
    expect(res).toMatchObject({ ok: true, result: { score: 0, band: "Exposed" } });
    const stored = w.db.rows("crm_intake_submission")[0];
    const baseline = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, { ...HOT, "3": "4_10" });
    if (!baseline.ok) throw new Error("baseline");
    expect([stored.score, stored.band, stored.temperature]).toEqual([baseline.value.score.score, baseline.value.score.band, baseline.value.score.temperature]);
    expect((stored.answers as { id: string }[]).map((a) => a.id)).toEqual(["1", "2", "4", "5", "6", "7", "8", "qwhere", "qsell"]);
  });

  it("shows the card's results unchanged, the extras present, and no team-size question on Results", async () => {
    const { w } = await finished();
    setNow(0);
    const html = await w.results();
    expect(html).toContain("Your own questions");
    expect(html).toContain("Not scored");
    const where = html.slice(html.indexOf('aria-label="Where did you hear about us?"'));
    expect(where).toContain("Person 1");
    expect(where).toContain("Booth 12");
    expect(where).toContain("1 answer");
    expect(html).toMatch(/aria-label="What do you sell\?"[\s\S]*Goods, Services, software/);
    expect(html).not.toContain("employees or independent contractors");
    // The distributions are the card's own: the same as the same person without extras.
    const row = w.db.rows("crm_intake_submission")[0];
    const withExtras = assessmentResults([sampleFromSubmission(row as never)], assessmentQuestions(settings, "business"));
    const plain = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, { ...HOT, "3": "4_10" });
    if (!plain.ok) throw new Error("plain");
    const without = assessmentResults(
      [sampleFromSubmission({ ...(row as object), answers: plain.value.answerList } as never)],
      assessmentQuestions({ ...DEFAULT_ASSESSMENT, hidden: ["3"] }, "business"),
    );
    expect(withExtras.bands).toEqual(without.bands);
    expect(withExtras.temperatures).toEqual(without.temperatures);
    expect(withExtras.gaps).toEqual(without.gaps);
    expect(withExtras.questions.map((q) => q.id)).not.toContain(3);
  });

  it("shows the extras in the Answers card as stored question and answer pairs, and no team size", async () => {
    const { w } = await finished();
    const row = w.db.rows("crm_intake_submission")[0];
    const item = submissionItem(
      { id: String(row.id), form_id: FORM_A, mode: "assessment", answers: row.answers, started_at: String(row.started_at), submitted_at: String(row.submitted_at), score: row.score as number, band: row.band as string, temperature: row.temperature as string },
      { id: FORM_A, name: "Booth assessment", kind: "assessment" },
    );
    const card = text(
      renderToStaticMarkup(
        <AnswersCard tz="UTC" read={{ submissions: { status: "ok", items: item ? [item] : [], capped: false }, booth: { status: "skipped" }, requests: { status: "skipped" } }} />,
      ),
    );
    expect(card).toContain("Where did you hear about us?");
    expect(card).toContain("Booth 12");
    expect(card).toContain("Goods, Services, software");
    expect(card).not.toContain("employees or independent contractors");
    // The gap line is still the card's: extras did not make the re-read unavailable.
    expect(card).not.toContain("Gaps unavailable");
    expect(card).toContain("No entity holds this");
  });

  it("lists the extras in Results in the firm's order inside the drop-off table, after the card's questions", async () => {
    const A = human(1, -60, { mode: "assessment" });
    const w = await boot({ people: [A.row], config, kind: "assessment" });
    setNow(0);
    const keys = ["1", "2", "qwhere"];
    for (const [i, k] of keys.entries()) {
      setNow(i * 10);
      await w.actions.recordIntakeStepAction(SLUG, { token: A.token, stepIndex: i, questionId: k, progress: { "1": "business" } });
    }
    setNow(3600);
    const rows = tableRows(await w.results(), "Drop-off by question");
    expect(rows.map((r) => r[0])).toEqual([
      "Q1. Do you have a business, a personal brand, or both?",
      "Q2. Have you formed an entity with the state?",
      "Q3. What is your annual revenue?",
      "Q4. Is your business name or logo federally registered?",
      "Q5. Does your business own its intellectual property?",
      "Q6. Is your revenue protected by contracts?",
      "Q7. How quickly are you looking to engage legal assistance?",
      "Q8. Where did you hear about us?",
      "Q9. What do you sell?",
    ]);
    expect(rows[7].slice(1, 3)).toEqual(["1", "0"]);
  });
});

describe("a form nobody has started", () => {
  it("renders both tabs with the not-recorded line and no table, and no error", async () => {
    const w = await boot({ people: [] });
    setNow(0);
    for (const html of [await w.results(), await w.performance()]) {
      expect(html).toContain("Step data isn't recorded yet for this intake in the last 30 days.");
      expect(html).not.toContain("Couldn't load");
    }
  });
});
