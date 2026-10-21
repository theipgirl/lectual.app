import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intakeConfigRow, loadActions, person } from "./helpers/step-harness";
import { FORM_A, FORM_A2, FORM_B, ORG_A, ORG_B, newToken, sha256Hex } from "./helpers/step-db";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import { DEFAULT_ASSESSMENT } from "@/lib/intake-forms/assessment";
import { PROGRESS_BUDGET_BYTES, STEP_LIMIT } from "@/lib/intake-forms/steps";

/**
 * Sprint 10 F15 to F19: the public step action and its data function, called
 * the way the page calls them, with the data layer replaced by an in-memory
 * service-role fake. What matters is which rows get written, and which don't.
 */

const SLUG = "ugw-2026";
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const step = (token: string, over: Record<string, unknown> = {}) => ({ token, stepIndex: 2, questionId: "q-many", progress: { "q-name": "SANKOFA" }, ...over });

describe("a valid step call (F15)", () => {
  it("writes exactly one step event stamped with the live form, and saves the known answers", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    const res = await actions.recordIntakeStepAction(SLUG, step(p.token, { progress: { "q-name": "SANKOFA", "q-pick": "Yes", "q-many": ["Logo", "Word mark"], "q-forged": "x" } }));
    expect(res).toBeUndefined();
    const events = db.writesTo("crm_intake_event", "insert");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      org_id: ORG_A,
      form_id: FORM_A,
      kind: "step",
      step_index: 2,
      question_id: "q-many",
      submission_id: p.row.id,
    });
    expect((events[0].payload as { session_hash: string }).session_hash).toMatch(/^[0-9a-f]{64}$/);
    // Choices are kept as their labels, a multi in the question's option order; the forged id is gone.
    expect(db.rows("crm_intake_submission")[0].progress).toEqual({ "q-name": "SANKOFA", "q-pick": "Yes", "q-many": "Word mark, Logo" });
  });

  it("takes the org and form from the live form, never from the call", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    await actions.recordIntakeStepAction(SLUG, { ...step(p.token), org_id: ORG_B, orgId: ORG_B, form_id: FORM_B, formId: FORM_B, kind: "complete", session_hash: "forged" });
    const [event] = db.writesTo("crm_intake_event", "insert");
    expect(event.payload).toMatchObject({ org_id: ORG_A, form_id: FORM_A, kind: "step" });
    expect((event.payload as { session_hash: string }).session_hash).not.toBe("forged");
  });

  it("follows a renamed link to the live form", async () => {
    const p = person();
    const { db, actions } = await loadActions({
      people: [p.row],
      tables: { crm_intake_form_slug_alias: [{ slug: "old-name", form_id: FORM_A, org_id: ORG_A }] },
    });
    await actions.recordIntakeStepAction("old-name", step(p.token));
    expect(db.writesTo("crm_intake_event", "insert")).toHaveLength(1);
  });
});

