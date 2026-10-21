"use server";

import { after } from "next/server";
import { cookies, headers } from "next/headers";
import {
  completeStartedIntake,
  readIntakeHandle as readHandleBySlug,
  recentCompletions,
  recordIntakeEvent,
  recordIntakeStep,
  screenSubmission,
  startPublicIntake,
  submitPublicIntake,
} from "@/lib/intake-forms/public";
import { parseStepIndex, sanitizeProgress, stepQuestions, STEP_LIMIT } from "@/lib/intake-forms/steps";
import { answersNote, readSpamFields, RESUME_TOKEN_SHAPE, validateAnswers, validatePublicStart, validatePublicSubmission } from "@/lib/intake-forms/public-submit";
import { assessmentStaffLine, scoreAssessmentAnswers, type AssessmentResultView } from "@/lib/intake-forms/assessment";
import { syncIntakeCompletion, syncIntakeStart } from "@/lib/intake-forms/lawmatics-sync";
import {
  checkStamp,
  clientIp,
  clientKey,
  newSessionId,
  sessionHash,
  SESSION_COOKIE,
  SESSION_ID_PATTERN,
  SlidingWindowThrottle,
} from "@/lib/intake-forms/spam";
import { intakeSalt, throttleKey } from "@/lib/intake-forms/secrets";

/** The live intake by slug, following a renamed link to where it lives now. */
async function readIntakeHandle(slug: string) {
  const read = await readHandleBySlug(slug);
  return read.status === "moved" ? readHandleBySlug(read.slug) : read;
}

/**
 * The public intake's server actions. Each is its own unauthenticated POST
 * entry point, so each re-reads the LIVE form by slug and trusts nothing else
 * from the browser: not an org, not a form id, not a question's text.
 *
 * Spam guards, in order: the hidden honeypot field, then (after the answers
 * validate) the signed render stamp's minimum fill time, an in-memory
 * per-client throttle keyed on an HMAC of the IP, and — when sessions are
 * hashed — a database count of this session's recent completions. A bot that
 * trips the honeypot or the fill time is told "thanks" and nothing is
 * written: telling it why teaches it.
 */

const submitThrottle = new SlidingWindowThrottle(5, 10 * 60_000);
const startThrottle = new SlidingWindowThrottle(8, 10 * 60_000);
const eventThrottle = new SlidingWindowThrottle(60, 10 * 60_000);
// Its own allowance: a person answering a 60-step form must not use up (or be cut off by) the visit/start events.
const stepThrottle = new SlidingWindowThrottle(STEP_LIMIT.max, STEP_LIMIT.windowMs);

