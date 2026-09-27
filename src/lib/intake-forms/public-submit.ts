import { isEmailAddress } from "@/lib/members/email";
import { intakeStages } from "@/lib/intake/scope";
import type { Stage } from "@/lib/pipeline/stages";
import type { IntakeFormConfig, IpType } from "./config";
import { PACKS } from "./config";
import type { IntakeAnswer, IntakeContact, SubmissionMode } from "./submission";

/**
 * What a prospect sends from `/i/<slug>` (and a client from `/r/<token>`), and
 * what the server makes of it. Pure: the server action runs this on the
 * browser's payload, and tests/intake-forms/public-submit.test.ts drives it.
 *
 * ── THE BROWSER IS NOT TRUSTED ──────────────────────────────────────────────
 * The payload is `unknown`. Every field is checked for type and length, and
 * the answers are matched against the questions in the firm's STORED config
 * by id: an id the config doesn't have is dropped, a question's text always
 * comes from the config (never from the browser), and a required question
 * left blank is refused with a sentence.
 *
 * ── LEAD MAPPING ────────────────────────────────────────────────────────────
 * `leadFromSubmission` turns a validated submission into the `crm_lead`
 * columns the intake creates. It sets nothing that routes, prices or grades
 * the prospect — only what they told us, where it came from, and the practice
 * area when their answers make it obvious.
 */

export const SUBMIT_LIMITS = {
  name: 200,
  email: 320,
  phone: 60,
  company: 200,
  answer: 4000,
  /** Fastest plausible human submission, from first render. Faster is a bot. */
  minFillMs: 3000,
  /** A stamp older than this is a tab left open overnight: ask for a reload. */
  maxStampAgeMs: 24 * 60 * 60 * 1000,
} as const;

/** The honeypot's field name: a real-looking name bots fill and people never see. */
export const HONEYPOT_FIELD = "website_url";

export type SubmitPayload = {
  mode: SubmissionMode;
  contact: IntakeContact;
  answers: Record<string, string>;
  consent: boolean;
  honeypot: string;
  stamp: string;
};

export type ValidatedSubmission = {
  mode: SubmissionMode;
  contact: IntakeContact;
  answers: IntakeAnswer[];
};

export type SubmitValidation =
  | { ok: true; value: ValidatedSubmission }
  | { ok: false; errors: string[]; fields: string[] };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "");

/** Reads the loose parts (honeypot, stamp) before validation proper. */
export function readSpamFields(raw: unknown): { honeypot: string; stamp: string } {
  const r = isRec(raw) ? raw : {};
  return { honeypot: typeof r.honeypot === "string" ? r.honeypot : "", stamp: typeof r.stamp === "string" ? r.stamp.slice(0, 400) : "" };
}

type Question = Pick<IntakeFormConfig["questions"][number], "id" | "text" | "required">;

/**
 * Validates the answers alone — shared by the public intake (which also
 * validates a contact block and consent) and the matter request form.
 */
export function validateAnswers(
  raw: unknown,
  questions: readonly Question[],
): { answers: IntakeAnswer[]; errors: string[]; fields: string[] } {
  const given = isRec(raw) ? raw : {};
  const errors: string[] = [];
  const fields: string[] = [];
  const answers: IntakeAnswer[] = [];
  questions.forEach((q, i) => {
    const question = q.text.trim();
    if (!question) return;
    const v = text(given[q.id]);
    if (v.length > SUBMIT_LIMITS.answer) {
      errors.push(`Answer ${i + 1} is longer than ${SUBMIT_LIMITS.answer.toLocaleString("en-US")} characters.`);
      fields.push(q.id);
      return;
    }
    if (!v) {
      if (q.required) {
        errors.push(`Please answer: ${question}`);
        fields.push(q.id);
      }
      return;
    }
    answers.push({ id: q.id, question, answer: v });
  });
  return { answers, errors, fields };
}

export function validateContact(raw: unknown): { contact: IntakeContact; errors: string[]; fields: string[] } {
  const c = isRec(raw) ? raw : {};
  const contact: IntakeContact = {
    name: text(c.name).replace(/\s+/g, " "),
    email: text(c.email).toLowerCase(),
    phone: text(c.phone),
    company: text(c.company).replace(/\s+/g, " "),
  };
  const errors: string[] = [];
  const fields: string[] = [];
  const bad = (field: string, msg: string) => {
    errors.push(msg);
    fields.push(field);
  };
  if (!contact.name) bad("name", "Please tell us your name.");
  else if (contact.name.length > SUBMIT_LIMITS.name) bad("name", "Your name is too long.");
  if (!contact.email) bad("email", "Please give an email address we can reply to.");
  else if (contact.email.length > SUBMIT_LIMITS.email || !isEmailAddress(contact.email) || !/\.[a-z]{2,}$/i.test(contact.email)) {
    bad("email", "That email address doesn't look right.");
  }
  if (contact.phone.length > SUBMIT_LIMITS.phone || (contact.phone && !/^[0-9+().\-\s x]{5,}$/i.test(contact.phone))) {
    bad("phone", "That phone number doesn't look right.");
  }
  if (contact.company.length > SUBMIT_LIMITS.company) bad("company", "The company name is too long.");
  return { contact, errors, fields };
}