describe("refusals write nothing and show nothing (F16)", () => {
  async function expectNothing(call: (a: Awaited<ReturnType<typeof loadActions>>["actions"], token: string) => Promise<unknown>, people?: (token: string) => ReturnType<typeof person>["row"][]) {
    const p = person();
    const { db, actions } = await loadActions({ people: people ? people(p.token) : [p.row] });
    const before = JSON.stringify(db.rows("crm_intake_submission"));
    await expect(call(actions, p.token)).resolves.toBeUndefined();
    expect(db.writesTo("crm_intake_event")).toHaveLength(0);
    expect(db.writesTo("crm_intake_submission")).toHaveLength(0);
    expect(JSON.stringify(db.rows("crm_intake_submission"))).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  }

  it("a token of the wrong shape", () => expectNothing((a) => a.recordIntakeStepAction(SLUG, step("short-token"))));
  it("a token that is not a string", () => expectNothing((a) => a.recordIntakeStepAction(SLUG, step(undefined as unknown as string))));
  it("a token that resolves to no one", () => expectNothing((a) => a.recordIntakeStepAction(SLUG, step(newToken()))));
  it("a token issued for a different intake of the same firm", () =>
    expectNothing(
      (a, t) => a.recordIntakeStepAction(SLUG, step(t)),
      (t) => [personFor(t, FORM_A2, ORG_A)],
    ));
  it("a token issued for a different firm's intake", () =>
    expectNothing(
      (a, t) => a.recordIntakeStepAction(SLUG, step(t)),
      (t) => [personFor(t, FORM_B, ORG_B)],
    ));
  it("a token used on another firm's link", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    await actions.recordIntakeStepAction("other-firm", step(p.token));
    expect(db.writesTo("crm_intake_event")).toHaveLength(0);
  });
  it("an unknown slug, or one that is not a string", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    await actions.recordIntakeStepAction("nope-nope", step(p.token));
    await actions.recordIntakeStepAction(42 as unknown as string, step(p.token));
    expect(db.writesTo("crm_intake_event")).toHaveLength(0);
  });
  it("a finished person", () =>
    expectNothing(
      (a, t) => a.recordIntakeStepAction(SLUG, step(t)),
      (t) => [{ ...personFor(t, FORM_A, ORG_A), submitted_at: "2026-10-20T15:09:00Z" }],
    ));

  it.each([
    ["an id the form doesn't ask", { questionId: "q-nope" }],
    ["no question id", { questionId: undefined }],
    ["a question id that is not a string", { questionId: 7 }],
    ["a step index of -1", { stepIndex: -1 }],
    ["a step index of 61", { stepIndex: 61 }],
    ["a step index of 2.5", { stepIndex: 2.5 }],
    ["a step index that is a string", { stepIndex: "2" }],
    ["a step index of NaN", { stepIndex: Number.NaN }],
  ])("%s", (_name, over) => expectNothing((a, t) => a.recordIntakeStepAction(SLUG, step(t, over))));

  it("accepts the edges: step 0 and step 60", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 0, questionId: "q-name" }));
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 60, questionId: "q-pick" }));
    expect(db.writesTo("crm_intake_event", "insert")).toHaveLength(2);
  });

  it("a payload that is not an object", async () => {
    const { db, actions } = await loadActions({});
    await actions.recordIntakeStepAction(SLUG, null);
    await actions.recordIntakeStepAction(SLUG, "x");
    await actions.recordIntakeStepAction(SLUG, undefined);
    expect(db.writes).toHaveLength(0);
  });

  it("the same step twice for one person writes one event (and still saves newer answers)", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    await actions.recordIntakeStepAction(SLUG, step(p.token, { progress: { "q-name": "A" } }));
    await actions.recordIntakeStepAction(SLUG, step(p.token, { progress: { "q-name": "AB" } }));
    expect(db.writesTo("crm_intake_event", "insert")).toHaveLength(1);
    expect(db.rows("crm_intake_submission")[0].progress).toEqual({ "q-name": "AB" });
  });

  it("a different question for the same person is a new event", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 0, questionId: "q-name" }));
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 1, questionId: "q-pick" }));
    expect(db.writesTo("crm_intake_event", "insert").map((w) => (w.payload as { question_id: string }).question_id)).toEqual(["q-name", "q-pick"]);
  });

  it("does not touch a finished person's progress", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [{ ...p.row, submitted_at: "2026-10-20T15:09:00Z", progress: { "q-name": "kept" } }] });
    await actions.recordIntakeStepAction(SLUG, step(p.token));
    expect(db.rows("crm_intake_submission")[0].progress).toEqual({ "q-name": "kept" });
  });

  it("refuses a hidden card question and accepts the firm's own extra (assessment)", async () => {
    const p = person();
    const config = {
      ...defaultIntakeConfig(),
      assessment: { ...DEFAULT_ASSESSMENT, hidden: ["3"], extras: [{ id: "qextra1", text: "Where did you hear of us?", required: false, type: "text" as const }] },
    };
    const { db, actions } = await loadActions({ people: [p.row], config, kind: "assessment" });
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 2, questionId: "3", progress: undefined }));
    expect(db.writesTo("crm_intake_event")).toHaveLength(0);
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 1, questionId: "2", progress: { "2": "yes", "3": "4_10", "1": ["business"] } }));
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 8, questionId: "qextra1", progress: { "1": ["business"], "2": "yes", "3": "4_10", qextra1: "Booth 12" } }));
    const asked = db.writesTo("crm_intake_event", "insert").map((w) => (w.payload as { question_id: string }).question_id);
    expect(asked).toEqual(["2", "qextra1"]);
    // Card values become labels; the hidden question's answer is not kept.
    expect(db.rows("crm_intake_submission")[0].progress).toEqual({ "1": "A business", "2": "Yes", qextra1: "Booth 12" });
  });
});

