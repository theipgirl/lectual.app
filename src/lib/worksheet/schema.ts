import { z } from "zod";

/**
 * What the master-class worksheet (lectual-plugin `sites/rpb-masterclass/trademark/worksheet/`) POSTs, and the caps on
 * it. Pure. The browser is not trusted: every string is capped, unknown keys are dropped, and nothing in the body can
 * name a firm, a form or an org. The firm is the one whose intake form `WORKSHEET_INTAKE_SLUG` names.
 *
 * Lenient where a real attendee could trip it (a radio value we don't recognise is kept as text, an empty group is
 * fine), strict where it matters (a real email, a submission id, consent, the size of every field).
 */

/** Whole request body, in characters. The worksheet's largest real payload is about 25 KB (two 3,000-character boxes). */
export const WORKSHEET_BODY_MAX = 64 * 1024;
/** At most this many entries per name group (the worksheet's MAX_ENTRIES). */
export const WORKSHEET_MAX_ENTRIES = 5;
/** The honeypot field: hidden on the page, people never fill it. */
export const WORKSHEET_HONEYPOT = "website";

/** Plain text: control characters (except line breaks and tabs) become spaces, CRLF becomes LF, trimmed, then capped. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

/** One line: line breaks and tabs collapse too (names, subjects). */
export function cleanLine(v: unknown, max: number): string {
  return cleanText(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max);
}

// `.optional()` first: in zod 4 a transformed `unknown` is otherwise a required key.
const str = (max: number) => z.unknown().optional().transform((v) => cleanText(v, max));
const line = (max: number) => z.unknown().optional().transform((v) => cleanLine(v, max));

const entry = z
  .object({ name: line(120), using: line(60), where: line(60) })
  .partial()
  .transform((e) => ({ name: e.name ?? "", using: e.using ?? "", where: e.where ?? "" }));

const group = z
  .array(z.unknown())
  .max(20)
  .catch([])
  .transform((list) =>
    list
      .slice(0, WORKSHEET_MAX_ENTRIES)
      .map((e) => entry.safeParse(e))
      .flatMap((r) => (r.success ? [r.data] : [])),
  );

export const GROUP_KEYS = ["business", "slogan", "product", "service", "program", "personal", "event", "series", "publication"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).catch(() => z.object(shape).parse({}));

const answersShape = z.object({
    groups: z
      .object(Object.fromEntries(GROUP_KEYS.map((k) => [k, group.optional()])) as Record<GroupKey, z.ZodOptional<typeof group>>)
      .catch({}),
    extra: obj({ dba: line(120), searched: line(80), handles: line(200) }),
    logo: obj({
      has: line(60),
      who: line(80),
      contractors: z
        .array(z.unknown())
        .max(10)
        .catch([])
        .transform((l) => l.map((x) => cleanLine(x, 80)).filter(Boolean)),
      agreement: line(80),
    }),
    creativeWork: obj({ written: str(3000), visual: str(3000), registered: line(80) }),
    nextStep: obj({ priority: line(160), talk: line(80) }),
  });
const answersSchema = answersShape.catch(() => answersShape.parse({}));

/** A uuid (any version): the browser makes one per worksheet and sends it with every retry of the same submission. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const worksheetSchema = z.object({
  submissionId: z.string().regex(UUID),
  contact: z.object({
    firstName: line(100).pipe(z.string().min(1)),
    lastName: line(100).pipe(z.string().min(1)),
    email: line(320).pipe(z.string().min(3)),
    business: line(200),
    mobile: line(60),
  }),
  consent: z.object({ given: z.boolean(), text: line(300).optional() }),
  answers: answersSchema,
  // Accepted and size-capped, but never stored or emailed as sent: the summary is rebuilt on the server from `answers`.
  summaryText: str(30_000).optional(),
  source: line(120).optional(),
  event: line(160).optional(),
  submittedAt: line(40).optional(),
  [WORKSHEET_HONEYPOT]: line(200).optional(),
});

export type WorksheetInput = z.infer<typeof worksheetSchema>;
export type WorksheetAnswers = WorksheetInput["answers"];

export type ParsedWorksheet =
  | { ok: true; value: WorksheetInput }
  | { ok: false; reason: "too_large" | "not_json" | "invalid" };

/** The raw body text (never a parsed object: the size check must come first). */
export function parseWorksheetBody(raw: string): ParsedWorksheet {
  if (raw.length > WORKSHEET_BODY_MAX) return { ok: false, reason: "too_large" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const r = worksheetSchema.safeParse(json);
  return r.success ? { ok: true, value: r.data } : { ok: false, reason: "invalid" };
}