/**
 * The whole public-intake payload. `questions` are the firm's STORED
 * questions (full config), not anything the browser sent.
 */
export function validatePublicSubmission(raw: unknown, questions: readonly Question[]): SubmitValidation {
  if (!isRec(raw)) return { ok: false, errors: ["We couldn't read what you sent. Please try again."], fields: [] };
  const mode: SubmissionMode = raw.mode === "conversation" ? "conversation" : "form";
  const c = validateContact(raw.contact);
  const a = validateAnswers(raw.answers, questions);
  const errors = [...c.errors, ...a.errors];
  const fields = [...c.fields, ...a.fields];
  if (raw.consent !== true) {
    errors.push("Please confirm we may contact you about your inquiry.");
    fields.push("consent");
  }
  if (errors.length) return { ok: false, errors, fields };
  return { ok: true, value: { mode, contact: c.contact, answers: a.answers } };
}

// ── lead mapping ─────────────────────────────────────────────────────────────

/** "Jane Q. Doe" → ["Jane", "Q. Doe"]; one word is a first name. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0].slice(0, 100), last: parts.slice(1).join(" ").slice(0, 100) };
}

/**
 * The practice area, only when it is obvious: every answered question that
 * came from a pack came from the SAME pack, or the firm asks only one pack.
 * Anything else is left for a person to set.
 */
export function inferPracticeArea(
  config: Pick<IntakeFormConfig, "questions" | "packs">,
  answers: readonly IntakeAnswer[],
): IpType | null {
  const packOf = new Map(config.questions.map((q) => [q.id, q.pack] as const));
  const answered = new Set<IpType>();
  for (const a of answers) {
    const p = a.id ? packOf.get(a.id) : null;
    // A question the firm reworded keeps its pack only if it wasn't edited;
    // `pack` is already null for those (config.ts togglePack).
    if (p) answered.add(p);
  }
  if (answered.size === 1) return [...answered][0];
  if (answered.size === 0 && config.packs.length === 1) return config.packs[0];
  return null;
}

/** The Trademark pack's first question asks for the mark itself. */
const MARK_QUESTION = PACKS.Trademark[0];

export type LeadFields = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  practice_area: string | null;
  mark_text: string | null;
  referral_source: string;
  referral_detail: string | null;
};

export const INTAKE_REFERRAL_SOURCE = "Intake form";

export function leadFromSubmission(
  sub: ValidatedSubmission,
  config: Pick<IntakeFormConfig, "questions" | "packs">,
  sourceHost: string | null,
): LeadFields {
  const { first, last } = splitName(sub.contact.name);
  const practice = inferPracticeArea(config, sub.answers);
  const markAnswer = sub.answers.find((a) => a.question === MARK_QUESTION)?.answer ?? null;
  const how = sub.mode === "conversation" ? "Chat" : "Form";
  return {
    first_name: first,
    last_name: last,
    email: sub.contact.email,
    phone: sub.contact.phone || null,
    business_name: sub.contact.company || null,
    practice_area: practice,
    mark_text: practice === "Trademark" && markAnswer ? markAnswer.slice(0, 200) : null,
    referral_source: INTAKE_REFERRAL_SOURCE,
    referral_detail: sourceHost ? `${how} on ${sourceHost}` : how,
  };
}

/** The timeline note (`payload.note`) that files the answers on the lead or matter. */
export function answersNote(heading: string, answers: readonly IntakeAnswer[], contact?: IntakeContact): string {
  const lines = [heading];
  if (contact) {
    const bits = [contact.name, contact.email, contact.phone, contact.company].filter(Boolean);
    if (bits.length) lines.push(bits.join(" · "));
  }
  for (const a of answers) lines.push("", `Q: ${a.question}`, `A: ${a.answer}`);
  const out = lines.join("\n");
  return out.length > 8000 ? `${out.slice(0, 7990)}\n…` : out;
}

/**
 * Where a new intake lead lands: the firm's first OPEN intake stage (lowest
 * `order_index` among `intakeStages`, category 'open' — not a nurture
 * column). Null when the firm has none; the submission is still kept.
 */
export function firstOpenIntakeStageId(stages: Stage[]): string | null {
  const open = intakeStages(stages)
    .filter((s) => s.category === "open")
    .sort((a, b) => a.order_index - b.order_index);
  return open[0]?.id ?? null;
}