function personFor(token: string, formId: string, orgId: string) {
  return { ...person().row, id: `p-${formId}`, resume_hash: personHash(token), form_id: formId, org_id: orgId };
}
const personHash = sha256Hex;

describe("progress is rebuilt from the live questions (F17)", () => {
  async function saved(progress: unknown, config = intakeConfigRow(), questionId = "q-name") {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row], config });
    await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: 0, questionId, progress }));
    return db.rows("crm_intake_submission")[0].progress as Record<string, string> | null;
  }

  it("drops an unknown question id and a choice that is not an option, and clips a long value", async () => {
    const p = await saved({
      "q-name": "x".repeat(4500),
      "q-pick": "Maybe",
      "q-many": ["Logo", "Hologram"],
      "q-unknown": "nope",
    });
    expect(p).toEqual({ "q-name": "x".repeat(4000), "q-many": "Logo" });
  });

  it("drops a single choice that names two options, and a choice value that is not text", async () => {
    expect(await saved({ "q-name": "ok", "q-pick": ["Yes", "No"] })).toEqual({ "q-name": "ok" });
    expect(await saved({ "q-name": "ok", "q-pick": { a: 1 }, "q-many": 5 })).toEqual({ "q-name": "ok" });
  });

  it("leaves what is saved alone when nothing in the progress is usable", async () => {
    expect(await saved({ "q-unknown": "nope" })).toBeNull();
    expect(await saved("not an object")).toBeNull();
    expect(await saved([1, 2])).toBeNull();
  });

  it("keeps the whole under 64 KB by dropping the later answers", async () => {
    const many = {
      ...defaultIntakeConfig(),
      questions: Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, text: `Question ${i}`, required: false, pack: null, edited: true })),
    };
    const progress = Object.fromEntries(many.questions.map((q) => [q.id, "y".repeat(4000)]));
    const kept = (await saved(progress, many, "q0")) as Record<string, string>;
    expect(Buffer.byteLength(JSON.stringify(kept), "utf8")).toBeLessThanOrEqual(PROGRESS_BUDGET_BYTES);
    expect(Buffer.byteLength(JSON.stringify(kept), "utf8")).toBeLessThan(64 * 1024);
    expect(Object.keys(kept)[0]).toBe("q0");
    expect(Object.keys(kept).length).toBeLessThan(40);
    expect(Object.keys(kept).length).toBeGreaterThan(10);
  });

  it("stores text as text: markup is not interpreted or altered, and a NUL byte is removed", async () => {
    const p = await saved({ "q-name": '<img src=x onerror="alert(1)">\u0000 & more' });
    expect(p).toEqual({ "q-name": '<img src=x onerror="alert(1)"> & more' });
    expect(typeof p?.["q-name"]).toBe("string");
  });
});

