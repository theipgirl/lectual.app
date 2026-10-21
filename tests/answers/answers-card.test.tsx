import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswersCard, EMPTY_LINE } from "@/components/answers/AnswersCard";
import { boothItem, requestItem, submissionItem, type AnswerItem } from "@/lib/answers/items";
import type { AnswersRead, SourceRead } from "@/lib/answers/load-answers";
import { BUSINESS_ANSWERS, assessmentAnswers } from "../intake-forms/helpers/forms-db";

/** Sprint 9 F1, F3, F4, F5: the card for each kind of item and each state. */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const ok = (items: (AnswerItem | null)[], capped = false): SourceRead => ({ status: "ok", items: items.filter((i): i is AnswerItem => i !== null), capped });
const render = (read: Partial<AnswersRead>) =>
  text(renderToStaticMarkup(<AnswersCard tz="UTC" read={{ submissions: { status: "skipped" }, booth: { status: "skipped" }, requests: { status: "skipped" }, ...read }} />));

const intakeForm = { id: "f1", name: "Website intake", kind: "intake" as const };
const assessForm = { id: "f2", name: "UGW booth assessment", kind: "assessment" as const };

const finishedIntake = submissionItem(
  {
    id: "s1",
    form_id: "f1",
    mode: "form",
    answers: [
      { id: "q1", question: "What name do you want to protect?", answer: "SANKOFA" },
      { id: "q2", question: "Have you used it publicly?", answer: "Yes" },
    ],
    started_at: "2026-10-18T15:00:00Z",
    submitted_at: "2026-10-18T15:04:00Z",
    score: null,
    band: null,
    temperature: null,
  },
  intakeForm,
);

const unfinishedIntake = submissionItem(
  { id: "s2", form_id: "f1", mode: "form", answers: [], started_at: "2026-10-19T15:00:00Z", submitted_at: null, score: null, band: null, temperature: null },
  intakeForm,
);

function assessment(raw: Record<string, string>, over: Partial<{ answers: unknown; id: string }> = {}) {
  const a = assessmentAnswers(raw);
  return {
    a,
    item: submissionItem(
      {
        id: over.id ?? "s3",
        form_id: "f2",
        mode: "assessment",
        answers: over.answers ?? a.answerList,
        started_at: "2026-10-17T15:00:00Z",
        submitted_at: "2026-10-17T15:03:00Z",
        score: a.score.score,
        band: a.score.band,
        temperature: a.score.temperature,
      },
      assessForm,
    ),
  };
}

describe("submissions (F1)", () => {
  it("shows a finished intake: form name and kind, date, Finished, and question and answer pairs inside an expandable block", () => {
    const html = render({ submissions: ok([finishedIntake]) });
    expect(html).toContain("Intake & assessment answers");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Website intake · Intake · Oct 18, 3:04 PM · Finished</summary>");
    expect(html).toContain("<dt");
    expect(html).toContain("What name do you want to protect?");
    expect(html).toContain("SANKOFA");
    expect(html).not.toContain("Didn't finish");
    expect(html).not.toContain(EMPTY_LINE);
    expect(html).toContain('data-kind="submission"');
  });

  it("shows an unfinished one as 'Didn't finish' with no answers listed and no empty-answers error", () => {
    const html = render({ submissions: ok([unfinishedIntake]) });
    expect(html).toContain("Website intake · Intake · Oct 19, 3:00 PM · Didn't finish");
    expect(html).toContain("They gave contact details and didn't send answers.");
    expect(html).not.toContain("<dt");
    expect(html).not.toContain("No answers were recorded");
    expect(html).not.toContain(EMPTY_LINE);
  });

  it("shows an assessment's score out of 100, band, staff-only temperature and gaps", () => {
    const { a, item } = assessment({ ...BUSINESS_ANSWERS });
    const html = render({ submissions: ok([item]) });
    expect(html).toContain(`Score ${a.score.score}/100`);
    expect(html).toContain("(Exposed)");
    expect(html).toContain("Temperature (staff only)");
    expect(html).toContain("Hot");
    for (const gap of a.score.gaps) expect(html).toContain(gap);
    expect(html).toContain("UGW booth assessment · Assessment");
    expect(html).toContain("Do you have a business, a personal brand, or both?");
    expect(html).toContain("A business");
    expect(html).not.toContain("Gaps unavailable");
  });

  it("falls back to the stored result and 'Gaps unavailable' when the answers can't be matched to the card", () => {
    const { a, item } = assessment({ ...BUSINESS_ANSWERS }, { answers: [{ id: "1", question: "q", answer: "A business" }, { id: "2", question: "q", answer: "Possibly" }] });
    const html = render({ submissions: ok([item]) });
    expect(html).toContain(`Score ${a.score.score}/100`);
    expect(html).toContain("(Exposed)");
    expect(html).toContain("Hot");
    expect(html).toContain("Gaps unavailable");
    for (const gap of a.score.gaps) expect(html).not.toContain(gap);
    expect(html).toContain("Possibly");
  });

  it("treats a submission without a known form as an intake unless its mode says assessment", () => {
    const row = { id: "s9", form_id: "gone", mode: "assessment", answers: [], started_at: "2026-10-01T00:00:00Z", submitted_at: null, score: null, band: null, temperature: null };
    expect(submissionItem(row, undefined)).toMatchObject({ formName: "Intake", formKind: "assessment" });
    expect(submissionItem({ ...row, mode: "form" }, undefined)).toMatchObject({ formKind: "intake" });
  });
});