/** The anonymous session id, from the first-party cookie; set when missing. */
async function sessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && SESSION_ID_PATTERN.test(existing)) return existing;
  const id = newSessionId();
  // SameSite=None + Partitioned (CHIPS) so it also works inside a firm's
  // embed on another site; httpOnly because no script needs it.
  jar.set(SESSION_COOKIE, id, { httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/", maxAge: 60 * 60 * 24 });
  return id;
}

async function allowed(throttle: SlidingWindowThrottle, slug: string): Promise<boolean> {
  const key = clientKey(clientIp(await headers()), throttleKey());
  return key ? throttle.take(`${slug}:${key}`, Date.now()) : true;
}

export async function recordIntakeEventAction(slug: string, kind: unknown): Promise<void> {
  if (kind !== "visit" && kind !== "start_conversation" && kind !== "start_form" && kind !== "start_assessment") return;
  if (typeof slug !== "string") return;
  const read = await readIntakeHandle(slug);
  if (read.status !== "ok") return;
  if (!(await allowed(eventThrottle, slug))) return;
  const hash = sessionHash(await sessionId(), read.handle.formId, intakeSalt());
  await recordIntakeEvent(read.handle, kind, hash);
}

/**
 * "This person reached this question" (0096), plus their answers so far. Fire
 * and forget from the page: it returns nothing, shows no error and never
 * throws, whatever it was sent. Anything it can't vouch for is dropped quietly:
 * a token of the wrong shape or for another form or firm, a finished person,
 * a question the live form doesn't ask (or the firm hid), an index that isn't
 * a whole number from 0 to 60. The org and form written are the live form's.
 */
export async function recordIntakeStepAction(slug: unknown, payload: unknown): Promise<void> {
  try {
    if (typeof slug !== "string" || typeof payload !== "object" || payload === null) return;
    const p = payload as { token?: unknown; stepIndex?: unknown; questionId?: unknown; progress?: unknown };
    if (typeof p.token !== "string" || !RESUME_TOKEN_SHAPE.test(p.token)) return;
    const stepIndex = parseStepIndex(p.stepIndex);
    if (stepIndex === null || typeof p.questionId !== "string") return;
    const read = await readIntakeHandle(slug);
    if (read.status !== "ok") return;
    const { handle } = read;
    const questions = stepQuestions(handle.kind, handle.config);
    if (!questions.some((q) => q.id === p.questionId)) return;
    if (!(await allowed(stepThrottle, slug))) return;
    const hash = sessionHash(await sessionId(), handle.formId, intakeSalt());
    // Nothing usable in the progress leaves what is saved alone, rather than overwriting it with {}.
    const kept = p.progress === undefined ? {} : sanitizeProgress(p.progress, questions);
    await recordIntakeStep(handle, {
      token: p.token,
      stepIndex,
      questionId: p.questionId,
      progress: Object.keys(kept).length ? kept : null,
      sessionHash: hash,
    });
  } catch {
    // The page never learns whether this landed.
  }
}

export type StartIntakeResult =
  | { ok: true; token: string }
  | { ok: false; error: string; fields?: string[] };

/**
 * Contact-first (0093): files the person and their consent before any
 * question, and returns the token the answers step is tied to. A bot that
 * trips the honeypot or the fill time gets an empty token and nothing is
 * written; its later Submit then takes the full-validation path, which drops
 * it quietly too.
 */
export async function startIntakeAction(slug: string, payload: unknown): Promise<StartIntakeResult> {
  if (typeof slug !== "string") return { ok: false, error: "This intake isn't available." };
  const read = await readIntakeHandle(slug);
  if (read.status === "not_found" || read.status === "moved") return { ok: false, error: "This intake isn't taking submissions right now." };
  if (read.status !== "ok") return { ok: false, error: "We couldn't reach the firm's intake just now. Nothing was sent. Please try again in a minute." };
  const { handle } = read;
  const now = new Date();

  const spam = readSpamFields(payload);
  if (spam.honeypot.trim()) return { ok: true, token: "" };
  const checked = validatePublicStart(payload);
  if (!checked.ok) return { ok: false, error: checked.errors.join("\n"), fields: checked.fields };

  const stamp = checkStamp(spam.stamp, { formKey: handle.formId, now: now.getTime(), key: intakeSalt() });
  if (!stamp.ok) {
    if (stamp.reason === "expired") return { ok: false, error: "This page has been open a long time. Please reload it and start again." };
    if (stamp.reason === "malformed" || stamp.reason === "forged") {
      return { ok: false, error: "Something went wrong reading this page. Please reload it and try again." };
    }
    return { ok: true, token: "" };
  }
  if (!(await allowed(startThrottle, slug))) {
    return { ok: false, error: "We've had several people start from this connection just now. Please wait a few minutes and try again." };
  }

  // The intake decides the mode for an assessment; the browser's choice only picks chat or form.
  const start = handle.kind === "assessment" ? { ...checked.value, mode: "assessment" as const } : checked.value;
  const outcome = await startPublicIntake(handle, start, { sourceHost: stamp.host, startedAt: stamp.startedAt, now });
  if (!outcome.ok) return { ok: false, error: "We couldn't save your details just now. Please try again in a minute." };
  const submissionId = outcome.submissionId;
  after(() => syncIntakeStart(handle, submissionId, start.contact));
  return { ok: true, token: outcome.token };
}

export type SubmitIntakeResult =
  | { ok: true; closing: string }
  | { ok: false; error: string; fields?: string[] };

export async function submitIntakeAction(slug: string, payload: unknown): Promise<SubmitIntakeResult> {
  if (typeof slug !== "string") return { ok: false, error: "This intake isn't available." };
  const read = await readIntakeHandle(slug);
  if (read.status === "not_found" || read.status === "moved") return { ok: false, error: "This intake isn't taking submissions right now." };
  if (read.status !== "ok") return { ok: false, error: "We couldn't reach the firm's intake just now. Nothing was sent. Please try again in a minute." };
  const { handle } = read;
  const closing = handle.config.closing.trim() || "Thanks. We'll be in touch.";
  const now = new Date();

  // Contact-first: the person is already filed; add the answers to their row.
  const token = payload && typeof payload === "object" ? (payload as { token?: unknown }).token : undefined;
  if (handle.kind === "assessment") return { ok: false, error: "Please reload the page and start again." };
  if (typeof token === "string" && token) {
    const raw = payload as { answers?: unknown; mode?: unknown };
    const a = validateAnswers(raw.answers, handle.config.questions);
    if (a.errors.length) return { ok: false, error: a.errors.join("\n"), fields: a.fields };
    if (!(await allowed(submitThrottle, slug))) {
      return { ok: false, error: "We've had several submissions from this connection just now. Please wait a few minutes and try again." };
    }
    const mode = raw.mode === "conversation" ? "conversation" : "form";
    const done = await completeStartedIntake(handle, token, a.answers, mode, now);
    if (!done.ok) {
      return done.reason === "not_found"
        ? { ok: false, error: "This page has been open a long time. Please reload it and start again." }
        : { ok: false, error: "We couldn't send your answers just now. Nothing was lost on your side; please try again in a minute." };
    }
    if (!done.alreadyDone) {
      const hash = sessionHash(await sessionId(), handle.formId, intakeSalt());
      await recordIntakeEvent(handle, "complete", hash);
      after(() => screenSubmission(handle, done.submissionId, done.submission));
      after(() =>
        syncIntakeCompletion(handle, done.submissionId, {
          contact: done.submission.contact,
          note: { name: `Intake: ${handle.sourceTag ?? handle.name}`, body: done.noteBody },
        }),
      );
    }
    return { ok: true, closing };
  }

  const spam = readSpamFields(payload);
  if (spam.honeypot.trim()) return { ok: true, closing };
  // Validation first: a person who presses Submit on a half-filled form a
  // second after it loaded should hear what's missing, not be told "thanks".
  const checked = validatePublicSubmission(payload, handle.config.questions);
  if (!checked.ok) return { ok: false, error: checked.errors.join("\n"), fields: checked.fields };

  const stamp = checkStamp(spam.stamp, { formKey: handle.formId, now: now.getTime(), key: intakeSalt() });
  if (!stamp.ok) {
    if (stamp.reason === "expired") return { ok: false, error: "This page has been open a long time. Please reload it and submit again." };
    if (stamp.reason === "malformed" || stamp.reason === "forged") {
      return { ok: false, error: "Something went wrong reading this page. Please reload it and try again." };
    }
    // Complete and valid, faster than anyone types: a script. Drop it quietly.
    return { ok: true, closing };
  }

  if (!(await allowed(submitThrottle, slug))) {
    return { ok: false, error: "We've had several submissions from this connection just now. Please wait a few minutes and try again." };
  }
  const hash = sessionHash(await sessionId(), handle.formId, intakeSalt());
  if (hash && (await recentCompletions(handle, hash, new Date(now.getTime() - 10 * 60_000).toISOString())) >= 3) {
    return { ok: false, error: "We've already received a few submissions from this browser. Please wait a few minutes and try again." };
  }

  const outcome = await submitPublicIntake(handle, checked.value, { sourceHost: stamp.host, startedAt: stamp.startedAt, now });
  if (!outcome.ok) return { ok: false, error: "We couldn't send your answers just now. Nothing was lost on your side; please try again in a minute." };

  await recordIntakeEvent(handle, "complete", hash);
  // Screening is internal and slow; the prospect never waits on it.
  const submission = checked.value;
  after(() => screenSubmission(handle, outcome.submissionId, submission));
  // One write, so the completion sync creates the Lawmatics contact as well as tagging it.
  after(() =>
    syncIntakeCompletion(handle, outcome.submissionId, {
      contact: submission.contact,
      note: { name: `Intake: ${handle.sourceTag ?? handle.name}`, body: answersNote(`Intake: ${handle.sourceTag ?? handle.name}`, submission.answers, submission.contact) },
    }),
  );
  return { ok: true, closing };
}

export type CompleteAssessmentResult =
  | { ok: true; closing: string; result: AssessmentResultView | null }
  | { ok: false; error: string; fields?: string[] };

/**
 * The assessment's finish (0095). The person is already filed (contact first);
 * this checks the answers against the STORED card, scores them on the server,
 * files score + band + hot/warm/cold on their row and lead, and hands back only
 * what they may see: the score, band, gaps and next step (when the firm shows
 * the score). The temperature never leaves the server.
 */
export async function completeAssessmentAction(slug: string, payload: unknown): Promise<CompleteAssessmentResult> {
  if (typeof slug !== "string") return { ok: false, error: "This assessment isn't available." };
  const read = await readIntakeHandle(slug);
  if (read.status === "not_found" || read.status === "moved") return { ok: false, error: "This assessment isn't taking answers right now." };
  if (read.status !== "ok") return { ok: false, error: "We couldn't reach the firm just now. Please try again in a minute." };
  const { handle } = read;
  if (handle.kind !== "assessment") return { ok: false, error: "Please reload the page and start again." };
  const closing = handle.config.closing.trim() || "Thanks. We'll be in touch.";

  const raw = payload && typeof payload === "object" ? (payload as { token?: unknown; answers?: unknown }) : {};
  if (typeof raw.token !== "string" || !raw.token) return { ok: true, closing, result: null }; // a bot's empty token: nothing filed
  const scored = scoreAssessmentAnswers(handle.config.assessment, raw.answers);
  if (!scored.ok) return { ok: false, error: scored.errors.join("\n") };
  if (!(await allowed(submitThrottle, slug))) {
    return { ok: false, error: "We've had several submissions from this connection just now. Please wait a few minutes and try again." };
  }

  const { score, answerList, view } = scored.value;
  const done = await completeStartedIntake(handle, raw.token, answerList, "assessment", new Date(), {
    score: score.score,
    band: score.band,
    temperature: score.temperature,
    staffLine: assessmentStaffLine(score),
  });
  if (!done.ok) {
    return done.reason === "not_found"
      ? { ok: false, error: "This page has been open a long time. Please reload it and start again." }
      : { ok: false, error: "We couldn't send your answers just now. Nothing was lost on your side; please try again in a minute." };
  }
  if (!done.alreadyDone) {
    const hash = sessionHash(await sessionId(), handle.formId, intakeSalt());
    await recordIntakeEvent(handle, "complete", hash);
    after(() =>
      syncIntakeCompletion(handle, done.submissionId, {
        contact: done.submission.contact,
        temperature: score.temperature,
        note: { name: `Assessment: ${handle.sourceTag ?? handle.name}`, body: done.noteBody || answersNote(assessmentStaffLine(score), answerList) },
      }),
    );
  }
  return { ok: true, closing, result: handle.config.assessment.showScore ? view : null };
}