describe("a database without 0096 (F18)", () => {
  const cases: [string, { code?: string; message: string }][] = [
    ["an unknown column", { code: "42703", message: 'column "step_index" of relation "crm_intake_event" does not exist' }],
    ["a schema-cache miss", { code: "PGRST204", message: "Could not find the 'question_id' column of 'crm_intake_event' in the schema cache" }],
    ["a step kind the table doesn't allow (enum)", { code: "22P02", message: 'invalid input value for enum crm_intake_event_kind: "step"' }],
    ["a step kind the table doesn't allow (check)", { code: "23514", message: 'new row for relation "crm_intake_event" violates check constraint "crm_intake_event_kind_check"' }],
  ];

  it.each(cases)("%s returns quietly, writes no progress, and logs nothing", async (_n, error) => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    db.fail("crm_intake_event", "insert", error);
    await expect(actions.recordIntakeStepAction(SLUG, step(p.token))).resolves.toBeUndefined();
    expect(db.rows("crm_intake_event")).toHaveLength(0);
    expect(db.rows("crm_intake_submission")[0].progress).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a missing progress column on the submission is also quiet", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    db.fail("crm_intake_submission", "update", { code: "42703", message: 'column "progress" of relation "crm_intake_submission" does not exist' });
    await expect(actions.recordIntakeStepAction(SLUG, step(p.token))).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("any other error is logged by code only, and never thrown", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    db.fail("crm_intake_event", "insert", { code: "XX000", message: "boom: secret internal detail for jane@example.com" });
    await expect(actions.recordIntakeStepAction(SLUG, step(p.token))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("XX000");
    expect(logged).not.toContain("boom");
    expect(logged).not.toContain("jane@example.com");
  });

  it("a read that throws is swallowed", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    db.fail("crm_intake_submission", "select", { code: "57014", message: "statement timeout" });
    await expect(actions.recordIntakeStepAction(SLUG, step(p.token))).resolves.toBeUndefined();
    expect(db.writesTo("crm_intake_event")).toHaveLength(0);
  });

  it("leaves the visit event and the intake's own completion working", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    // Only the step kind is refused, as on a database without 0096.
    db.fail("crm_intake_event", "insert", { code: "22P02", message: 'invalid input value for enum: "step"' }, (payload) => (payload as { kind?: string }).kind === "step");
    await expect(actions.recordIntakeStepAction(SLUG, step(p.token))).resolves.toBeUndefined();
    await actions.recordIntakeEventAction(SLUG, "visit");
    const done = await actions.submitIntakeAction(SLUG, { token: p.token, mode: "form", answers: { "q-name": "SANKOFA", "q-pick": "Yes" } });
    expect(done).toMatchObject({ ok: true });
    const row = db.rows("crm_intake_submission").find((r) => r.id === p.row.id);
    expect(row?.submitted_at).toBeTruthy();
    expect(row?.answers).toEqual([
      { id: "q-name", question: "What name do you want to protect?", answer: "SANKOFA" },
      { id: "q-pick", question: "Have you used it publicly?", answer: "Yes" },
    ]);
    expect(db.rows("crm_intake_event").map((r) => r.kind)).toEqual(["visit", "complete"]);
    expect(db.rows("crm_intake_event")[0]).toMatchObject({ org_id: ORG_A, form_id: FORM_A });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("its own rate limit (F19)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  });

  it("lets a 60-step run through, and drops calls past the allowance quietly", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    for (let i = 0; i < STEP_LIMIT.max + 5; i++) {
      await actions.recordIntakeStepAction(SLUG, step(p.token, { stepIndex: i % 61, questionId: "q-name", progress: { "q-name": `call ${i + 1}` } }));
    }
    // The call that would be number max + 1 never saved its progress.
    expect(db.rows("crm_intake_submission")[0].progress).toEqual({ "q-name": `call ${STEP_LIMIT.max}` });
    expect(STEP_LIMIT.max).toBeGreaterThanOrEqual(61);
  });

  it("is a separate allowance from the visit and start events", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    // 60 visit events use up the visit allowance (60 per 10 minutes)...
    for (let i = 0; i < 61; i++) await actions.recordIntakeEventAction(SLUG, "visit");
    expect(db.writesTo("crm_intake_event", "insert")).toHaveLength(60);
    // ...and a step still goes through.
    await actions.recordIntakeStepAction(SLUG, step(p.token));
    expect(db.writesTo("crm_intake_event", "insert").filter((w) => (w.payload as { kind: string }).kind === "step")).toHaveLength(1);
  });

  it("is per client, and opens again after the window", async () => {
    const p = person();
    const { db, actions } = await loadActions({ people: [p.row] });
    for (let i = 0; i < STEP_LIMIT.max; i++) await actions.recordIntakeStepAction(SLUG, step(p.token, { progress: { "q-name": `a${i}` } }));
    await actions.recordIntakeStepAction(SLUG, step(p.token, { progress: { "q-name": "dropped" } }));
    expect(db.rows("crm_intake_submission")[0].progress).toEqual({ "q-name": `a${STEP_LIMIT.max - 1}` });
    vi.setSystemTime(new Date(Date.now() + STEP_LIMIT.windowMs + 1000));
    await actions.recordIntakeStepAction(SLUG, step(p.token, { progress: { "q-name": "after the window" } }));
    expect(db.rows("crm_intake_submission")[0].progress).toEqual({ "q-name": "after the window" });
  });
});