describe("booth scorecards (F3)", () => {
  const completed = (answers: unknown, track = "business", over = {}) =>
    boothItem({
      id: "b1",
      event_code: "urban-golf-2026",
      track,
      score: 40,
      band: "partial",
      temperature: "warm",
      answers,
      gaps: ["Your name and logo are not federally registered."],
      created_at: "2026-10-17T15:00:00Z",
      completed_at: "2026-10-17T15:03:00Z",
      ...over,
    });

  it("shows event code, track, score, band, temperature, gaps and labelled answers for a Business card", () => {
    const html = render({ booth: ok([completed({ "1": "business", "2": "no", "5": "applied" })]) });
    expect(html).toContain("Booth · urban-golf-2026 · Oct 17, 3:03 PM · Finished · Score 40/100 (Partially protected)");
    expect(html).toContain("urban-golf-2026 · Business");
    expect(html).toContain("Temperature (staff only)");
    expect(html).toContain("Warm");
    expect(html).toContain("Your name and logo are not federally registered.");
    expect(html).toContain("Is your business name or logo federally registered?");
    expect(html).toContain("Application pending");
    expect(html).not.toContain(">applied<");
  });

  it("shows an IP card's labelled answers, with the brand track's wording", () => {
    const html = render({ booth: ok([completed({ "101": "brand", "102": "no", "103": "self" }, "brand")]) });
    expect(html).toContain("Personal brand");
    expect(html).toContain("Is your brand name or logo federally registered as a trademark?");
    expect(html).toContain("I searched online myself");
  });

  it("shows every chosen label of a multi-select answer, and an unknown id or value as stored", () => {
    const html = render({ booth: ok([completed({ "1": ["business", "brand"], "2": "mystery", "55": "odd value" })]) });
    expect(html).toContain("A business, A personal brand");
    expect(html).toContain("mystery");
    expect(html).toContain("Question 55");
    expect(html).toContain("odd value");
  });

  it("shows an unfinished scorecard as 'Didn't finish' with the event code and no score line", () => {
    const html = render({
      booth: ok([boothItem({ id: "b2", event_code: "story2profit-2026", track: null, score: null, band: null, temperature: null, answers: {}, gaps: [], created_at: "2026-10-18T10:00:00Z", completed_at: null })]),
    });
    expect(html).toContain("Booth · story2profit-2026 · Oct 18, 10:00 AM · Didn't finish");
    expect(html).not.toContain("Score ");
    expect(html).not.toContain("Temperature (staff only)");
    expect(html).toContain("Track not recorded");
    expect(html).toContain("They gave contact details at the booth and didn't finish the card.");
  });

  it("says no answers were recorded for a finished card whose answers are empty", () => {
    const html = render({ booth: ok([completed({})]) });
    expect(html).toContain("No answers were recorded.");
  });
});

