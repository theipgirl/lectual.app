import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { ChoiceControl } from "../../src/app/i/[slug]/_components/ChoiceControl";
import { QuestionFields } from "../../src/app/i/[slug]/_components/QuestionFields";
import { buildThread, ConversationInput, ThreadBubbles, type ChatStep } from "../../src/app/i/[slug]/_components/ConversationParts";
import { AssessmentExtraChoice } from "../../src/app/i/[slug]/_components/PublicAssessment";
import type { AskedQuestion } from "@/lib/intake-forms/assessment-asked";
import { AssessmentNav } from "../../src/app/i/[slug]/_components/AssessmentNav";
import { RequestForm } from "../../src/app/r/[token]/_components/RequestForm";
import { defaultIntakeConfig, publicConfig, validateIntakeConfig } from "@/lib/intake-forms/config";
import { validateAnswers } from "@/lib/intake-forms/public-submit";
import { createStepTracker, shouldSendStep } from "@/lib/intake-forms/step-tracking";
import { intakeQuestionResults } from "@/lib/intake-forms/results";
import { buildCsv } from "@/lib/intake-forms/csv";
import { formQuestions } from "@/lib/intake-forms/form-questions";
import { AnswersCard } from "@/components/answers/AnswersCard";
import { submissionItem } from "@/lib/answers/items";
import { AdminFake, ORG_A, newToken } from "./helpers/step-db";

/**
 * Sprint 10 F4, F5, F6, F20 and D1: how a choice question is drawn on the
 * public form, in the conversation and on the matter request form, and how
 * the browser's tracking behaves. There is no DOM here (the tests run in node),
 * so the pieces are checked by static markup and by walking element trees.
 */

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const QUESTIONS = [
  { id: "qt", text: "Describe the mark.", required: true },
  { id: "qs", text: "Have you used it publicly?", required: true, type: "single" as const, options: ["Yes", "No", "Not yet, soon"] },
  { id: "qm", text: "What do you have?", required: false, type: "multi" as const, options: ["Word mark", "Logo", "Slogan, tagline"] },
];