describe("requests and order (F4)", () => {
  const req = (id: string, status: string, completed: string | null, answers: unknown = [{ id: "q", question: "Registered owner?", answer: "Acme LLC" }]) =>
    requestItem({ id, status, sent_at: "2026-10-10T10:00:00Z", completed_at: completed, answers });

  it("lists a completed request with its answers; a waiting or withdrawn one is not listed", () => {
    expect(req("r2", "sent", null)).toBeNull();
    expect(req("r3", "revoked", null)).toBeNull();
    const html = render({ requests: ok([req("r1", "completed", "2026-10-12T10:00:00Z"), req("r2", "sent", null), req("r3", "revoked", null)]) });
    expect(html).toContain("Intake questions sent to the client · Oct 12, 10:00 AM");
    expect(html).toContain("Registered owner?");
    expect(html).toContain("Acme LLC");
    expect(html.match(/<details/g)).toHaveLength(1);
  });

  it("orders all three kinds newest first by finished time, else started time", () => {
    const unfinishedLate = unfinishedIntake; // started Oct 19, never finished
    const finishedMid = finishedIntake; // finished Oct 18 15:04
    const booth = boothItem({
      id: "b9",
      event_code: "ugw",
      track: "business",
      score: 80,
      band: "protected",
      temperature: "cold",
      answers: { "1": "business" },
      gaps: [],
      created_at: "2026-10-17T15:00:00Z",
      completed_at: "2026-10-20T09:00:00Z",
    });
    const request = req("r1", "completed", "2026-10-12T10:00:00Z");
    const html = render({ submissions: ok([finishedMid, unfinishedLate]), booth: ok([booth]), requests: ok([request]) });
    const order = [...html.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);
    // booth finished Oct 20, then the unfinished intake started Oct 19, then the intake finished Oct 18, then the request Oct 12.
    expect(order).toEqual(["booth", "submission", "submission", "request"]);
    const at = (needle: string) => html.indexOf(needle);
    expect(at("Booth · ugw")).toBeLessThan(at("Oct 19, 3:00 PM"));
    expect(at("Oct 19, 3:00 PM")).toBeLessThan(at("Oct 18, 3:04 PM"));
    expect(at("Oct 18, 3:04 PM")).toBeLessThan(at("Intake questions sent to the client"));
  });
});

describe("states (F5)", () => {
  it("says 'No intake or assessment answers yet.' only when every source succeeded and came back empty", () => {
    const html = render({ submissions: ok([]), booth: ok([]) });
    expect(html).toContain(EMPTY_LINE);
    expect(html).not.toContain("Couldn't load answers");
    // A source this page doesn't have is not asked, so it doesn't make the page "empty".
    expect(render({ submissions: ok([]), booth: ok([]), requests: ok([]) })).toContain(EMPTY_LINE);
  });

  it("names a failed source, still shows the sources that loaded, and never shows the empty line", () => {
    const html = render({ submissions: { status: "unavailable" }, booth: ok([finishedIntake]) });
    expect(html).toContain("Couldn't load answers: Intake submissions");
    expect(html).toContain("not an empty result");
    expect(html).toContain("SANKOFA");
    expect(html).not.toContain(EMPTY_LINE);
    expect(html).toContain('role="alert"');
  });

  it("with a failed source and the others empty, still doesn't say there are no answers", () => {
    const html = render({ submissions: ok([]), booth: { status: "unavailable" } });
    expect(html).toContain("Couldn't load answers: Booth scorecards");
    expect(html).not.toContain(EMPTY_LINE);
  });

  it("with every source failing, shows the warning with no items and no empty line", () => {
    const html = render({ submissions: { status: "unavailable" }, booth: { status: "unavailable" }, requests: { status: "unavailable" } });
    expect(html).toContain("Couldn't load answers: Intake submissions, Booth scorecards, Questions sent to the client");
    expect(html).not.toContain("<details");
    expect(html).not.toContain(EMPTY_LINE);
  });

  it("gives a missing table its own quiet line, not the empty line", () => {
    const html = render({ submissions: ok([]), booth: { status: "unconfigured" } });
    expect(html).toContain("Booth scorecards aren't set up in this environment.");
    expect(html).not.toContain(EMPTY_LINE);
    expect(html).not.toContain("Couldn't load answers");
  });

  it("says when a source was cut at its row cap", () => {
    expect(render({ submissions: ok([finishedIntake], true) })).toContain("Showing the latest 200 intake submissions.");
  });

  it("labels the temperature as staff only and never uses raw HTML", () => {
    const { item } = assessment({ ...BUSINESS_ANSWERS });
    const html = render({ submissions: ok([item]) });
    expect(html).toContain("Staff only");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });
});