describe("the shared choice control", () => {
  it("draws one radio per option for a single choice, in labels, and checks the chosen one", () => {
    const out = html(<ChoiceControl name="g" type="single" options={["A", "B", "C"]} value={["B"]} label="Pick one" />);
    expect(count(out, /type="radio"/g)).toBe(3);
    expect(count(out, /type="checkbox"/g)).toBe(0);
    expect(count(out, /<label/g)).toBe(3);
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-label="Pick one"');
    expect(out).toMatch(/<input type="radio" name="g" checked="" value="B"\/>/);
    expect(out).toMatch(/class="ipub-choice-opt on"/);
  });

  it("draws checkboxes for a multi choice and checks every chosen label", () => {
    const out = html(<ChoiceControl name="g" type="multi" options={["A", "B", "C"]} value={["A", "C"]} label="Pick" />);
    expect(count(out, /type="checkbox"/g)).toBe(3);
    expect(count(out, /checked=""/g)).toBe(2);
    expect(out).toContain('role="group"');
  });

  it("renders option text as text, never as markup", () => {
    const out = html(<ChoiceControl name="g" type="single" options={['<img src=x onerror="alert(1)">']} value={[]} label="q" />);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("is the same control in the editor's preview, with the preview's classes and nothing clickable", () => {
    const out = html(<ChoiceControl name="g" type="single" options={["A", "B"]} value={[]} label="q" scope="preview" disabled />);
    expect(out).toContain("ifm-pv-choice");
    expect(out).not.toContain("ipub-choice");
    expect(count(out, /disabled=""/g)).toBe(2);
  });

  it("passes the tapped label up: single replaces, multi toggles in option order", () => {
    const seen: string[][] = [];
    const single = ChoiceControl({ name: "g", type: "single", options: ["A", "B"], value: [], label: "q", onChange: (n) => seen.push(n) });
    const radios = findAll(single, (e) => e.type === "input" && (e.props as { type?: string }).type === "radio");
    (radios[1].props as { onClick: (e: { detail: number }) => void }).onClick({ detail: 1 });
    expect(seen).toEqual([["B"]]);
    const multi = ChoiceControl({ name: "g", type: "multi", options: ["A", "B", "C"], value: ["C"], label: "q", onChange: (n) => seen.push(n) });
    const boxes = findAll(multi, (e) => e.type === "input" && (e.props as { type?: string }).type === "checkbox");
    (boxes[0].props as { onChange: () => void }).onChange();
    expect(seen[1]).toEqual(["A", "C"]);
  });
});

describe("a single choice selects on the keyboard and commits only on a tap or Enter (V4)", () => {
  type Click = (e: { detail: number; target?: { tagName: string }; preventDefault?: () => void }) => void;
  const pointer = (tagName: string) => ({ detail: 1, target: { tagName }, preventDefault: vi.fn() });
  const radiosOf = (el: ReactElement) => findAll(el, (e) => e.type === "input" && (e.props as { type?: string }).type === "radio");

  const labelsOf = (el: ReactElement) => findAll(el, (e) => e.type === "label");

  it("the radio's own click only selects; the label commits once on a pointer click (detail 1) and never on detail 0", () => {
    const changed: string[][] = [];
    const committed: string[][] = [];
    const el = ChoiceControl({ name: "g", type: "single", options: ["A", "B", "C", "D"], value: [], label: "q", onChange: (n) => changed.push(n), onCommit: (n) => committed.push(n) });
    const radios = radiosOf(el);
    const labels = labelsOf(el);
    // The radio: any click, detail 0 or 1, only selects.
    (radios[2].props as { onClick: Click }).onClick({ detail: 0 });
    (radios[2].props as { onClick: Click }).onClick({ detail: 1 });
    expect(changed).toEqual([["C"], ["C"]]);
    expect(committed).toEqual([]);
    // The label: a browser forwards a label click to its radio with detail 0, so that one must not commit again.
    (labels[2].props as { onClick: Click }).onClick({ detail: 0 });
    expect(committed).toEqual([]);
    (labels[2].props as { onClick: Click }).onClick(pointer("SPAN"));
    expect(committed).toEqual([["C"]]);
  });

  it("a pointer click on the label's text selects and commits, and cancels the click the browser would forward to the radio; a click on the radio itself is left alone", () => {
    const changed: string[][] = [];
    const committed: string[][] = [];
    const el = ChoiceControl({ name: "g", type: "single", options: ["A", "B"], value: [], label: "q", onChange: (n) => changed.push(n), onCommit: (n) => committed.push(n) });
    const label = labelsOf(el)[1].props as { onClick: Click };
    const onText = pointer("SPAN");
    label.onClick(onText);
    expect(onText.preventDefault).toHaveBeenCalledTimes(1);
    expect(changed).toEqual([["B"]]);
    expect(committed).toEqual([["B"]]);
    // The radio circle: the radio's own onClick selects, the label (bubbled to) commits once, nothing is cancelled.
    const onRadio = pointer("INPUT");
    label.onClick(onRadio);
    expect(onRadio.preventDefault).not.toHaveBeenCalled();
    expect(committed).toEqual([["B"], ["B"]]);
    // A forwarded click (detail 0) neither selects nor commits nor cancels.
    const forwarded = { detail: 0, target: { tagName: "INPUT" }, preventDefault: vi.fn() };
    label.onClick(forwarded);
    expect(forwarded.preventDefault).not.toHaveBeenCalled();
    expect(committed).toHaveLength(2);
  });

  it("each question gets its own control: the conversation's and the assessment extra's ChoiceControl are keyed by the question", () => {
    // Two Yes/No questions in a row share option text. Unkeyed, React reuses the first one's label and radio nodes for
    // the second, and the browser's forwarded click (after the re-render) answers the second question too.
    const base = { prompt: "Q", required: true, kind: "question" as const, type: "single" as const, options: ["Yes", "No"] };
    for (const key of ["qa", "qb"]) {
      const el = ConversationInput({ step: { ...base, key }, draft: "", maxLength: 10, hint: null, picked: [], onDraft: () => {}, onSend: () => {}, onSkip: () => {}, onPick: () => {}, onCommit: () => {}, onDone: () => {} }) as ReactElement;
      const control = findAll(el, (e) => e.type === ChoiceControl)[0];
      expect(control.key).toBe(key);
    }
    for (const key of ["qx1", "qx2"]) {
      const el = AssessmentExtraChoice({
        question: { key, question: "Q", subtext: "", type: "single", required: true, extra: true, grid: false, options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] } satisfies AskedQuestion,
        value: undefined,
        disabled: false,
        onAnswer: () => {},
        onCommit: () => {},
      }) as ReactElement;
      expect(el.type).toBe(ChoiceControl);
      expect(el.key).toBe(key);
    }
  });

  it("without a commit handler the label carries no click handler, and multi choice never commits", () => {
    const plain = ChoiceControl({ name: "g", type: "single", options: ["A", "B"], value: [], label: "q", onChange: () => {} });
    expect(labelsOf(plain).every((l) => (l.props as { onClick?: unknown }).onClick === undefined)).toBe(true);
    const multi = ChoiceControl({ name: "g", type: "multi", options: ["A", "B"], value: [], label: "q", onChange: () => {}, onCommit: () => {} });
    expect(labelsOf(multi).every((l) => (l.props as { onClick?: unknown }).onClick === undefined)).toBe(true);
  });

  it("Enter on a radio selects and commits; other keys do nothing", () => {
    const committed: string[][] = [];
    const el = ChoiceControl({ name: "g", type: "single", options: ["A", "B"], value: [], label: "q", onChange: () => {}, onCommit: (n) => committed.push(n) });
    const onKeyDown = (radiosOf(el)[1].props as { onKeyDown: (e: { key: string; preventDefault: () => void }) => void }).onKeyDown;
    const preventDefault = vi.fn();
    onKeyDown({ key: "ArrowDown", preventDefault });
    onKeyDown({ key: " ", preventDefault });
    expect(committed).toEqual([]);
    onKeyDown({ key: "Enter", preventDefault });
    expect(committed).toEqual([["B"]]);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("without a commit handler (the plain form) Enter is left to the browser", () => {
    const el = ChoiceControl({ name: "g", type: "single", options: ["A", "B"], value: [], label: "q", onChange: () => {} });
    expect((radiosOf(el)[0].props as { onKeyDown?: unknown }).onKeyDown).toBeUndefined();
  });

  it("the conversation hands a keyboard selection to onPick and only a tap to onCommit, and has a Done control for a single choice", () => {
    const onPick = vi.fn();
    const onCommit = vi.fn();
    const step: ChatStep = { key: "qs", prompt: "Used it?", required: true, kind: "question", type: "single", options: ["A", "B", "C"] };
    const el = ConversationInput({ step, draft: "", maxLength: 10, hint: null, picked: [], onDraft: () => {}, onSend: () => {}, onSkip: () => {}, onPick, onCommit, onDone: () => {} }) as ReactElement;
    const control = findAll(el, (e) => e.type === ChoiceControl)[0];
    const props = control.props as Parameters<typeof ChoiceControl>[0];
    const control2 = ChoiceControl(props);
    const radios = radiosOf(control2);
    const labels = labelsOf(control2);
    (radios[1].props as { onClick: Click }).onClick({ detail: 0 });
    expect(onPick).toHaveBeenCalledWith(["B"]);
    expect(onCommit).not.toHaveBeenCalled();
    (labels[1].props as { onClick: Click }).onClick({ detail: 0 });
    expect(onCommit).not.toHaveBeenCalled();
    (labels[1].props as { onClick: Click }).onClick(pointer("SPAN"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(["B"]);
    expect(html(el)).toContain(">Done<");
  });

  it("a single-choice extra in the assessment has Next, and 'See my results' as the last question; a card single choice still has neither", () => {
    const nav = (current: { type: "single" | "multi" | "text"; required: boolean; extra: boolean }, lastStep: boolean) =>
      html(<AssessmentNav step={1} lastStep={lastStep} current={current} pending={false} onBack={() => {}} onSkip={() => {}} onNext={() => {}} />);
    expect(nav({ type: "single", required: true, extra: true }, false)).toContain(">Next<");
    expect(nav({ type: "single", required: true, extra: true }, true)).toContain(">See my results<");
    const card = nav({ type: "single", required: true, extra: false }, false);
    expect(card).not.toContain(">Next<");
    expect(card).not.toContain("See my results");
    expect(nav({ type: "multi", required: true, extra: false }, true)).toContain(">See my results<");
  });
});

describe("the public form's questions (F4)", () => {
  const answers = {};
  const render = (over: Record<string, unknown> = {}) =>
    html(<QuestionFields questions={QUESTIONS} answers={answers} badFields={[]} onChange={() => {}} {...over} />);

  it("has one textarea, a radio group for the single choice and checkboxes for the multi choice", () => {
    const out = render();
    expect(count(out, /<textarea/g)).toBe(1);
    expect(count(out, /type="radio"/g)).toBe(3);
    expect(count(out, /type="checkbox"/g)).toBe(3);
    for (const label of ["Yes", "No", "Not yet, soon", "Word mark", "Logo", "Slogan, tagline"]) expect(out).toContain(`<span>${label}</span>`);
  });

  it("shows no textarea for a choice question", () => {
    const out = render({ questions: QUESTIONS.slice(1) });
    expect(out).not.toContain("<textarea");
  });

  it("marks required questions and not optional ones", () => {
    const out = render();
    expect(count(out, /ipub-req/g)).toBe(2);
    const optionalOnly = render({ questions: [QUESTIONS[2]] });
    expect(optionalOnly).not.toContain("ipub-req");
  });

  it("puts a choice question in a fieldset with its text as the legend, so it is reachable and named", () => {
    const out = render();
    expect(out).toMatch(/<fieldset class="ipub-field ipub-choice-field"><legend class="ipub-label">Have you used it publicly\?/);
  });

  it("shows what was chosen, including a multi answer that came back as a list, and flags a bad field", () => {
    const out = render({ answers: { qs: "No", qm: ["Logo", "Slogan, tagline"], qt: "SANKOFA" }, badFields: ["qs"] });
    expect(out).toMatch(/checked="" value="No"/);
    expect(count(out, /type="checkbox"[^>]*checked=""/g)).toBe(2);
    expect(out).toContain("SANKOFA");
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain("ipub-choice bad");
  });

  it("keeps a multi answer across the switch to the form and back (state is a list)", () => {
    const labels = ["Logo", "Slogan, tagline"];
    const out = render({ answers: { qm: labels } });
    expect(count(out, /type="checkbox"[^>]*checked=""/g)).toBe(2);
  });

  it("tells the page when a question is first touched", () => {
    const touched: [string, number][] = [];
    const tree = QuestionFields({ questions: QUESTIONS, answers: {}, badFields: [], onChange: () => {}, onTouch: (id, i) => touched.push([id, i]) });
    const textarea = findAll(tree, (e) => e.type === "textarea")[0];
    (textarea.props as { onFocus: () => void }).onFocus();
    const fieldsets = findAll(tree, (e) => e.type === "fieldset");
    (fieldsets[1].props as { onFocus: () => void }).onFocus();
    expect(touched).toEqual([
      ["qt", 0],
      ["qm", 2],
    ]);
  });
});

describe("the conversation's step (F5)", () => {
  const step = (over: Partial<ChatStep> = {}): ChatStep => ({ key: "qs", prompt: "Have you used it publicly?", required: true, kind: "question", type: "single", options: ["Yes", "No"], ...over });
  const input = (s: ChatStep, over: Record<string, unknown> = {}) =>
    html(
      <ConversationInput step={s} draft="" maxLength={4000} hint={null} picked={[]} onDraft={() => {}} onSend={() => {}} onSkip={() => {}} onPick={() => {}} onCommit={() => {}} onDone={() => {}} {...over} />,
    );

  it("a single choice is one control per option and no text box", () => {
    const out = input(step());
    expect(count(out, /type="radio"/g)).toBe(2);
    expect(out).not.toContain("<textarea");
    expect(out).not.toContain("ipub-composer\"");
    expect(out).toContain(">Done<");
    expect(out).not.toContain("Skip");
    expect(out).toContain("ipub-choice chat");
  });

  it("a multi choice is checkboxes and a Done control", () => {
    const out = input(step({ type: "multi", options: ["A", "B", "C"], key: "qm" }));
    expect(count(out, /type="checkbox"/g)).toBe(3);
    expect(out).toContain(">Done<");
    expect(out).not.toContain("<textarea");
  });

  it("an optional choice also has Skip, and a required one does not", () => {
    expect(input(step({ required: false }))).toContain(">Skip<");
    expect(input(step({ required: false, type: "multi" }))).toContain(">Skip<");
    expect(input(step({ type: "multi" }))).not.toContain(">Skip<");
  });

  it("a text question still gets the composer, with Skip only when optional", () => {
    const out = input(step({ type: "text", options: [] }));
    expect(out).toContain("<textarea");
    expect(out).toContain('aria-label="Send"');
    expect(out).toContain('placeholder="Type your answer…"');
    expect(out).not.toContain("radio");
    expect(input(step({ type: "text", options: [], required: false }))).toContain(">Skip<");
  });

  it("a text question's composer is unchanged by Sprint 10 (same markup it always had)", () => {
    const out = input(step({ type: "text", options: [] }), { draft: "hello" });
    expect(out).toBe(
      '<div class="ipub-composer-wrap"><div class="ipub-composer"><textarea rows="1" maxLength="4000" placeholder="Type your answer…" aria-label="Have you used it publicly?">hello</textarea><button type="button" class="ipub-send" aria-label="Send"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></button></div></div>',
    );
  });

  it("shows a hint above the choices", () => {
    expect(input(step({ type: "multi" }), { hint: "Choose at least one to continue." })).toContain("Choose at least one to continue.");
  });

  it("the thread shows the chosen label, and all the labels for a multi choice", () => {
    const steps: ChatStep[] = [
      step({ key: "qs", prompt: "Used it?" }),
      step({ key: "qm", prompt: "What do you have?", type: "multi", options: ["Word mark", "Logo"] }),
      step({ key: "qo", prompt: "Anything else?", type: "single", required: false, options: ["A", "B"] }),
    ];
    const chosen: Record<string, string> = { qs: "Yes", qm: "Word mark, Logo", qo: "" };
    const thread = buildThread({ opening: "Hi", steps, answered: 3, textOf: (s) => chosen[s.key], current: null });
    const out = text(html(<ThreadBubbles thread={thread} />));
    expect(out).toContain('<div class="ipub-bubble you">Yes</div>');
    expect(out).toContain('<div class="ipub-bubble you">Word mark, Logo</div>');
    expect(out).toContain('<div class="ipub-bubble you">Skipped</div>');
    expect(thread[0]).toEqual({ who: "bot", text: "Hi" });
  });

  it("asks the current question last", () => {
    const s = step();
    const thread = buildThread({ opening: "Hi", steps: [s], answered: 0, textOf: () => "", current: s });
    expect(thread.at(-1)).toEqual({ who: "bot", text: "Have you used it publicly?" });
  });
});

describe("the matter request form (F6)", () => {
  it("draws a choice question as radio or checkbox controls, and text as a textarea", () => {
    const out = html(<RequestForm token="t" questions={QUESTIONS} />);
    expect(count(out, /type="radio"/g)).toBe(3);
    expect(count(out, /type="checkbox"/g)).toBe(3);
    expect(count(out, /<textarea/g)).toBe(1);
    expect(out).toContain("Send answers");
  });

  async function loadRequestAction(config: unknown) {
    const token = newToken();
    const db = new AdminFake({
      crm_intake_request: [{ id: "req-1", org_id: ORG_A, form_id: "form-1", matter_id: "matter-1", status: "sent", token }],
      crm_intake_form: [{ id: "form-1", org_id: ORG_A, config }],
      crm_org: [{ id: ORG_A, name: "Hartwell IP" }],
      crm_activity: [],
    });
    vi.resetModules();
    vi.doMock("@/lib/db/admin", () => ({ getAdminClient: () => db.client() }));
    const { submitIntakeRequestAction } = await import("../../src/app/r/[token]/actions");
    return { db, token, submit: submitIntakeRequestAction };
  }
  const config = () => validateIntakeConfig(JSON.parse(JSON.stringify({ ...defaultIntakeConfig(), questions: QUESTIONS.map((q) => ({ pack: null, edited: true, ...q })) })));

  it("refuses a label that is not an option, with the same sentence as the public form", async () => {
    const c = config();
    if (!c.ok) throw new Error(c.errors.join());
    const { db, token, submit } = await loadRequestAction(c.config);
    const bad = await submit(token, { qt: "x", qs: "Maybe" });
    expect(bad).toEqual({ ok: false, error: "Please choose one of the listed answers for: Have you used it publicly?", fields: ["qs"] });
    expect(db.writesTo("crm_intake_request")).toHaveLength(0);
    const same = validateAnswers({ qt: "x", qs: "Maybe" }, c.config.questions);
    expect(same.errors).toEqual(["Please choose one of the listed answers for: Have you used it publicly?"]);
  });

  it("stores the option labels when the answers are good", async () => {
    const c = config();
    if (!c.ok) throw new Error(c.errors.join());
    const { db, token, submit } = await loadRequestAction(c.config);
    const res = await submit(token, { qt: "SANKOFA", qs: "Not yet, soon", qm: ["Slogan, tagline", "Logo"] });
    expect(res).toEqual({ ok: true });
    const stored = db.rows("crm_intake_request")[0];
    expect(stored.status).toBe("completed");
    expect((stored.answers as { id: string; answer: string }[]).map((a) => [a.id, a.answer])).toEqual([
      ["qt", "SANKOFA"],
      ["qs", "Not yet, soon"],
      ["qm", "Logo, Slogan, tagline"],
    ]);
  });

  it("refuses a required choice left empty", async () => {
    const c = config();
    if (!c.ok) throw new Error(c.errors.join());
    const { token, submit } = await loadRequestAction(c.config);
    expect(await submit(token, { qt: "x" })).toMatchObject({ ok: false, error: "Please answer: Have you used it publicly?" });
  });
});

describe("the browser's step tracking (F20)", () => {
  it("sends nothing without a token", () => {
    const send = vi.fn();
    const t = createStepTracker(send);
    t.track({ token: "", stepIndex: 0, questionId: "q1", progress: {} });
    t.track({ token: null, stepIndex: 0, questionId: "q1", progress: {} });
    t.track({ token: undefined, stepIndex: 0, questionId: "q1", progress: {} });
    expect(send).not.toHaveBeenCalled();
    // A question skipped for want of a token is not marked as sent: it goes out once there is one.
    t.track({ token: "tok", stepIndex: 0, questionId: "q1", progress: {} });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends each question once", () => {
    const send = vi.fn();
    const t = createStepTracker(send);
    for (let i = 0; i < 3; i++) t.track({ token: "tok", stepIndex: 0, questionId: "q1", progress: {} });
    t.track({ token: "tok", stepIndex: 1, questionId: "q2", progress: { q1: "a" } });
    expect(send.mock.calls.map((c) => c[0].questionId)).toEqual(["q1", "q2"]);
    expect(send.mock.calls[1][0]).toEqual({ token: "tok", stepIndex: 1, questionId: "q2", progress: { q1: "a" } });
    const sent = new Set<string>();
    expect(shouldSendStep(sent, "t", "a")).toBe(true);
    expect(shouldSendStep(sent, "t", "a")).toBe(false);
  });

  it("swallows a throw, a rejection and a refusal", async () => {
    const t = createStepTracker(() => {
      throw new Error("sync boom");
    });
    expect(() => t.track({ token: "tok", stepIndex: 0, questionId: "a", progress: {} })).not.toThrow();
    const rejects = createStepTracker(() => Promise.reject(new Error("async boom")));
    expect(() => rejects.track({ token: "tok", stepIndex: 0, questionId: "a", progress: {} })).not.toThrow();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    const refused = createStepTracker(async () => undefined);
    expect(refused.track({ token: "tok", stepIndex: 0, questionId: "a", progress: {} })).toBeUndefined();
  });

  it("every call to the step action in the public components is fire-and-forget through the tracker", () => {
    const root = path.join(__dirname, "../../src/app/i/[slug]/_components");
    for (const file of ["PublicIntake.tsx", "PublicAssessment.tsx"]) {
      const src = readFileSync(path.join(root, file), "utf8");
      const uses = src.split("\n").filter((l) => l.includes("recordIntakeStepAction"));
      // the import, and the one wrapper handed to the tracker
      expect(uses).toHaveLength(2);
      expect(uses.some((l) => l.includes("createStepTracker((call) => recordIntakeStepAction(slug, call))"))).toBe(true);
      expect(src).not.toMatch(/await\s+recordIntakeStepAction/);
    }
  });

  describe("the pages", () => {
    afterEach(() => vi.resetModules());

    async function loadPages() {
      vi.resetModules();
      const actions = {
        recordIntakeEventAction: vi.fn(async () => {}),
        recordIntakeStepAction: vi.fn(async () => {}),
        startIntakeAction: vi.fn(),
        submitIntakeAction: vi.fn(),
        completeAssessmentAction: vi.fn(),
      };
      vi.doMock("../../src/app/i/[slug]/actions", () => actions);
      const { PublicIntake } = await import("../../src/app/i/[slug]/_components/PublicIntake");
      const { PublicAssessment } = await import("../../src/app/i/[slug]/_components/PublicAssessment");
      return { PublicIntake, PublicAssessment, actions };
    }
    const view = (mode: "conversation" | "form") =>
      publicConfig({ ...defaultIntakeConfig(), mode, questions: QUESTIONS.map((q) => ({ pack: null, edited: true, ...q })) }, { orgName: "Hartwell IP", receivesReferrals: false });

    it("render with no network side effect, in either mode", async () => {
      const { PublicIntake, PublicAssessment, actions } = await loadPages();
      for (const mode of ["conversation", "form"] as const) {
        const out = renderToStaticMarkup(<PublicIntake slug="ugw" view={view(mode)} packages={[]} stamp="x" embed={false} />);
        expect(out).toContain("Hartwell IP");
      }
      const asm = publicConfig({ ...defaultIntakeConfig() }, { orgName: "Hartwell IP", receivesReferrals: false });
      expect(renderToStaticMarkup(<PublicAssessment slug="ugw" view={asm} stamp="x" embed={false} />)).toContain("Brand &amp; Business Assessment");
      for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
    });

    it("keep the honeypot and the embed-height hook, and show no staff-only data", async () => {
      const { PublicIntake, PublicAssessment } = await loadPages();
      const a = renderToStaticMarkup(<PublicIntake slug="ugw" view={view("form")} packages={[]} stamp="x" embed />);
      expect(a).toContain('name="website_url"');
      expect(a).toContain("ipub embed");
      const b = renderToStaticMarkup(
        <PublicAssessment slug="ugw" view={publicConfig({ ...defaultIntakeConfig() }, { orgName: "Hartwell IP", receivesReferrals: false })} stamp="x" embed />,
      );
      for (const out of [a, b]) expect(out).not.toMatch(/temperature|points|category|knows|fitText|step_index|progress/i);
      expect(b).toContain('name="website_url"');
    });
  });
});

describe("a choice question round trip (D1)", () => {
  it("is validated, drawn, answered, stored, listed in Results, exported and shown in the Answers card", () => {
    // 1. A form config with a text, a single and a multi question is validated on save.
    const saved = validateIntakeConfig(JSON.parse(JSON.stringify({ ...defaultIntakeConfig(), questions: QUESTIONS.map((q) => ({ pack: null, edited: true, ...q })) })));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const config = saved.config;

    // 2. The public page is drawn from the public view of it.
    const view = publicConfig(config, { orgName: "Hartwell IP", receivesReferrals: false });
    const drawn = html(<QuestionFields questions={view.questions} answers={{}} badFields={[]} onChange={() => {}} />);
    expect(count(drawn, /<textarea/g)).toBe(1);
    expect(count(drawn, /type="radio"/g)).toBe(3);
    expect(count(drawn, /type="checkbox"/g)).toBe(3);

    // 3. The browser builds its payload as the page does, and the server validates it against the STORED options.
    const payload = { qt: "SANKOFA", qs: "Yes", qm: ["Slogan, tagline", "Word mark"] };
    const checked = validateAnswers(payload, config.questions);
    expect(checked.errors).toEqual([]);
    expect(checked.answers.map((a) => a.answer)).toEqual(["SANKOFA", "Yes", "Word mark, Slogan, tagline"]);

    // 4. Results lists the stored labels, newest first.
    const row = {
      id: "s1",
      contact: { name: "Ana Ruiz", email: "ana@example.com" },
      answers: checked.answers,
      started_at: "2026-10-18T15:00:00Z",
      submitted_at: "2026-10-18T15:04:00Z",
      lead_id: "lead-1",
    };
    const results = intakeQuestionResults([row], formQuestions("intake", config));
    expect(results.map((r) => [r.question, r.rows[0]?.answer])).toEqual([
      ["Describe the mark.", "SANKOFA"],
      ["Have you used it publicly?", "Yes"],
      ["What do you have?", "Word mark, Slogan, tagline"],
    ]);

    // 5. The CSV quotes the multi answer's comma, and a parser gives the stored text back.
    const csv = buildCsv([row], formQuestions("intake", config));
    expect(csv).toContain('"Word mark, Slogan, tagline"');
    expect(parseCsvLine(csv.split("\r\n")[1])).toEqual(["Ana Ruiz", "ana@example.com", "2026-10-18T15:00:00Z", "2026-10-18T15:04:00Z", "SANKOFA", "Yes", "Word mark, Slogan, tagline"]);

    // 6. The Answers card shows them as question and answer pairs.
    const item = submissionItem(
      { id: "s1", form_id: "f1", mode: "form", answers: checked.answers, started_at: row.started_at, submitted_at: row.submitted_at, score: null, band: null, temperature: null },
      { id: "f1", name: "Website intake", kind: "intake" },
    );
    const card = text(
      renderToStaticMarkup(
        <AnswersCard tz="UTC" read={{ submissions: { status: "ok", items: item ? [item] : [], capped: false }, booth: { status: "skipped" }, requests: { status: "skipped" } }} />,
      ),
    );
    expect(card).toContain("What do you have?");
    expect(card).toContain("Word mark, Slogan, tagline");
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function findAll(node: ReactNode, test: (e: ReactElement) => boolean, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((n) => findAll(n, test, out));
    return out;
  }
  if (!isValidElement(node)) return out;
  if (test(node)) out.push(node);
  findAll((node.props as { children?: ReactNode }).children, test, out);
  return out;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}
